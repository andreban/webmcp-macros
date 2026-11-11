# Performance, hook stability, and global listeners

## Selective memoization: when to use `useMemo` and when not to

Do not sprinkle `React.memo`, `useMemo`, or `useCallback` across ordinary components by default.
Memoizing cheap scalar expressions or callbacks passed to native DOM elements adds clutter without
measurably improving render times.

Use memoization in two specific places where reference identity matters:

1. **Custom hooks that return a bundle of action callbacks must wrap the returned object in
   `useMemo`.** When a hook returns an object literal `{ selectItem, clearSelection, ... }`, a
   fresh object reference is allocated on every render. Any consumer that passes that bundle into a
   `useEffect` or `useCallback` dependency array will re-run its effect on every render. Memoize
   the returned action bundle with `useMemo` (or expose static store actions):

```ts
import { useMemo } from 'react';

export function useCanvasActions(store: CanvasStore) {
  return useMemo(
    () => ({
      zoomIn: (step: number) => store.zoomIn(step),
      resetZoom: () => store.resetZoom(),
      toggleGrid: (layerId: string) => store.toggleGrid(layerId),
    }),
    [store],
  );
}
```

2. **Expensive derived computations or props passed to a `React.memo` child.** Only memoize derived
   data when profiling shows the computation is nontrivial or a memoized child subtree depends on
   referential equality.

## Stabilize global `window` event listeners with `useRef`

When attaching global `window.addEventListener('keydown', ...)` or `pointermove` listeners in a
hook or component (for example, a keyboard shortcut that toggles a command palette with `Cmd+K` /
`Ctrl+K` and closes it on `Escape`), **never place dynamic boolean state (`isOpen`) or parent
callback props (`onOpenChange`) directly in the listener `useEffect` dependency array**.

Putting `[isOpen, onOpenChange]` in the `useEffect` dependencies tears down and re-registers the
global `window` listener on every open/close transition and on every parent render that passes an
inline callback. Instead, hold `isOpen` and `onOpenChange` in mutable `useRef`s, sync the refs, and
register the `window` listener once with an empty dependency array (`[]`):

```ts
import { useEffect, useRef } from 'react';

export function useQuickHelpShortcut(
  isOpen: boolean,
  onOpenChange?: (nextOpen: boolean) => void,
) {
  const isOpenRef = useRef(isOpen);
  const onOpenChangeRef = useRef(onOpenChange);

  isOpenRef.current = isOpen;
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChangeRef.current?.(!isOpenRef.current);
      } else if (event.key === 'Escape' && isOpenRef.current) {
        event.preventDefault();
        onOpenChangeRef.current?.(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

## Parallel requests and code splitting

- **Start independent requests in parallel**: use separate `useQuery` / `useQueries` hooks or
  `Promise.all` inside a combined query function rather than sequential `await` waterfalls.
- **Lazy-load heavy route and editor modules**: use `React.lazy(() => import(...))` in route
  definitions so large page bundles stay out of the initial entry chunk.
- **Lazy `useState` initialization**: pass an initializer function (`useState(() => loadPrefs())`)
  when the initial state reads storage or performs nontrivial parsing.
