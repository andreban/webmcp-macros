import { useEffect, useRef, useState } from "react";
import { decodeMacro, MacroDecodeError } from "../macro/codec";
import type { Macro } from "../macro/types";
import { saveMacro } from "../storage";
import { ProgramView } from "../ui/ProgramView";

/** What the review step shows before an imported macro is saved. */
export interface ImportSummary {
  macro: Macro;
  /**
   * Every URL pattern the macro can trigger on, across all its sites, sorted:
   * the codec sorts object keys, so declaration order does not survive a share.
   */
  sitePatterns: string[];
  /** The distinct registered tool names it calls, sorted. */
  toolNames: string[];
  /** The saved macro with the same id, which saving would replace. */
  replaces: Macro | null;
}

export type ImportReview = { ok: true; summary: ImportSummary } | { ok: false; error: string };

/** Summarises `macro` for review against the currently saved macros. */
export function summarizeImport(macro: Macro, saved: readonly Macro[]): ImportSummary {
  return {
    macro,
    sitePatterns: [...new Set(Object.values(macro.sites).flatMap((site) => site.match))].toSorted(),
    toolNames: [...new Set(Object.values(macro.tools).map((tool) => tool.name))].toSorted(),
    replaces: saved.find((existing) => existing.id === macro.id) ?? null,
  };
}

/**
 * Decodes pasted text into a macro to review, or an error to show inline. It
 * never throws and never saves: saving waits for the user.
 */
export async function reviewImport(text: string, saved: readonly Macro[]): Promise<ImportReview> {
  if (!text.trim()) return { ok: false, error: "Paste a macro string first." };
  try {
    return { ok: true, summary: summarizeImport(await decodeMacro(text), saved) };
  } catch (error) {
    // MacroDecodeError messages are written for users; anything else is not.
    return {
      ok: false,
      error: error instanceof MacroDecodeError ? error.message : "This macro string could not be read.",
    };
  }
}

/** Paste a share string, review what the macro can do, then save it. */
export function Importer({ saved }: { saved: readonly Macro[] }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Macro | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const reviewed = useRef(false);

  // The review card replaces the textarea and back, so move focus with it
  // rather than dropping it on <body>.
  useEffect(() => {
    if (pending) headingRef.current?.focus();
    else if (reviewed.current) textRef.current?.focus();
    reviewed.current = pending !== null;
  }, [pending]);

  const review = async () => {
    setStatus("");
    const result = await reviewImport(text, saved);
    setError(result.ok ? "" : result.error);
    setPending(result.ok ? result.summary.macro : null);
  };

  const save = async (macro: Macro) => {
    try {
      await saveMacro(macro);
      setText("");
      setStatus(`Saved “${macro.name}”.`);
    } catch {
      setError("The macro could not be saved.");
    }
    setPending(null);
  };

  // Derived on every render so the duplicate check sees the list as it is now.
  const summary = pending ? summarizeImport(pending, saved) : null;

  return (
    <section aria-labelledby="import-heading">
      <h2 id="import-heading">Import</h2>
      <p role="status">{status}</p>
      {summary ? (
        <div className="card">
          <h3 ref={headingRef} tabIndex={-1}>
            Review “{summary.macro.name}”
          </h3>
          {summary.macro.description ? <p className="muted">{summary.macro.description}</p> : null}
          <p>Runs on:</p>
          <ul>
            {summary.sitePatterns.map((pattern) => (
              <li key={pattern}>
                <code>{pattern}</code>
              </li>
            ))}
          </ul>
          <p>Calls these tools:</p>
          <ul>
            {summary.toolNames.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <ProgramView macro={summary.macro} />
          {summary.replaces ? (
            <p className="status failed">
              You already have “{summary.replaces.name}” with the same id. Saving replaces it.
            </p>
          ) : null}
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => void save(summary.macro)}>
              {summary.replaces ? "Replace saved macro" : "Save macro"}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void review();
          }}
        >
          <label htmlFor="import-text">Macro string</label>
          <textarea
            id="import-text"
            ref={textRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setStatus("");
            }}
            placeholder="Paste a wmm1.… string"
            rows={3}
            aria-describedby={error ? "import-error" : undefined}
          />
          {error ? (
            <p id="import-error" role="alert" className="status failed">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" disabled={!text.trim()}>
              Review
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
