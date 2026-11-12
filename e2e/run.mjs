/**
 * End-to-end check: loads the built extension into Chromium with WebMCP
 * enabled, opens the rocket fixture, and runs the bundled sample macro; then
 * runs further scenarios against their own fixtures. Exits non-zero when any
 * check fails.
 *
 *   npm run build && CHROMIUM_PATH=/path/to/chrome npm run test:e2e
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "../dist");
const RUN_TIMEOUT_MS = 30_000;

// WebMCP needs a secure context, and http://localhost is one.
// `/navigate`, `/flights` and `/frames` (with any query) serve their fixtures, `/cross` the
// cross-site one (on localhost and 127.0.0.1, two origins); every other path the rocket.
const fixtures = { "/navigate": "navigate.html", "/flights": "flights.html", "/frames": "frames.html", "/cross": "cross.html" };
const server = createServer(async (request, response) => {
  const fixture = fixtures[new URL(request.url, "http://localhost").pathname] ?? "rocket.html";
  response.setHeader("content-type", "text/html");
  response.end(await readFile(join(here, "fixtures", fixture)));
});
await new Promise((ready) => server.listen(0, "localhost", ready));
const pageUrl = `http://localhost:${server.address().port}/`;

const profile = await mkdtemp(join(tmpdir(), "wmm-e2e-"));
let context;
let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

try {
  context = await chromium.launchPersistentContext(profile, {
    // Extensions need the full browser; the new headless mode supports them.
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-features=WebMCPTesting",
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(pageUrl);
  const status = () => page.textContent("#status");
  check("fixture page has WebMCP", (await status()) === "IDLE", await status());

  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, pageUrl);
  check("background can find the tab", typeof tabId === "number", String(tabId));

  // Drive the run the way the side panel does: messages from an extension page.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);

  // Asks the tab's content script, through the bridge, which tools it sees now.
  const listTools = () =>
    panel.evaluate(async (tabId) => {
      const tools = await chrome.tabs.sendMessage(tabId, { type: "list-tools" }, { frameId: 0 });
      return Array.isArray(tools) ? tools.map((tool) => tool.name).sort() : [];
    }, tabId);

  const idleTools = await listTools();
  check(
    "IDLE registers diagnostics but not the later steps",
    idleTools.includes("run_diagnostics") && !idleTools.includes("load_fuel") && !idleTools.includes("ignite_engines"),
    idleTools.join(", "),
  );

  const run = (inputs) => runMacro(panel, tabId, "sample-rocket-launcher", inputs);

  const bad = await run({ trajectory: "Mars", authCode: "0000" });
  check(
    "wrong auth code fails with the tool's error",
    bad.status === "failed" && bad.message === "Invalid authorization code.",
    JSON.stringify({ status: bad.status, message: bad.message }),
  );
  check("wrong auth code does not launch", (await status()) === "FUELED", await status());

  const fueledTools = await listTools();
  check(
    "FUELED registers prepare_launch and drops diagnostics",
    fueledTools.includes("prepare_launch") && !fueledTools.includes("run_diagnostics"),
    fueledTools.join(", "),
  );

  const good = await run({ trajectory: "Mars", authCode: "4821" });
  check("macro completes", good.status === "done", JSON.stringify({ status: good.status, message: good.message, toolCalls: good.toolCalls }));
  check("rocket is launched", (await status()) === "LAUNCHED", await status());

  await navigationScenario(context, worker, panel);
  await flightScenario(context, extensionId);
  await framesScenario(context, worker, panel);
  await crossSiteScenario(context, worker, panel);
} catch (error) {
  check("e2e script ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

/**
 * Starts a run the way the side panel does, from an extension page, and
 * resolves with its result, or a "timeout" status when none arrives.
 */
function runMacro(panel, tabId, macroId, inputs) {
  return panel.evaluate(
    ({ tabId, macroId, inputs, timeoutMs }) =>
      new Promise((done) => {
        const timer = setTimeout(() => finish({ status: "timeout", message: `No run-finished in ${timeoutMs} ms.` }), timeoutMs);
        const listener = (message) => {
          if (message?.type === "run-finished" && message.tabId === tabId) finish(message.result);
        };
        const finish = (result) => {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          done(result);
        };
        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime.sendMessage({ type: "run-macro", macroId, inputs, tabId });
      }),
    { tabId, macroId, inputs, timeoutMs: RUN_TIMEOUT_MS },
  );
}

