import { type HTMLAttributes, type KeyboardEvent, type Ref, useId, useState } from "react";
import { type StmtOp, statements } from "./registry";

const OPS = Object.keys(statements).filter((op): op is StmtOp => Object.hasOwn(statements, op));

/** The statement kinds whose verb or op contains `query`, in registry order. */
export function matchOps(query: string): StmtOp[] {
  const wanted = query.trim().toLowerCase();
  return OPS.filter((op) => statements[op].verb.includes(wanted) || op.toLowerCase().includes(wanted));
}

export interface PaletteProps {
  inputRef?: Ref<HTMLInputElement>;
  onPick: (op: StmtOp) => void;
  /** Escape: the caller puts focus back where it was. */
  onCancel: () => void;
  /** Extra props for each option, such as making it draggable into the program. */
  itemProps?: (op: StmtOp) => HTMLAttributes<HTMLElement>;
}

/**
 * The block palette, generated from the registry. It is a combobox, so one
 * control serves both ways in: typing filters, arrows choose, Enter inserts;
 * "/" on a block focuses it as the quick insert.
 */
export function Palette({ inputRef, onPick, onCancel, itemProps }: PaletteProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = matchOps(query);
  const current = Math.min(active, options.length - 1);
  const pick = (op: StmtOp) => {
    setQuery("");
    setActive(0);
    onPick(op);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : options.length - 1;
      setActive(options.length === 0 ? 0 : (current + step) % options.length);
    } else if (event.key === "Enter") {
      const op = options[current];
      if (op === undefined) return;
      event.preventDefault();
      pick(op);
    } else if (event.key === "Escape") {
      setQuery("");
      onCancel();
    }
  };
  const optionId = (op: StmtOp) => `${id}-${op}`;
  const activeOp = options[current];
  return (
    <div className="palette">
      <label htmlFor={`${id}-input`}>Insert block</label>
      <input
        id={`${id}-input`}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-activedescendant={activeOp === undefined ? undefined : optionId(activeOp)}
        placeholder="Type to filter, Enter to insert"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={`${id}-list`} role="listbox" aria-label="Blocks" className="palette-options">
        {options.map((op) => (
          <li
            key={op}
            id={optionId(op)}
            role="option"
            aria-selected={op === activeOp}
            className={`wmm-block wmm-block--${statements[op].category}`}
            onClick={() => pick(op)}
            {...itemProps?.(op)}
          >
            <span className="wmm-verb">{statements[op].verb}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
