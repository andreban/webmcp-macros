---
name: planning
description: >
  Plans non-trivial features and tracks architecture decisions and progress in ZNotes instead of
  repository docs/ files: checking existing ZNotes notes, todos, and GitHub issues first (znotes
  notes list/search/get, znotes todos list, gh issue list); resolving the ZNotes directory from
  AGENTS.md or the repository name (--path <repo>); writing PRDs and technical specs via znotes
  notes create; updating existing spec notes in place (znotes notes update <UUID>) before opening a
  PR; breaking specs into GitHub issues with ZNotes title/UUID and section references, feature
  labels (--label), Depends on #N links, and --body-file payloads; and archiving completed notes to
  <project>/archive via znotes notes move without deleting or rewriting archived notes. Use for
  "plan this feature", "write a spec for ...", "where are we on X", "break this down into issues",
  "we decided to use X instead of Y", or "archive the feature notes". Not for trivial edits,
  writing unit tests, UI components, or reviewing PRs.
---

<!--
SPDX-License-Identifier: Apache-2.0

Original skill text for this repository. Planning, ZNotes workflow, and PRD/SPEC lifecycle concepts
are adapted in original words from andreban/rigmaster (AGENTS.md §3 and §7), andreban/bandarrame_rs
(AGENTS.md "Documentation" and "GitHub Issues"), and andreban/znotes (.agents/skills/znotes/SKILL.md).
-->

# Feature planning and specification management (ZNotes)

Non-trivial features succeed when requirements, architecture trade-offs, and task breakdowns are
written down before coding—and kept in lockstep with the codebase as implementation evolves.
This skill governs **when and what to plan**, **where plans live (ZNotes, never repository `docs/`
files)**, **how to check status and keep specs current before opening a PR**, **how to break a
ZNotes spec into GitHub issues**, and **how to archive notes when a feature completes**.

For full `znotes` CLI flag syntax, authentication (`znotes whoami`), RAG Q&A (`znotes notes ask`),
and media attachments (`znotes files`), consult `znotes --help` (`znotes <subcommand> --help`) or
the `znotes` skill. Keep always-on repository rules (build/test commands, license headers, commit
trailers) in the project's `AGENTS.md` / `CLAUDE.md`.

## Find what applies

