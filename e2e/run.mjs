/**
 * End-to-end check: loads the built extension into Chromium with WebMCP
 * enabled, opens the rocket fixture, and runs the bundled sample macro.
 *
 *   npm run build && npm run test:e2e
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "../dist");

const server = createServer(async (_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(await readFile(join(here, "fixtures/rocket.html")));
});
await new Promise((ready) => server.listen(0, ready));
const pageUrl = `http://localhost:${server.address().port}/`;

const profile = await mkdtemp(join(tmpdir(), "wmm-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
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

let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(pageUrl);
  check("fixture page has WebMCP", (await page.textContent("#status")) === "IDLE", await page.textContent("#status"));

  await page.waitForSelector("webmcp-macros-widget", { state: "attached", timeout: 5000 }).then(
    () => check("launcher appears when the macro matches", true),
    () => check("launcher appears when the macro matches", false),
  );

  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, pageUrl);
  check("background can find the tab", typeof tabId === "number");

  // Drive the run the way the side panel does: a message from an extension page.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  const run = (inputs) =>
    panel.evaluate(
      ({ tabId, inputs }) =>
        new Promise((done) => {
          const listener = (message) => {
            if (message.type !== "run-finished" || message.tabId !== tabId) return;
            chrome.runtime.onMessage.removeListener(listener);
            done(message.result);
          };
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime.sendMessage({ type: "run-macro", macroId: "sample-rocket-launcher", inputs, tabId });
        }),
      { tabId, inputs },
    );

  const bad = await run({ trajectory: "Mars", authCode: "0000" });
  check("wrong auth code fails with the tool's error", bad.status === "failed" && bad.message === "Invalid authorization code.", JSON.stringify(bad));

  const good = await run({ trajectory: "Mars", authCode: "4821" });
  check("macro completes", good.status === "done", JSON.stringify({ status: good.status, message: good.message, toolCalls: good.toolCalls }));
  check("rocket is launched", (await page.textContent("#status")) === "LAUNCHED", await page.textContent("#status"));
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
