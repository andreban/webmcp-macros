// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "WebMCP Macros",
  description: pkg.description,
  version: pkg.version,
  // First Chrome with document.modelContext.getTools and executeTool.
  minimum_chrome_version: "153",
  permissions: ["storage", "sidePanel", "tabs"],
  // Broad for now so the bridge reaches every page; to become optional, requested per macro site.
  host_permissions: ["<all_urls>"],
  // Rendered from public/icons/logo.svg by `npm run icons`.
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: {
    default_title: "WebMCP Macros",
    default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" },
  },
  background: { service_worker: "src/background/index.ts", type: "module" },
  side_panel: { default_path: "src/sidepanel/index.html" },
  // Every frame: each lists and runs its own document's tools, so tools in iframes work too.
  content_scripts: [{ matches: ["<all_urls>"], all_frames: true, run_at: "document_idle", js: ["src/content/index.ts"] }],
});
