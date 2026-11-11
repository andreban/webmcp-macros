---
name: typescript-best-practices
description: >
  TypeScript conventions for this repository: strict types without `any` or unchecked casts,
  discriminated unions with exhaustive `never` checks, validating data at trust boundaries
  (share strings, chrome.storage, extension messages, WebMCP tool results) with type guards,
  `unknown` in catch blocks, `noUncheckedIndexedAccess` handling, type-only imports, and
  keeping pure modules free of `chrome.*`. Use when writing, changing or reviewing any `.ts` or
  `.tsx` file here. Not for React component structure (see react-frontend).
---

# TypeScript best practices for WebMCP Macros

The compiler runs with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`,
`noUnusedParameters` and `isolatedModules`. Code must pass `npm run typecheck`
with no suppressions.

## Types describe the data, exactly

- No `any`. Use `unknown` for values you have not checked yet, and narrow.
- No `as` casts to silence the compiler. A cast is acceptable only at a
  boundary immediately after a runtime check, or to name a browser API that
  the DOM typings do not have yet (keep those in `src/webmcp/adapter.ts`).
- No non-null `!` unless the line above proves it (for example a length
  check). Prefer narrowing: `const first = list[0]; if (!first) return;`.
- No `@ts-ignore`. If `@ts-expect-error` is unavoidable, add the reason.
- Prefer `interface` for object shapes that are extended or implemented, and
  `type` for unions and aliases.
- Make illegal states unrepresentable: one discriminated union instead of
  several optional fields or booleans that only make sense together.

## Discriminated unions and exhaustiveness

The macro AST (`Stmt`, `Expr`) and every message type are discriminated
unions. Every `switch` over one ends with a `never` check so adding a variant
fails the build until each consumer handles it:

```ts
switch (stmt.op) {
  case "call":
    return runCall(stmt);
  // ...
  default:
    throw new Error(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
}
```

Use `satisfies` to check a literal against a type without widening it.

## Validate at trust boundaries

Types say nothing about data that arrives at runtime. Treat these as
`unknown` and narrow with a type guard before use:

- a decoded share string (`isMacro` in `src/macro/types.ts`),
- anything read from `chrome.storage`,
- extension messages (`isRunEvent` in `src/messages.ts`),
- WebMCP tool results and tool schemas, which the site controls.

Write guards as `function isX(value: unknown): value is X`, test them with
malformed input, and never cast past them. Inside the boundary, trust the
types and do not re-check.

## Errors and async

- `catch (error)` gives `unknown`: narrow with `error instanceof Error`.
- Throw `Error` subclasses with a message a user can read; the runner shows
  them. Expected outcomes (a run that fails) are return values, not throws
  that cross module boundaries.
- Never leave a promise floating. `await` it, return it, or mark a deliberate
  fire-and-forget with `void` and handle rejection inside.
- Accept an `AbortSignal` in anything long-running and honour it.

## Modules

- `import type` for type-only imports (`isolatedModules` requires it for
  re-exports).
- Named exports only; no default exports except where a tool requires one
  (Vite config, manifest).
- `src/macro` and `src/runner` import nothing from `chrome.*`, React or the
  DOM, so they run under Vitest in Node. Side effects go through an injected
  interface such as `ToolHost`.
- Constants are `const` with `as const` where a literal type matters. No
  `enum`; use a union of string literals.
- JSON-shaped values use the `Json` type, not `object` or `Record<string, any>`.

## Comments and naming

- Document exported functions and types with a short doc comment that says
  what the caller needs: contract, units, what `null` means.
- Names say what a value is, not its type. Booleans read as predicates
  (`isSupported`, `running`).

## Review checklist

- [ ] `npm run typecheck` passes with no new suppressions.
- [ ] No `any`, no unexplained `as` or `!`.
- [ ] New union variants are handled in every `switch` (the `never` check
      proves it).
- [ ] Runtime data from outside is narrowed by a tested type guard.
- [ ] No floating promises; long-running work takes an `AbortSignal`.
- [ ] Pure modules stay free of `chrome.*` and React.
