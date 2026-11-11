import { useEffect, useState } from "react";
import { encodeMacro } from "../macro/codec";
import type { Macro } from "../macro/types";
import { deleteMacro, loadMacros, onMacrosChanged } from "../storage";
import { ProgramView } from "../ui/ProgramView";

/**
 * The saved macros, kept current across extension contexts. Subscribes before
 * the first load, and a change that arrives first wins over the load's
 * (possibly older) snapshot.
 */
export function useSavedMacros(): Macro[] {
  const [macros, setMacros] = useState<Macro[]>([]);
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = onMacrosChanged((next) => {
      changed = true;
      if (active) setMacros(next);
    });
    loadMacros().then(
      (loaded) => {
        if (active && !changed) setMacros(loaded);
      },
      // An unreadable store shows as an empty list; the next change refills it.
      () => {},
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return macros;
}

/** Saved macros as expandable cards with their block view, share and delete. */
export function SavedMacros({ macros }: { macros: readonly Macro[] }) {
  return (
    <section aria-labelledby="saved-heading">
      <h2 id="saved-heading">Saved macros</h2>
      {macros.length === 0 ? (
        <p className="muted">Nothing saved yet. Import a macro below.</p>
      ) : (
        <ul className="cards">
          {macros.map((macro) => (
            <li key={macro.id}>
              <MacroCard macro={macro} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A transient line beside a card's actions; `failed` styles it as an error. */
interface Notice {
  text: string;
  failed: boolean;
}

function MacroCard({ macro }: { macro: Macro }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  // Notices are transient. Clearing the timer on unmount or on a newer notice
  // keeps a stale timeout from wiping the newer one.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(await encodeMacro(macro));
      setNotice({ text: "Copied", failed: false });
    } catch {
      setNotice({ text: "Could not copy to the clipboard", failed: true });
    }
  };
  // On success the card unmounts with the list change, so only failure needs a notice.
  const remove = () =>
    deleteMacro(macro.id).catch(() => setNotice({ text: "Could not delete this macro", failed: true }));

  return (
    <details className="card">
      <summary>{macro.name}</summary>
      {macro.description ? <p className="muted">{macro.description}</p> : null}
      <ProgramView macro={macro} />
      <div className="actions">
        {/* Always rendered so screen readers announce the text when it changes. */}
        <span role="status" className={notice?.failed ? "status failed" : "status"}>
          {notice?.text ?? ""}
        </span>
        <button type="button" className="secondary" onClick={() => void remove()}>
          Delete
        </button>
        <button type="button" onClick={() => void share()}>
          Copy share string
        </button>
      </div>
    </details>
  );
}