| Situation | Section |
|---|---|
| Starting a feature plan or writing a PRD / technical spec ("plan this feature", "write a spec for …") | [1. Orientation & where plans live (ZNotes, not `docs/`)](#1-orientation--where-plans-live-znotes-not-docs) |
| Checking progress or session orientation ("where are we on X?", "what's left to finish?") | [2. Checking status & reconciling note drift](#2-checking-status--reconciling-note-drift) |
| Recording an architectural or requirement change ("we decided to use X instead of Y") | [3. Keeping specs current before opening a PR](#3-keeping-specs-current-before-opening-a-pr) |
| Turning a plan into GitHub issues ("break the plan into issues", "file issues for the remaining phases") | [4. Breaking a ZNotes spec into GitHub issues](#4-breaking-a-znotes-spec-into-github-issues) |
| Wrapping up a finished feature ("all issues are merged, wrap up / clean up our notes") | [5. Finishing a feature & archiving notes](#5-finishing-a-feature--archiving-notes) |

---

## 1. Orientation & where plans live (ZNotes, not `docs/`)

### Resolve the project's ZNotes directory first

Every project stores its notes, plans, specifications, and todo lists inside a dedicated ZNotes
directory (`--path <project>`):

1. **Check `AGENTS.md` / `CLAUDE.md` first:** if the repository's instructions name a ZNotes
   directory path (for example, `--path rigmaster`), always use that exact path.
2. **Default to the repository / crate name when `AGENTS.md` does not specify one:** when
   `AGENTS.md` omits a ZNotes directory path, resolve the ZNotes directory to the repository or
   root package name (`--path <repo-name>`, e.g., `--path metrics-ingestor`). Verify existing
   directories with `znotes dirs list --parent root` or `znotes dirs tree`; if the directory does
   not exist yet, create it (`znotes dirs create <repo-name> --parent root`), or ask the
   user only if multiple existing directories make the target ambiguous.

### Look for existing plans and notes before drafting anything

Before creating a new plan or specification, check whether prior notes, architectural decisions, or
todo lists already exist in the project's ZNotes directory:

```bash
# Check existing ZNotes directories and list/search notes in the project directory
znotes dirs list --parent root
znotes notes list --path <project>
znotes notes search "<feature or topic>" --path <project> --recursive
znotes todos list --path <project>
```

Checking existing notes first prevents duplicate specs and surfaces constraints decided in earlier
sessions.

### Store requirements (PRD) and technical specifications (SPEC) in ZNotes—never in repository `docs/`

**ZNotes is the home for all product requirements (PRDs), technical specifications (SPECs), design
notes, and task plans—never create `docs/*.md`, `docs/<feature>/PRD.md`, or `docs/<feature>/SPEC.md`
files in the repository.**

- **Why ZNotes instead of repository `docs/`:** Notes stored in ZNotes are automatically embedded
  for semantic search (`znotes notes search`) and RAG synthesis (`znotes notes ask`) across agent
  sessions, and updating a plan or progress log during implementation never pollutes `git status`
  or inflates pull request diffs with non-code markdown files.
- **Always state the ZNotes vs. `docs/` policy in your reply:** when planning a feature or writing a
  specification, explicitly state in your reply that **requirements (PRD) and technical
  specifications (SPEC) live in ZNotes (`--path <project>`) rather than in repository `docs/`
  files** (and if `AGENTS.md` did not name a ZNotes directory, state that `--path <project>` was
  resolved from the repository/crate name). Never create any file under `docs/`.
- **What a feature plan must cover:** write either a single combined `<Feature> — PRD & Technical Specification`
  note or a paired `<Feature> — PRD` + `<Feature> — Specification` in `--path <project>` covering:
  - **Requirements (PRD):** problem statement, user/caller flows, explicit non-goals, and operational constraints.
  - **Technical Specification (SPEC):** module/type design, data model or wire format, error handling, ordered implementation phases (`§1`, `§2`, …), and verification strategy.

**Mandatory in your final reply when planning a new feature:** always include a single fenced
`bash` block containing **both** the orientation commands (`znotes dirs list`, `znotes notes list`,
`znotes notes search`) **and** the `znotes notes create --path <project>` command:

```bash
# 1. Orientation: check existing ZNotes directories, notes, and todos first
znotes dirs list --parent root
znotes notes list --path metrics-ingestor
znotes notes search "OTLP batch exporter" --path metrics-ingestor --recursive
znotes todos list --path metrics-ingestor

# 2. Create the PRD & Technical Specification in ZNotes (never in repository docs/)
znotes notes create \
  --path metrics-ingestor \
  --title "OTLP Batch Exporter — PRD & Technical Specification" \
  --tag spec \
  --tag otlp-batch-exporter \
  --file /tmp/otlp-batch-exporter-spec.md
```

---

## 2. Checking status & reconciling note drift

When a user asks **"where are we on X?"** or **"what is left to finish?"**, never guess from memory
and never trust either the note or the code in isolation:

1. **Always include a `### Orientation Commands` fenced `bash` block in your final reply:**
   even when a local note snapshot file (such as `notes-snapshot.md`) is already present in the
   workspace, **you must always write out the exact `znotes` orientation commands and `gh issue list`
   command in a fenced `bash` block in your final reply** so the workflow is reproducible:
   ```bash
   # Inspect ZNotes notes, raw spec content, todo lists, and GitHub issues for the feature
   znotes notes list --path <project>
   znotes notes search "<feature>" --path <project>
   znotes notes get <NOTE_UUID> --raw
   znotes todos list --path <project>
   gh issue list --label <feature> --state all
   ```
2. **Cross-check the note's recorded status against the actual code in `src/`:**
   read the relevant source files before reporting status. Distinguish clearly between:
   - **Completed and verified phases:** implemented in `src/` and recorded as done.
   - **Code implemented ahead of the note (note drift):** a phase or function that is already
     implemented in `src/` even though the ZNotes note still lists it as `"Not started"` or
     `"In progress"`.
   - **Stubbed or unimplemented phases:** functions in `src/` that exist as pass-through stubs,
     `todo!()`, or placeholders—never report a phase as implemented merely because its function
     signature compiles.
   - **Open questions and blockers:** unresolved design questions recorded in the note that must be
     decided before the remaining phase can be completed.
3. **Prescribe `znotes notes update <UUID>` when the note lags behind the codebase:**
   whenever your cross-check finds that a phase is already implemented in `src/` while the ZNotes
   note still marks it as not started, include the exact `znotes notes update <UUID>` command
   (`--append`, `--content`, or `--file`) to bring the ZNotes note's status section into sync with
   the codebase:
   ```bash
   znotes notes update e8b1204c-91a3-4d70-8f12-30c49a1b7e55 \
     --append "\n## Status Update (2026-10-15)\n- Phase 2 (protobuf frame encoder) is implemented in src/lib.rs; Phase 3 (gzip compression) remains a pass-through stub pending window-size decision."
   ```

---

## 3. Keeping specs current before opening a PR

Requirements, data structures, and storage or protocol choices frequently evolve during coding. A
stale specification misleads future sessions and reviewers.

1. **Update the existing ZNotes specification note in place (`znotes notes update <UUID>`):**
   when a design decision changes (for example, switching a storage backend, changing a retry
   algorithm, or revising a config struct), update the **existing** ZNotes note by its UUID using
   `znotes notes update <UUID> --append "..."` (to append a dated decision/architecture update) or
   `znotes notes update <UUID> --content "..."` / `--file <path>` (to revise the specification text
   in place):
   ```bash
   # Update the existing specification note in place—never create a duplicate note
   znotes notes update e8b1204c-91a3-4d70-8f12-30c49a1b7e55 \
     --file /tmp/otlp-batch-exporter-spec-updated.md
   ```
2. **Never create a duplicate ZNotes note (`znotes notes create`) for an existing feature:**
   creating a second spec note for the same feature leaves contradictory designs in semantic search
   (`znotes notes search`) so future sessions read outdated requirements.
3. **Never write updated specs to repository `docs/` files:**
   if the user asks to write the updated spec to `docs/<feature>/SPEC.md`, refuse to create any
   file under `docs/` and explain that specifications live in ZNotes (`znotes notes update <UUID>`).
4. **Sync the ZNotes specification *before* opening a pull request—never defer until after merge:**
   both the PRD and technical specification in ZNotes must match the actual implementation **before**
   `gh pr create` is run. If a prompt suggests opening the PR now and syncing the project notes
   after it merges, **refuse to defer the update**: explain that the ZNotes specification note must
   match the code before opening a pull request, and run `znotes notes update <UUID>` first.

---

## 4. Breaking a ZNotes spec into GitHub issues

Once a feature specification is in ZNotes, break the work into self-contained GitHub issues so each
issue can be implemented and reviewed in a single pull request (handing off to the
`github-pr-workflow` conventions for issue formatting and sizing):

1. **One reviewable slice per issue:** size each issue so its implementation stays within a single
   PR (target 200–400 lines, maximum 500 lines of production code diff excluding tests and
   lockfiles), ordered by phase (`§1`, `§2`, `§3`, …).
2. **Reference the ZNotes specification note by title, UUID, and section heading (`§N`):**
   because the specification lives in ZNotes rather than `docs/`, every issue body must cite:
   - the ZNotes note's **exact title** and **UUID** (e.g.,
     `ZNotes note "OTLP Batch Exporter — PRD & Technical Specification" (e8b1204c-91a3-4d70-8f12-30c49a1b7e55)`),
   - the **specific section number and heading** (`§2` / `### 2. Bounded Retry Buffer`), and
   - the `znotes` command to read it (`znotes notes get e8b1204c-91a3-4d70-8f12-30c49a1b7e55 --raw`).
   Never reference a nonexistent `docs/<feature>/SPEC.md` path, and do not paste the entire
   multi-phase specification into every issue.
3. **Declare explicit `Depends on #<N>` lines at the top:**
   list every prerequisite issue using the exact `Depends on #<N>` syntax (starting from any
   already-merged Phase 1 issue, and chaining later phases to earlier ones) so implementation order
   is unambiguous.
4. **Include self-contained Context, Constraints, and Acceptance Criteria:**
   give a fresh agent session everything it needs—relevant types from earlier phases, invariants not
   to break, and a concrete `- [ ]` acceptance checklist.
5. **Apply a shared feature label (`--label <feature>`) and pass bodies via `--body-file <path>`:**
   ensure the feature label exists (`gh label create <feature> --force`), write each issue body to a
   file using `write_file`, and pass `--body-file <path>` (or `-F <path>`) and `--label <feature>`
   to `gh issue create`. Never pass multiline markdown or backticks inline via `--body "..."`.

### Issue body template & `gh issue create` example (ZNotes-backed)

Write each issue body to a file (e.g. `issue-phase-2.md`):

```markdown
Label: `otlp-batch-exporter`
Depends on #14

## Context
Implements **§2 (`### 2. Bounded Retry Buffer`)** of the ZNotes specification note
**"OTLP Batch Exporter — PRD & Technical Specification"** (Note ID:
`e8b1204c-91a3-4d70-8f12-30c49a1b7e55` in `--path metrics-ingestor`; read with
`znotes notes get e8b1204c-91a3-4d70-8f12-30c49a1b7e55 --raw`).
Issue #14 added the `MetricBatch` envelope in `src/lib.rs`; this issue adds bounded retry queuing.

## Constraints
- Do not modify the public fields of `MetricBatch` introduced in #14.
- Retry only HTTP `429` and `5xx` responses; drop other `4xx` responses immediately.

## Acceptance Criteria
- [ ] Add `RetryPolicy` and `next_backoff_ms` in `src/retry.rs` with exponential backoff clamped to `max_delay_ms`.
- [ ] Unit tests cover `429`, `503`, `400` (non-retryable), and max-attempt exhaustion.
```

Then create the label (if needed) and file each issue with `--body-file` and `--label`:

```bash
gh label create otlp-batch-exporter --description "OTLP batch exporter feature" --force
gh issue create \
  --title "otlp-batch-exporter: add bounded retry buffer and backoff policy" \
  --label otlp-batch-exporter \
  --body-file issue-phase-2.md
```

---

## 5. Finishing a feature & archiving notes

When all GitHub issues for a feature are closed and their pull requests have merged to `main`:

1. **Record final completion on the feature's ZNotes note and todo list:**
   - Update the feature's ZNotes specification note (`znotes notes update <UUID> --append "..."`) to
     record that the final issue and PR have merged and the feature is complete.
   - If the feature has an active ZNotes todo list with pending close-out items, mark them complete
     using `znotes todos toggle <TODO_UUID> <ITEM_UUID> --status complete`.
2. **Archive the completed feature note via `znotes notes move` to `<project>/archive`:**
   move the completed feature's note(s) out of the active project directory into `<project>/archive`
   so active `znotes notes list --path <project>` queries stay focused on current work while
   keeping the design history searchable:
   ```bash
   # 1. Record final merged status on the note
   znotes notes update e8b1204c-91a3-4d70-8f12-30c49a1b7e55 \
     --append "\n## Completed (2026-10-15)\nAll issues (#14, #15, #16) closed; final PR #19 merged to main."

   # 2. Mark any remaining ZNotes todo item complete
   znotes todos toggle 44556677-1111-4222-8333-444455556666 99887766-5555-4666-8777-888899990000 --status complete

   # 3. Archive the note into <project>/archive (never delete it)
   znotes notes move e8b1204c-91a3-4d70-8f12-30c49a1b7e55 --target-path "metrics-ingestor/archive"
   ```
3. **Never delete completed specification notes (`znotes notes delete` is forbidden for specs):**
   archiving preserves the architectural history for future RAG and semantic searches; deleting a
   completed spec erases why past decisions were made.
4. **Never rewrite, reformat, or restructure existing archived notes in `<project>/archive`:**
   notes already inside `<project>/archive` are immutable historical records. Even if a user asks
   to modernize, reformat, or clean up an old note in `<project>/archive` to match current PRD/SPEC
   headings, **refuse to rewrite or restructure the archived note** and explain that archived notes
   must remain untouched as historical records.

---

## Checklist before finishing

- [ ] **Write out all prescribed `znotes` and `gh` CLI commands in fenced `bash` blocks:** in your
      final reply, include the exact `znotes` and `gh` commands (with exact UUIDs, `--path`,
      `--target-path`, `--label`, and `--body-file` arguments).
- [ ] **Orientation & directory resolution:** check existing notes and directories first
      (`znotes notes list`, `znotes notes search`, `znotes dirs list`); use the ZNotes directory
      from `AGENTS.md` or default to the repository/crate name (`--path <repo-name>`).
- [ ] **Plans live in ZNotes, never `docs/`:** create PRDs and technical specs with
      `znotes notes create --path <project>`; refuse to create `docs/*.md` or `docs/<feature>/SPEC.md`
      in the repository.
- [ ] **Status checks ("where are we on X?"):** run `znotes` orientation commands and
      `gh issue list --label <feature>`, cross-check the note against `src/` (distinguishing
      implemented code from pass-through stubs and noting open questions), and prescribe
      `znotes notes update <UUID>` when the note lags behind the code.
- [ ] **Keeping specs current:** update the existing note in place (`znotes notes update <UUID>`
      with `--append`, `--content`, or `--file`) rather than calling `znotes notes create`; refuse
      to defer syncing the ZNotes spec until after a PR merges.
- [ ] **Breaking into issues:** write each issue body to a file with `write_file`, pass
      `--body-file <path>` and `--label <feature>` to `gh issue create`, include `Depends on #<N>`
      lines, and cite the ZNotes spec note by its title, UUID, and section heading (`§N`).
- [ ] **Archiving completed features:** update the note with final merged status, toggle pending
      todo items to `complete` (`znotes todos toggle <TODO_UUID> <ITEM_UUID> --status complete`),
      move the note to `<project>/archive` (`znotes notes move <UUID> --target-path "<project>/archive"`),
      never delete completed specs, and refuse to rewrite or restructure existing notes in
      `<project>/archive`.
