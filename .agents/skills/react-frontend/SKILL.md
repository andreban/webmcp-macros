---
name: react-frontend
description: >
  Conventions for building and testing React + TypeScript frontends: deriving state during render
  instead of syncing with useEffect, immutable sorting with toSorted, ternary conditions for
  numeric values instead of &&, server state with TanStack Query (useQuery, useMutation) and
  resilient batch mutations with Promise.allSettled, multi-environment localStorage helpers that
  verify getItem/setItem are functions with an in-memory fallback and versioned keys, selective
  hook memoization and useRef-stabilized global listeners, accessible WAI-ARIA dialogs with
  async dismissal guards and focus restoration, mobile-first h-dvh layouts and decomposed
  components, and Vitest + React Testing Library tests in jsdom and mutation options factories.
  Use when writing, refactoring, or testing React + TypeScript components, hooks, dialogs,
  layouts, or client storage. Not for Rust crates (rust-testing, rust-errors-and-architecture,
  cargo-dependencies), Python, Go, Node-only TypeScript packages without React, or WebMCP tools.
---

# React + TypeScript frontend

These conventions prevent the failure modes that show up most often in React + TypeScript single-page
applications: redundant render passes from `useEffect` state syncing, stray `"0"` text nodes from
numeric `&&` expressions, crashes in Node 25+ or private browsing when touching `localStorage`,
dialogs that unmount mid-mutation and swallow errors, layout clipping under mobile browser chrome,
and brittle DOM or hook tests.

## Find what applies and load the right reference

Always read the matching reference file before editing code in its area:

