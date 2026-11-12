// Renders public/icons/logo.svg to the PNG sizes the manifest lists. Chromium does
// the rasterising so the PNGs match how the SVG looks in the browser.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const dir = new URL("../public/icons/", import.meta.url);
const svg = await readFile(new URL("logo.svg", dir), "utf8");
// Small sizes drop the transparent margin so the artwork keeps every pixel it can.
const fullBleed = svg.replace('viewBox="0 0 128 128"', 'viewBox="8 8 112 112"');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    const source = size <= 32 ? fullBleed : svg;
    const sized = source.replace('width="128" height="128"', `width="${size}" height="${size}"`);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
    const png = await page.locator("svg").screenshot({ omitBackground: true });
    await writeFile(new URL(`icon-${size}.png`, dir), png);
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
