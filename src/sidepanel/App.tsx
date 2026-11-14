// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Importer } from "./Importer";
import { SavedMacros, useSavedMacros } from "./SavedMacros";
import { ThisPage } from "./ThisPage";

export function App() {
  const macros = useSavedMacros();
  return (
    <main>
      <h1>WebMCP Macros</h1>
      <ThisPage macros={macros} />
      <SavedMacros macros={macros} />
      <Importer saved={macros} />
    </main>
  );
}
