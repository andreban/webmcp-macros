# AGENTS.md

Guidance for coding agents (and people) working in this repository.

## What this is

WebMCP Macros is a Manifest V3 Chrome extension that runs deterministic
automations against the WebMCP tools a page registers on
`document.modelContext`. Users build macros from blocks, save them, and share
them as a `wmm1.…` string. There is no LLM anywhere in the product.

## Plans and design live in ZNotes

The ZNotes directory for this project is `webmcp-macros` (`--path webmcp-macros`).
The PRD and technical specification, and the delivery plan with the
parallel-work map, are notes there. Never add design docs or plans under
`docs/` in this repository. Read the specification before changing the macro
format, the runner or the editor, and update the note in place, before opening
the PR, when a decision changes.

## Stack

TypeScript (strict), React 19, Vite, `@crxjs/vite-plugin` for the extension
build, Vitest for unit tests, Playwright for the end-to-end check. Do not add
Blockly or any other block-editor library: the editor is our own React code.

## Commands

| Command | Use |
| --- | --- |
| `npm run dev` | Vite dev build with HMR into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests |
| `npm run build` | Type-check, then production build |
| `npm run test:e2e` | Runs a macro in real Chromium against `e2e/fixtures` (build first; set `CHROMIUM_PATH` to use a specific binary) |

Run `npm run typecheck && npm test && npm run build` before every push.

## Layout

| Path | Responsibility |
| --- | --- |
| `manifest.config.ts` | The MV3 manifest, as code |
| `src/macro/` | The macro format: types, share-string codec, trigger matcher. Pure, no `chrome.*` |
| `src/runner/` | The interpreter. Pure: it reaches the outside only through a `ToolHost` |
| `src/webmcp/` | The only code allowed to touch `document.modelContext` |
| `src/background/` | Service worker: owns runs, the per-tab tool cache and the `ToolHost` for a tab |
| `src/content/` | Content script: tool bridge, trigger matching, the on-page launcher |
| `src/sidepanel/` | Side panel React app |
| `src/ui/` | React pieces shared by the launcher, side panel and editor |
| `src/samples/` | Bundled sample macros, also used as test data |
| `e2e/` | End-to-end script and fixture pages |

## Rules that keep the design intact

- **The macro JSON is the single source of truth.** The editor edits it, the
  runner interprets it, the codec encodes it. Never introduce a second
  representation (no editor-only model, no generated JavaScript).
- **Macros cannot run code.** No `eval`, `new Function`, network or DOM access
  from the interpreter. Its only effects go through `ToolHost`.
- **WebMCP calls go through `src/webmcp/adapter.ts`.** The API is in an origin
  trial and still changes; keep version quirks in that one file.
- **`src/macro` and `src/runner` stay free of `chrome.*` and React**, so they
  run under Vitest in Node.
- **Format changes are versioned.** Anything that changes the meaning of an
  existing macro bumps `MACRO_VERSION` and the share-string prefix, with a
  migration. Adding an optional field or a new statement does not.
- **Personal data never enters a macro.** Remembered inputs and presets live
  in `chrome.storage.local` keyed by macro id, outside the shared string.
- **Tools are dynamic.** Never assume a tool listed earlier still exists; wait
  for it or check, and re-evaluate on `toolchange`.
- The on-page launcher renders inside a closed shadow root and must not affect
  the host page's layout, focus or styles.

## UI rules specific to this extension

- The editor's state is the macro JSON, edited through a reducer with
  immutable updates. Component state is only for transient UI.
- Block components come from the block registry: adding a block is adding a
  registry entry.
- The launcher mounts lazily, only when a macro matches. Its styles are a
  string injected into its shadow root; never import a CSS file into
  `src/content`, it would leak into the host page. Keep that bundle small.
- Message types live in `src/messages.ts` as discriminated unions. Add the
  type there first, then handle it on both sides.
- `chrome.*` subscriptions are wrapped in hooks with cleanup. Side panel and
  editor state that matters is persisted to `chrome.storage`, not kept in
  module variables.
- Everything works from the keyboard; drag and drop always has a keyboard
  equivalent. Run progress is announced with `role="status"`.

## Workflow

- Work is tracked as GitHub issues. Milestones are parent issues; each
  sub-issue is one pull request of roughly **100 to 200 changed lines**
  (lockfiles, fixtures and tests excluded). This project's target overrides
  the larger default in the `github-pr-workflow` and `planning` skills. If a
  change grows past it, split it and add a sub-issue.
- Each issue starts with its `Depends on #N` lines. Issues with no unmet
  dependency can be worked in parallel; the tracking issue and the plan note
  in ZNotes hold the current map.
- One issue per branch and PR. Reference the issue with `Closes #N`.
- Every PR includes tests for the logic it adds. UI-only PRs say how they were
  checked by hand or by `npm run test:e2e`.
- Write code comments for the reader of the code (constraints, invariants,
  why), not as a record of the change.

## Skills

Skills live in `.agents/skills/` (`.claude/skills` is a link to it). Most are
imported from `andreban/skills`; refresh them with
`npx skills add andreban/skills --skill <name>`.

| Skill | Use it when |
| --- | --- |
| `typescript-best-practices` | Writing or reviewing any TypeScript here |
| `react-frontend` | Writing or reviewing React components, hooks or UI tests |
| `planning` | Planning a feature, updating the spec, breaking work into issues |
| `interview-me` | A request is underspecified |
| `github-pr-workflow` | Taking an issue to a pull request |
| `pr-review` | Reviewing a pull request or diff |
| `issue-factory` | Running the issue factory over issues labeled `factory` |

Where a skill and this file disagree, this file wins.