/** Appends macros to the saved ones, as an import would. */
function saveMacros(panel, added) {
  return panel.evaluate(async (added) => {
    const { macros = [] } = await chrome.storage.local.get("macros");
    await chrome.storage.local.set({ macros: [...macros, ...added] });
  }, added);
}

/** A macro over the navigation fixture's tools, which all live on one site. */
function navigationMacro(id, program) {
  const names = ["open_page_b", "leave_for_blank", "open_view_c", "finish"];
  return {
    wmm: 1,
    id,
    name: id,
    sites: { fixture: { match: ["http://localhost/*"] } },
    tools: Object.fromEntries(names.map((name) => [name, { site: "fixture", name }])),
    trigger: { site: "fixture", anyOf: [] },
    program,
  };
}

/**
 * A run continues across the navigations its own tool calls cause: a full
 * page load (A to B), then an SPA route change in place (B to C). A call that
 * leaves for a page without the content script fails within its timeout.
 */
async function navigationScenario(context, worker, panel) {
  const journey = navigationMacro("e2e-navigate", [
    { op: "call", tool: "open_page_b", saveAs: "loaded" },
    { op: "call", tool: "open_view_c", saveAs: "routed" },
    { op: "call", tool: "finish", saveAs: "end" },
  ]);
  const stranded = navigationMacro("e2e-navigate-blank", [
    { op: "call", tool: "leave_for_blank" },
    { op: "waitForTool", tool: "finish", timeoutMs: 3000 },
  ]);
  await saveMacros(panel, [journey, stranded]);

  const page = await context.newPage();
  await page.goto(`${pageUrl}navigate`);
  const shown = () => page.textContent("#page");
  check("navigation fixture starts on page A", (await shown()) === "A", await shown());
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${pageUrl}navigate*`);

  const result = await runMacro(panel, tabId, journey.id, {});
  check(
    "macro follows a full page load and an SPA navigation to the end",
    result.status === "done" && result.toolCalls === 3,
    JSON.stringify({ status: result.status, message: result.message, toolCalls: result.toolCalls }),
  );
  check(
    "the navigating calls return null and the last call its result",
    result.vars?.loaded === null && result.vars?.routed === null && result.vars?.end?.done === true,
    JSON.stringify(result.vars),
  );
  check("the run ends on view C", (await shown()) === "DONE" && page.url().endsWith("?page=b&view=c"), page.url());

  await page.goto(`${pageUrl}navigate`);
  const started = Date.now();
  const left = await runMacro(panel, tabId, stranded.id, {});
  const elapsed = Date.now() - started;
  check(
    "leaving for a page with no content script fails within the timeout, saying why",
    left.status === "failed" && /did not report its tools/.test(left.message ?? "") && elapsed < 10_000,
    JSON.stringify({ status: left.status, message: left.message, elapsed }),
  );
  check("the tab is on the blank page", page.url() === "about:blank", page.url());
}

/**
 * The flight sample (spec §12, macro 2), started from the side panel's form
 * as a user would, against a fixture with the demo's tools: the search view
 * registers only `searchFlights`, and the filter tools arrive after the
 * route change the search causes. The bundled sample only matches the live
 * demo, so the stored copy gets a localhost pattern added.
 */
async function flightScenario(context, extensionId) {
  const macroId = "sample-flight-search";
  const panelUrl = `chrome-extension://${extensionId}/src/sidepanel/index.html`;
  const panel = await context.newPage();
  await panel.goto(panelUrl);
  await panel.evaluate(async (macroId) => {
    const { macros = [] } = await chrome.storage.local.get("macros");
    const withFixture = (macro) => ({
      ...macro,
      sites: { ...macro.sites, flights: { ...macro.sites.flights, match: [...macro.sites.flights.match, "http://localhost:*/flights*"] } },
    });
    await chrome.storage.local.set({ macros: macros.map((macro) => (macro.id === macroId ? withFixture(macro) : macro)) });
    await chrome.storage.local.remove(`inputs:${macroId}`);
  }, macroId);

  const page = await context.newPage();
  await page.goto(`${pageUrl}flights`);
  const text = (selector) => page.textContent(selector);
  check("flight fixture starts on the search view", (await text("#view")) === "SEARCH", await text("#view"));
  // The side panel follows the active tab of its window.
  await page.bringToFront();

  const openForm = async () => {
    await panel.locator("li.card", { hasText: "Search my usual flight" }).getByRole("button", { name: "Run" }).click();
    return panel.locator("form.wmm-form");
  };
  const form = await openForm();
  await form.getByLabel("From (IATA)").fill("SFO");
  await form.getByLabel("To (IATA)").fill("JFK");
  await form.getByLabel("Passengers").fill("2");
  await form.getByLabel("Stops").selectOption("Non-stop only");
  await form.getByLabel("Maximum price").fill("500");

  // The listener is in place before Run is pressed, so the result cannot be missed.
  await panel.evaluate((timeoutMs) => {
    window.flightRun = new Promise((done) => {
      const timer = setTimeout(() => done({ status: "timeout" }), timeoutMs);
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type !== "run-finished") return;
        clearTimeout(timer);
        done(message.result);
      });
    });
  }, RUN_TIMEOUT_MS);
  await form.getByRole("button", { name: "Run" }).click();
  const result = await panel.evaluate(() => window.flightRun);
  check(
    "flight macro waits for the results view's tools and finishes",
    result.status === "done" && result.toolCalls === 4,
    JSON.stringify({ status: result.status, message: result.message, toolCalls: result.toolCalls }),
  );
  const search = new URLSearchParams((await text("#search")) ?? "");
  check(
    "the fixture searched with the form's values",
    (await text("#view")) === "RESULTS" &&
      search.get("origin") === "SFO" &&
      search.get("destination") === "JFK" &&
      search.get("passengers") === "2" &&
      search.get("tripType") === "round-trip" &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.get("outboundDate") ?? ""),
    await text("#search"),
  );
  const filters = JSON.parse((await text("#filters")) ?? "null");
  check(
    "the fixture shows the filters applied",
    filters?.maxPrice === 500 && JSON.stringify(filters?.stops) === "[0]" && (await text("#shown")) === "1",
    `${await text("#filters")} shows ${await text("#shown")}`,
  );
  const runStatus = await panel.getByRole("region", { name: "This page" }).getByRole("status").textContent();
  check("the run is reported in the side panel", runStatus === "Filters applied to your search.", runStatus);

  const stored = await panel.evaluate(async (key) => (await chrome.storage.local.get(key))[key], `inputs:${macroId}`);
  check(
    "remember inputs are stored and ask inputs are not",
    // chrome.storage does not keep key order.
    JSON.stringify(Object.entries(stored ?? {}).sort()) ===
      JSON.stringify(Object.entries({ maxPrice: 500, maxStops: "Non-stop only", origin: "SFO", passengers: 2 })),
    JSON.stringify(stored),
  );

  // The next run starts from the search view again; its form shows what was remembered.
  await page.goto(`${pageUrl}flights`);
  await page.bringToFront();
  const next = await openForm();
  const field = (label) => next.getByLabel(label).inputValue();
  const shown = {
    origin: await field("From (IATA)"),
    destination: await field("To (IATA)"),
    passengers: await field("Passengers"),
    maxStops: await field("Stops"),
    maxPrice: await field("Maximum price"),
  };
  check(
    "the next run's form is pre-filled with the remembered inputs",
    JSON.stringify(shown) ===
      JSON.stringify({ origin: "SFO", destination: "NYC", passengers: "2", maxStops: "Non-stop only", maxPrice: "500" }),
    JSON.stringify(shown),
  );
}

