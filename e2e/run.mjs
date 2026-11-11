/**
 * End-to-end check: loads the built extension into Chromium with WebMCP
 * enabled, opens the rocket fixture, and runs the bundled sample macro.
 * Exits non-zero when any check fails.
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
const server = createServer(async (_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(await readFile(join(here, "fixtures/rocket.html")));
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

  const run = (inputs) =>
    panel.evaluate(
      ({ tabId, inputs, timeoutMs }) =>
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
          chrome.runtime.sendMessage({ type: "run-macro", macroId: "sample-rocket-launcher", inputs, tabId });
        }),
      { tabId, inputs, timeoutMs: RUN_TIMEOUT_MS },
    );

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
} catch (error) {
  check("e2e script ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
