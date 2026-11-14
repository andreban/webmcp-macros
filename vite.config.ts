// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // Pages the manifest does not name (crxjs builds only those) are listed here.
  build: { rolldownOptions: { input: { editor: "src/editor/index.html" } } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], passWithNoTests: true },
});
