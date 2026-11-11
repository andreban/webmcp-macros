import { Importer } from "./Importer";
import { SavedMacros, useSavedMacros } from "./SavedMacros";

export function App() {
  const macros = useSavedMacros();
  return (
    <main>
      <h1>WebMCP Macros</h1>
      <SavedMacros macros={macros} />
      <Importer saved={macros} />
    </main>
  );
}
