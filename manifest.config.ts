import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "WebMCP Macros",
  description: pkg.description,
  version: pkg.version,
  // First Chrome with document.modelContext.getTools and executeTool.
  minimum_chrome_version: "153",
  permissions: ["storage", "sidePanel"],
  action: { default_title: "WebMCP Macros" },
  background: { service_worker: "src/background/index.ts", type: "module" },
  side_panel: { default_path: "src/sidepanel/index.html" },
});
