# Testing React + TypeScript with Vitest and React Testing Library

## Node vs. `jsdom` test environments and `*.dom.test.tsx` sibling files

Vitest projects often default to `environment: 'node'` in `vitest.config.ts` so pure logic and
`renderToString` static markup tests run without DOM startup overhead.

Whenever you write tests that exercise **DOM effects, focus management, keyboard events (`Escape`,
arrow keys), click handlers, or React portals (`createPortal`)**:

1. **Add `// @vitest-environment jsdom` as the very first line of the test file.** Never use
   `happy-dom` (which has subtle gaps in sanitization and focus handling).
2. **Preserve existing Node `renderToString` test files by placing DOM tests in a sibling
   `<Component>.dom.test.tsx` file.** When `<Component>.test.tsx` already exists and uses
   `renderToString` from `react-dom/server` (especially for a component that renders via
   `createPortal`), do not overwrite `<Component>.test.tsx`; create `<Component>.dom.test.tsx` next
   to it with `// @vitest-environment jsdom` at line 1.
3. **Query elements by accessible role and name (`getByRole`, `findByRole`, `queryByRole`), never by
   `getByTestId` or CSS selectors.** Even if the component markup already contains `data-testid`
   attributes, always locate dialogs, buttons, inputs, and headings through React Testing Library's
   role queries (`screen.getByRole('dialog')`, `screen.getByRole('button', { name: /cancel/i })`) so
   the test verifies the accessibility tree real users rely on:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareDocumentDialog } from './ShareDocumentDialog';

afterEach(() => {
  cleanup();
});

describe('ShareDocumentDialog (DOM)', () => {
  it('focuses the cancel button on open, closes on Escape, and submits on confirm', () => {
    const onClose = vi.fn();
    const onShare = vi.fn();

    render(
      <ShareDocumentDialog
        open={true}
        documentTitle="Q3 Roadmap"
        onShare={onShare}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: /share q3 roadmap/i })).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
```

## Testing TanStack Query mutation hooks via a mutation options factory

When unit-testing a custom TanStack Query mutation hook (`useMutation` + `useQueryClient`) and its
cache invalidation logic:

1. **Never manually call `queryClient.invalidateQueries` inside the test body** to simulate cache
   invalidation, and do not spin up a full DOM + `QueryClientProvider` wrapper just to test a
   mutation hook's `mutationFn` and `onSuccess` callbacks.
2. **Extract and export a mutation options factory function** (`get<Name>MutationOptions(api, queryClient)`)
   from the hook module, and have the `use<Name>` hook pass that factory to `useMutation(...)`:

```ts
// src/hooks/useCreateTag.ts
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Tag, TagApi } from '../api/tags';

export function getCreateTagMutationOptions(api: TagApi, queryClient: QueryClient) {
  return {
    mutationFn: async ({ label }: { label: string }): Promise<Tag> => {
      const cleaned = label.trim();
      if (!cleaned) {
        throw new Error('Tag label cannot be empty');
      }
      return api.createTag({ label: cleaned });
    },
    onSuccess: (created: Tag) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['tag', created.id] });
    },
  };
}

export function useCreateTag(api: TagApi) {
  const queryClient = useQueryClient();
  return useMutation(getCreateTagMutationOptions(api, queryClient));
}
```

3. **In the co-located `<hook>.test.ts` file, invoke `options.mutationFn` and `options.onSuccess`
   directly** against a typed `vi.fn()` mock API and a `QueryClient` instance (or spy on
   `queryClient.invalidateQueries`), asserting both the API payload and the exact `queryKey`
   invalidations triggered by `onSuccess`:

```ts
// src/hooks/useCreateTag.test.ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Tag, TagApi } from '../api/tags';
import { getCreateTagMutationOptions } from './useCreateTag';

describe('getCreateTagMutationOptions', () => {
  it('trims the label, calls api.createTag, and invalidates tag caches on success', async () => {
    const createdTag: Tag = { id: 'tag-1', label: 'urgent' };
    const mockApi: TagApi = {
      createTag: vi.fn().mockResolvedValue(createdTag),
    };
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const options = getCreateTagMutationOptions(mockApi, queryClient);
    const result = await options.mutationFn({ label: '  urgent  ' });
    options.onSuccess(result);

    expect(mockApi.createTag).toHaveBeenCalledWith({ label: 'urgent' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tag', 'tag-1'] });
  });
});
```

## Mocking and async generators

- **Typed inline mocks with `vi.fn()`**: type your mock object with the interface it implements
  (`const mockApi: TagApi = { createTag: vi.fn().mockResolvedValue(...) }`) so TypeScript catches
  signature drift, and use `mockResolvedValueOnce` for multi-step call sequences.
- **Testing `AsyncIterable` streams**: collect events with a small `for await (const event of stream)`
  helper function and assert on the collected array.
