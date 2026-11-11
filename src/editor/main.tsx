import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorPage } from "./Editor";
import { parseEditorParams } from "./page";
import "../ui/blocks.css";
// The editor shares the side panel's base look; editor.css adds only its own layout.
import "../sidepanel/styles.css";
import "./editor.css";

const root = document.getElementById("root");
if (!root) throw new Error("The editor page has no #root element");

createRoot(root).render(
  <StrictMode>
    <EditorPage params={parseEditorParams(location.search)} />
  </StrictMode>,
);