/**
 * Tools registered inside a cross-origin iframe are listed and callable, and
 * `frameOrigin` picks the iframe's tool when the top page has one of the same name.
 */
async function framesScenario(context, worker, panel) {
  const port = new URL(pageUrl).port;
  const innerOrigin = `http://127.0.0.1:${port}`;
  const macro = {
    wmm: 1,
    id: "e2e-frames",
    name: "e2e-frames",
    sites: { fixture: { match: ["http://localhost/*"] } },
    tools: {
      stamp: { site: "fixture", name: "stamp_inner" },
      top: { site: "fixture", name: "whoami" },
      inner: { site: "fixture", name: "whoami", frameOrigin: innerOrigin },
    },
    trigger: { site: "fixture", anyOf: [] },
    program: [
      { op: "waitForTool", tool: "stamp" },
      { op: "set", var: "listed", value: { toolAvailable: "stamp" } },
      { op: "call", tool: "stamp", saveAs: "stamped" },
      { op: "call", tool: "top", saveAs: "top" },
      { op: "call", tool: "inner", saveAs: "inner" },
    ],
  };
  await saveMacros(panel, [macro]);

  const page = await context.newPage();
  await page.goto(`${pageUrl}frames`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${pageUrl}frames`);
  const result = await runMacro(panel, tabId, macro.id, {});
  check(
    "a tool inside an iframe is listed and callable",
    result.status === "done" && result.vars?.listed === true && result.vars?.stamped?.stamped === true,
    JSON.stringify({ status: result.status, message: result.message, vars: result.vars }),
  );
  check(
    "a shared name runs in the top frame, or in the iframe that frameOrigin names",
    result.vars?.top?.frame === "top" && result.vars?.inner?.frame === "inner" && result.vars?.inner?.origin === innerOrigin,
    JSON.stringify({ top: result.vars?.top, inner: result.vars?.inner }),
  );
  const stamped = await page.frameLocator("iframe").locator("#stamped").textContent();
  check("the iframe's page changed", stamped === "yes", stamped);

  // The listing the editor's tool palette reads.
  const listed = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ type: "list-frame-tools", tabId }), tabId);
  const iframe = listed?.find((frame) => frame.frameId !== 0);
  check(
    "the frame listing has the top frame's tools and the iframe's under its origin",
    listed?.[0]?.frameId === 0 &&
      listed[0].tools.some((tool) => tool.name === "whoami") &&
      iframe?.origin === innerOrigin &&
      iframe.tools.some((tool) => tool.name === "stamp_inner"),
    JSON.stringify(listed),
  );
}

/**
 * A run on one origin reads a value, then an `onSite` block opens the other
 * origin's declared start URL in a new tab and passes the value to its tool.
 * A second run finds that tab open and uses it instead of opening another.
 */
async function crossSiteScenario(context, worker, panel) {
  const port = server.address().port;
  const ledgerUrl = `http://127.0.0.1:${port}/cross`;
  const macro = {
    wmm: 1,
    id: "e2e-cross-site",
    name: "e2e-cross-site",
    sites: {
      quotes: { match: [`http://localhost:${port}/cross*`] },
      ledger: { match: [`http://127.0.0.1:${port}/cross*`], startUrl: ledgerUrl },
    },
    tools: { quote: { site: "quotes", name: "read_quote" }, record: { site: "ledger", name: "record" } },
    trigger: { site: "quotes", anyOf: [["quote"]] },
    program: [
      { op: "call", tool: "quote", saveAs: "q" },
      {
        op: "onSite",
        site: "ledger",
        body: [
          {
            op: "call",
            tool: "record",
            args: { value: { bin: "*", left: { get: { var: "q" }, path: ["quote"] }, right: { lit: 2 } } },
            saveAs: "saved",
          },
        ],
      },
    ],
  };
  await panel.evaluate(async (added) => {
    const { macros = [] } = await chrome.storage.local.get("macros");
    await chrome.storage.local.set({ macros: [...macros, added] });
  }, macro);

  const page = await context.newPage();
  await page.goto(`${pageUrl}cross`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${pageUrl}cross`);
  const ledgerTabs = () => worker.evaluate(async (url) => (await chrome.tabs.query({ url })).map((tab) => tab.id), ledgerUrl);
  check("no ledger tab is open before the run", (await ledgerTabs()).length === 0);

  const first = await runMacro(panel, tabId, macro.id, {});
  check(
    "a cross-site run passes a value from one origin to the other",
    first.status === "done" && first.toolCalls === 2 && first.vars?.saved?.entries === 1,
    JSON.stringify({ status: first.status, message: first.message, vars: first.vars }),
  );
  const opened = await ledgerTabs();
  check("the run opened the ledger's start URL in a new tab", opened.length === 1, JSON.stringify(opened));
  const ledger = context.pages().find((candidate) => candidate.url() === ledgerUrl);
  check("the ledger recorded the doubled quote", (await ledger?.textContent("#recorded")) === "34", await ledger?.textContent("#recorded"));

  const second = await runMacro(panel, tabId, macro.id, {});
  check(
    "a second run reuses the open ledger tab",
    second.status === "done" && second.vars?.saved?.entries === 2 && (await ledgerTabs()).length === 1,
    JSON.stringify({ status: second.status, message: second.message, tabs: await ledgerTabs() }),
  );
}