| Task | Section / Reference to read |
|---|---|
| Deriving state, sorting arrays, or conditional rendering | [Derive state during render](#derive-state-during-render-not-in-useeffect) |
| Fetching server data or running single/batch mutations | [Server state and batch mutations with TanStack Query](#server-state-and-batch-mutations-with-tanstack-query) |
| Persisting UI preferences to `localStorage` or `sessionStorage` | [Multi-environment browser storage](#multi-environment-browser-storage) |
| Custom hooks returning action bundles, global `keydown` listeners, memoization, or route splitting | Read [`references/performance.md`](references/performance.md) **before writing code** |
| Modal dialogs, dropdown menus, keyboard navigation, mobile `h-dvh` shells, drawers, or splitting monolithic JSX | Read [`references/accessibility-and-layout.md`](references/accessibility-and-layout.md) **before writing code** |
| Writing or updating Vitest unit tests, React Testing Library DOM tests, or TanStack Query hook tests | Read [`references/testing.md`](references/testing.md) **before writing code** |

## Derive state during render, not in `useEffect`

Never copy props or state into another `useState` variable inside a `useEffect`. Syncing derived
values in an effect forces an extra render pass with stale data on every update and drifts out of
sync when new filters or inputs are added.

When you touch a component that maintains a `useState` + `useEffect` pair for filtered, searched,
sorted, or aggregated items, **remove the `useState` and `useEffect` and compute the derived value
directly during render**:

```tsx
// Bad: extra render pass, mutates the array in place, and renders "0" when archivedCount is 0
const [displayedRows, setDisplayedRows] = useState(invoices);
useEffect(() => {
  setDisplayedRows(invoices.filter((inv) => inv.status === status).sort((a, b) => b.total - a.total));
}, [invoices, status]);
// ...
{archivedCount && <span className="badge">{archivedCount} archived</span>}

// Good: derived during render, immutable toSorted(), and explicit > 0 ternary
const normalizedQuery = query.trim().toLowerCase();
const displayedRows = invoices
  .filter((inv) => (status === 'all' || inv.status === status) && inv.vendor.toLowerCase().includes(normalizedQuery))
  .toSorted((a, b) => b.total - a.total);
const archivedCount = displayedRows.filter((inv) => inv.isArchived).length;
// ...
{archivedCount > 0 ? <span className="badge">{archivedCount} archived</span> : null}
```

Follow these render rules in every component you edit:

- **Sort immutably with `.toSorted()` / `.toReversed()`**: never call `.sort()` or `.reverse()` on
  arrays that come from props, state, or query caches, even after `.filter()`—use `.toSorted(...)`
  so ordering is explicitly non-mutating.
- **Use a ternary (`count > 0 ? <Badge /> : null`), never `&&`, for numeric conditions**: in JSX,
  `{0 && <Badge />}` evaluates to `0` and React renders a literal `"0"` text node into the DOM.
  Whenever you add a numeric badge or touch a component that already uses `{someCount && ...}` (or
  `{someCount > 0 && ...}`), convert **every** numeric count check in that component to an explicit
  ternary (`count > 0 ? <Element /> : null`).
- **Put user-triggered side effects in event handlers**, not in an effect watching a state flag,
  and use the functional update form (`setItems((prev) => ...)`) whenever next state depends on
  previous state.

## Server state and batch mutations with TanStack Query

Fetch server data with TanStack Query (`useQuery` / `useQueries` / `useMutation` from
`@tanstack/react-query`), not `useEffect` + `useState`. Manual `useEffect` fetching duplicates
loading/error flags, lacks cache deduplication across components, and requires manual refetch
plumbing after mutations.

When you update a component that still fetches API data with `useEffect` + `useState` (and
`@tanstack/react-query` is in `package.json`), **convert all data fetching in that component to
`useQuery` (or `useQueries`)**:

```tsx
const queryClient = useQueryClient();

const { data: tickets = [], isPending: ticketsPending } = useQuery({
  queryKey: ['projects', projectId, 'tickets'],
  queryFn: () => fetchTickets(projectId),
});

const { data: stats } = useQuery({
  queryKey: ['projects', projectId, 'ticket-stats'],
  queryFn: () => fetchTicketStats(projectId),
});
```

### Batch mutations use `Promise.allSettled` and always invalidate caches

When executing a batch operation across multiple selected IDs (such as batch delete, batch archive,
or batch move):

1. **Run the requests with `Promise.allSettled`**, never `Promise.all` or a sequential `for` loop
   that aborts on the first rejection. `Promise.all` abandons the remaining outcomes as soon as one
   request fails, leaving the UI unaware of which items succeeded.
2. **Always invalidate the relevant TanStack Query caches (`queryClient.invalidateQueries`) after
   `Promise.allSettled` completes**, even when some requests in the batch rejected, so the items
   that *did* succeed are immediately reflected in the UI.
3. **Report partial failures with both the failed count and the total attempted** (for example,
   `Failed to delete ${failures.length} of ${ids.length} items`), and remove succeeded IDs from the
   selection state:

```tsx
const [batchError, setBatchError] = useState<string | null>(null);

const deleteMutation = useMutation({
  mutationFn: async (ids: string[]) => {
    const results = await Promise.allSettled(
      ids.map((id) => deleteTicket(projectId, id)),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
    if (failures.length > 0) {
      throw new Error(`Failed to delete ${failures.length} of ${ids.length} items`);
    }
  },
  onSuccess: () => {
    setBatchError(null);
    setSelectedIds([]);
  },
  onError: (err) => {
    setBatchError(err instanceof Error ? err.message : 'Batch deletion failed');
  },
});
```

## Multi-environment browser storage

Never assume `localStorage` is functional merely because `typeof window !== 'undefined'` or
`typeof localStorage !== 'undefined'`. Node 25+ exposes a global `localStorage` object whose
`getItem` and `setItem` methods are `undefined` unless `--localstorage-file` is passed, and mobile
Safari private browsing or full quotas throw `SecurityError` / `QuotaExceededError` on write.

Whenever you implement or update a `localStorage` / `sessionStorage` persistence module:

1. **Verify `typeof storage.getItem === 'function'` and `typeof storage.setItem === 'function'`**
   before touching the storage object.
2. **Provide an in-memory fallback (`Map<string, string>`)** and write to it whenever browser
   storage is missing, lacks functional methods, or throws on `setItem`, so preferences saved during
   the current session can still be read back by `load*` and cleared by `reset*`.
3. **Use a namespaced, versioned storage key ending in `:v1`** (such as `'app:layoutPrefs:v1'` or
   `'ui:editorTheme:v1'`) so schema changes never collide with stale stored JSON, and merge parsed
   JSON over the default object (`{ ...DEFAULT_PREFS, ...parsed }`) so newly added fields always
   receive their default value.
4. **Wrap every `getItem`, `setItem`, and `removeItem` call in `try / catch`**:

```ts
const STORAGE_KEY = 'app:editorTheme:v1';
const memoryFallback = new Map<string, string>();

function getWorkingStorage(): Storage | null {
  try {
    if (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function'
    ) {
      return localStorage;
    }
  } catch {
    // Access denied in restricted environments
  }
  return null;
}

export function loadEditorPrefs(): EditorPrefs {
  const storage = getWorkingStorage();
  let raw: string | null = null;
  if (storage) {
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
  }
  if (raw === null) {
    raw = memoryFallback.get(STORAGE_KEY) ?? null;
  }
  if (!raw) return { ...DEFAULT_EDITOR_PREFS };
  try {
    return { ...DEFAULT_EDITOR_PREFS, ...(JSON.parse(raw) as Partial<EditorPrefs>) };
  } catch {
    return { ...DEFAULT_EDITOR_PREFS };
  }
}

export function saveEditorPrefs(prefs: EditorPrefs): void {
  const serialized = JSON.stringify(prefs);
  memoryFallback.set(STORAGE_KEY, serialized);
  const storage = getWorkingStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch {
    // QuotaExceededError or private browsing: memoryFallback already holds the value
  }
}

export function resetEditorPrefs(): void {
  memoryFallback.delete(STORAGE_KEY);
  const storage = getWorkingStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
}
```

## Memoization, hooks, layouts, dialogs, and testing

- **Selective memoization and stable global listeners** ([`references/performance.md`](references/performance.md)):
  do not add `memo`, `useMemo`, or `useCallback` by default for cheap values. **Do** wrap the
  returned object in `useMemo` when a custom hook returns a bundle of action callbacks (so callers
  can pass the bundle in `useEffect` dependency arrays without re-running every render), and store
  dynamic state/callbacks in `useRef`s when registering global `window.addEventListener` listeners.
  Read [`references/performance.md`](references/performance.md) whenever working on custom hooks,
  keyboard shortcuts, or performance.
- **Dialogs, keyboard menus, mobile layout, and component decomposition**
  ([`references/accessibility-and-layout.md`](references/accessibility-and-layout.md)): guard modal
  dismissal (`onOpenChange`, backdrop, `Escape`, Cancel) while an async submit is in flight; capture
  and restore focus via `document.activeElement`; declare `role="dialog"` and `aria-modal="true"`;
  handle `currentIndex === -1` explicitly in `ArrowDown`/`ArrowUp` menu navigation; replace
  `h-screen` with `h-dvh`, decompose JSX section-divider comments (`{/* === ... === */}`) into
  top-level components, and never define a component inside another component. Read
  [`references/accessibility-and-layout.md`](references/accessibility-and-layout.md) before editing
  any modal, menu, or layout shell.
- **Vitest and React Testing Library** ([`references/testing.md`](references/testing.md)): put DOM
  tests in a sibling `*.dom.test.tsx` starting with `// @vitest-environment jsdom` when a Node
  `renderToString` test file already exists; query by accessible role and name (`getByRole`), never
  `getByTestId`; and test TanStack Query mutations by exporting and invoking a
  `get<Name>MutationOptions(api, queryClient)` factory directly. Read
  [`references/testing.md`](references/testing.md) before writing or updating any test.

## Checklist before finishing

- [ ] Read the matching reference file (`references/performance.md`,
      `references/accessibility-and-layout.md`, or `references/testing.md`) for the task.
- [ ] Derived lists and counts are computed during render (no `useEffect` + `useState` syncing),
      arrays are sorted with `.toSorted()`, and all numeric JSX conditions use `> 0 ? ... : null`
      ternaries instead of `&&`.
- [ ] Server data uses TanStack Query (`useQuery` / `useMutation`), and batch mutations use
      `Promise.allSettled`, always call `queryClient.invalidateQueries`, and report
      `Failed to ... ${failures.length} of ${total}`.
- [ ] `localStorage` helpers verify `typeof storage.getItem === 'function'` and
      `typeof storage.setItem === 'function'`, fall back to an in-memory `Map`, use a `:v1`
      namespaced key, and wrap storage calls in `try / catch`.
