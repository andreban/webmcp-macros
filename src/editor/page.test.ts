import { describe, expect, it } from "vitest";
import { isMacro } from "../macro/types";
import { rocketLauncherMacro } from "../samples";
import { editorReducer, createEditorState } from "./state";
import { EDITOR_PAGE, createNewMacro, editorPath, historyShortcut, isDirty, parseEditorParams } from "./page";

describe("editorPath and parseEditorParams", () => {
  it("round-trip a macro id and a tab id", () => {
    const path = editorPath({ macroId: "a b&c", tabId: 42 });
    expect(path.startsWith(`${EDITOR_PAGE}?`)).toBe(true);
    expect(parseEditorParams(path.slice(path.indexOf("?")))).toEqual({ macroId: "a b&c", tabId: 42 });
  });

  it("leaves the query out when there is nothing to name", () => {
    expect(editorPath({})).toBe(EDITOR_PAGE);
    expect(parseEditorParams("")).toEqual({});
  });

  it("drops a malformed or empty value instead of guessing", () => {
    expect(parseEditorParams("?macro=&tab=12x")).toEqual({});
    expect(parseEditorParams("?tab=-3")).toEqual({});
    expect(parseEditorParams("?tab=1.5")).toEqual({});
    expect(parseEditorParams("?tab=99999999999999999999")).toEqual({});
    expect(parseEditorParams("?tab=7")).toEqual({ tabId: 7 });
  });
});

describe("createNewMacro", () => {
  it("makes a valid empty macro for the page's origin, without its query", () => {
    const macro = createNewMacro("https://example.com/app/?user=me#x", "id-1");
    expect(isMacro(macro)).toBe(true);
    expect(macro).toMatchObject({ id: "id-1", program: [], tools: {}, trigger: { site: "main", anyOf: [] } });
    expect(macro.sites).toEqual({ main: { match: ["https://example.com/*"], startUrl: "https://example.com/app/" } });
    expect(JSON.stringify(macro)).not.toContain("user=me");
  });

  it("starts with no site for pages a macro cannot run on", () => {
    expect(createNewMacro(undefined, "x").sites).toEqual({});
    expect(createNewMacro("chrome://extensions/", "x").sites).toEqual({});
    expect(createNewMacro("not a url", "x").sites).toEqual({});
  });

  it("gives every new macro a unique id", () => {
    expect(createNewMacro(undefined).id).not.toBe(createNewMacro(undefined).id);
  });
});

describe("isDirty", () => {
  it("follows edits, undo and equal copies", () => {
    const start = createEditorState(rocketLauncherMacro);
    expect(isDirty(start.macro, rocketLauncherMacro)).toBe(false);
    const renamed = editorReducer(start, { type: "setMeta", meta: { name: "Other" } });
    expect(isDirty(renamed.macro, rocketLauncherMacro)).toBe(true);
    expect(isDirty(editorReducer(renamed, { type: "undo" }).macro, rocketLauncherMacro)).toBe(false);
    expect(isDirty(structuredClone(rocketLauncherMacro), rocketLauncherMacro)).toBe(false);
  });
});

describe("historyShortcut", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("maps Ctrl or Cmd+Z to undo and with Shift, or Ctrl+Y, to redo", () => {
    expect(historyShortcut(key("z", { ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key("z", { metaKey: true }))).toBe("undo");
    expect(historyShortcut(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(key("y", { ctrlKey: true }))).toBe("redo");
  });

  it("ignores other keys and modifiers", () => {
    expect(historyShortcut(key("z", {}))).toBeNull();
    expect(historyShortcut(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(key("y", { metaKey: true }))).toBeNull();
    expect(historyShortcut(key("s", { ctrlKey: true }))).toBeNull();
  });
});
