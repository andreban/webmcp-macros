---
name: pr-review
description: >
  Reviews pull requests and code diffs: reading project standards (AGENTS.md, CONTRIBUTING.md,
  .agents/rules/), linked issues (gh issue view), PR metadata and diffs (gh pr view --json, gh pr
  diff), and full files at the PR head SHA (git show <headRefOid>:<path> or gh api .../contents/
  <path>?ref=<headRefOid>) first; checking correctness, error handling, security, deleted or
  missing tests, and module boundaries before style; proposing concrete structural remedies and
  code fixes; labeling inline comments by severity (Critical:/Required: vs Nit:/Optional:) on exact
  lines; choosing a calibrated verdict (APPROVE or COMMENT on nits, REQUEST_CHANGES for blockers);
  submitting once via gh api .../reviews --input <file> or gh pr review --body-file <file>; and
  never running gh pr merge. Use for "review PR #N", "look over this diff", or "is this ready to
  merge". Not for authoring PRs or addressing feedback as the author (use github-pr-workflow),
  writing test suites, or standalone refactoring.
---

<!--
SPDX-License-Identifier: Apache-2.0

Original skill text for this repository. Review axes, severity prefix conventions, and structural
remedy concepts are adapted in original words from Addy Osmani's code-review-and-quality skill
(https://github.com/addyosmani/agent-skills/tree/main/skills/code-review-and-quality, MIT License,
Copyright (c) 2025 Addy Osmani) and andreban/znotes (.agents/agents/github-pr-review/agent.md).
-->

# Pull request review

A pull request review protects code health without blocking progress over personal taste. Good
reviews start by loading the context a diff hunk leaves out (the project's own rules, the issue the
PR claims to solve, and the surrounding file at the PR head commit), judge high-leverage risks
first (correctness, security, test regressions, and module boundaries before style), attach
actionable feedback to the exact lines affected with clear severity labels, and submit a single
review with a calibrated verdict—never merging the PR on the maintainer's behalf.

## Find what applies

| Stage / Situation | Section |
|---|---|
| Starting a review ("review PR #N", "look over this diff") | [1. Context-first investigation](#1-context-first-investigation) |
| Deciding what to flag and how to treat `AGENTS.md` rules or carve-outs | [2. What to look for & project standards](#2-what-to-look-for--project-standards) |
| Formatting inline comments, severity labels, and structural remedies | [3. Inline feedback, severity labels & tone](#3-inline-feedback-severity-labels--tone) |
| Choosing `APPROVE` / `COMMENT` / `REQUEST_CHANGES` and submitting via `gh` | [4. Verdict calibration & single review submission](#4-verdict-calibration--single-review-submission) |

---

## 1. Context-first investigation

Three-line diff hunks hide invariants defined earlier in the file, acceptance criteria from the
linked issue, and repository-specific conventions. Complete your investigation before drafting any
review comments:

1. **Read repository standards first (`AGENTS.md`, `CONTRIBUTING.md`, `.agents/rules/*.md`):**
   check the repository root (and relevant subdirectories) for project guidelines before judging
   the code. Project rules override generic defaults in both directions:
   - **Enforce project-specific requirements** that standard linters do not check by default (for
     example, a rule in `AGENTS.md` that every unit test must return `Result` and propagate errors
     with `?` instead of calling `.unwrap()`, or that lint suppressions must use
     `#[expect(<lint>, reason = "...")]` rather than `#[allow(<lint>)]`).
   - **Respect explicit project carve-outs and legacy exceptions:** if `AGENTS.md` states that an
     existing pattern or legacy module (such as legacy synchronous I/O in a compatibility file or
     legacy test assertions) is intentional and must not be flagged as a regression when a PR only
     updates imports or constants nearby, **do not flag that legacy code or place an inline comment
     asking to rewrite it**.
2. **Inspect PR metadata, the diff, and the linked issue:**
   read the PR metadata (`gh pr view <PR> --json number,title,body,baseRefName,headRefName,headRefOid,author,state`
   or any `pr-<PR>.json` in the workspace) and the diff (`gh pr diff <PR>` or `pr-<PR>.diff`).
   When the PR description links an issue (such as `Closes #<M>` or `Fixes #<M>`), inspect the
   issue (`gh issue view <M>` and any `issue-<M>.md` file) and verify every acceptance criterion
   against the implementation.
3. **Read the full file at the PR head commit SHA (`<headRefOid>`):**
   diff hunks omit constants, unit conventions (such as millisecond vs. second struct fields),
   helper functions, and error types defined outside the hunk. Always read the full changed files
   in the workspace and **always include a `### Investigation Commands` fenced `bash` block in your
   final reply** showing the exact CLI commands to inspect the PR metadata, any linked issue, the
   diff, and the full changed file(s) at `<headRefOid>`:
   ```bash
   gh pr view <PR> --repo <owner>/<repo> --json number,title,body,baseRefName,headRefName,headRefOid,author,state
   gh issue view <ISSUE> --repo <owner>/<repo>
   gh pr diff <PR> --repo <owner>/<repo>
   git show <headRefOid>:<path/to/file>
   gh api repos/<owner>/<repo>/contents/<path/to/file>?ref=<headRefOid>
   ```

---

## 2. What to look for & project standards

Evaluate changes in order of impact. Never bury a panic bug, security vulnerability, or deleted
regression test underneath minor naming suggestions.

### Priority 1: Correctness, error handling & safety
- **Does the code fulfill the linked issue's requirements?** Check every status code, boundary
  condition, unit conversion (e.g., seconds vs. milliseconds), and cap or threshold specified in
  the issue or surrounding module constants.
- **No panics introduced in library or production paths:** flag `.unwrap()`, `.expect()`,
  unchecked indexing, or overflowing bit shifts (`1 << n`) added in library/service code where a
  malformed input can trigger a runtime panic. Show how to propagate the error via `Result` (`?`
  or `.map_err(...)`).
- **Off-by-one and boundary errors:** compare `<` vs `<=` and `>` vs `>=` against canonical
  constants and existing helpers in the codebase.

### Priority 2: Security & untrusted input boundaries
- **Injection vulnerabilities:** flag SQL queries, shell commands, or paths built with string
  interpolation (`format!`, string concatenation) instead of parameterized queries / bound
  parameters.
- **Log forging and control-character injection:** when formatting structured logs (such as JSONL
  audit lines) or HTTP headers from user-supplied strings, verify that raw newlines (`\n`, `\r`)
  and null bytes (`\0`) are rejected or stripped so untrusted input cannot forge extra records.
- **Secrets and auth checks:** ensure tokens, credentials, and PII are never logged or hardcoded.

### Priority 3: Test coverage & silent test erosion
- **Flag deleted or weakened tests:** inspect test file diffs carefully. If a PR deletes or
  overwrites an existing regression test (for example, replacing a negative-input test with a
  happy-path test instead of keeping both), flag the deleted test on the exact lines in the test
  file and require restoring it.
- **Verify tests cover new behavior and follow `AGENTS.md`:** check that new branches and error
  paths have tests and that those tests follow the repository's test conventions (such as
  returning `Result` and avoiding `.unwrap()` when required by `AGENTS.md`).

### Priority 4: Architecture, module boundaries & structural remedies
- **Keep feature/domain logic out of shared low-level utilities:** if a PR bolts domain-specific
  business rules (such as subscription tiers, billing delinquency, or auth policy) into a shared,
  domain-agnostic utility module, or duplicates a threshold check that already has a canonical
  helper in a domain module, flag it.
- **Propose the concrete structural move, not just the complaint:** telling an author "this
  violates separation of concerns" or "this is complex" leaves them guessing. Name the exact
  remedy: which module owns the logic and which existing canonical function or type to reuse.

### Priority 5: Readability & style nits (non-blocking)
- Flag typos in doc comments, overly verbose local variable names, redundant intermediate copies,
  or unnecessary trailing `return` statements only as **non-blocking** nits (`Nit:` / `Optional:`).

---

## 3. Inline feedback, severity labels & tone

### Place every file- or line-specific finding as an inline comment
Every finding, question, or suggestion that applies to a specific file and line—whether it is a
blocking bug, a security vulnerability, a deleted test, an `AGENTS.md` violation, a module-boundary
issue, **or a minor non-blocking style nit**—**must be placed in the `comments` array of the
review JSON payload** with its exact `path`, `line`, `"side": "RIGHT"`, and `body`. Never list
line-specific findings only in the top-level review summary `body`.

- **`path`:** relative path from the repository root (for example `"src/lib.rs"`, never prefixed
  with `workspace/<crate>/`).
- **`line`:** integer line number in the new version of the file at `headRefOid` (`"side": "RIGHT"`).
  Compute `line` from the unified diff header `@@ -old_start,old_len +new_start,new_len @@` (the
  first line inside the hunk is `new_start`, incrementing by 1 for each context `" "` or added
  `"+"` line and not incrementing for deleted `"-"` lines) and verify against the full file. Anchor
  `line` directly on the offending statement or function signature (not on a preceding `///` doc
  comment or closing `}`). When flagging a deleted test in a test file, anchor `line` to the line
  in the updated test file where the removed test stood (and `"side": "RIGHT"`).
- **No artificial praise comments on lines:** never create inline line comments just to praise a
  line of code. Put positive observations in the top-level summary `body`.

### Prefix every inline comment with an explicit severity label
Start every inline comment's `body` with a severity label so the author immediately knows what
blocks merging versus what is optional:

| Prefix | Meaning | When to use |
|---|---|---|
| `Critical:` | Blocking | Security vulnerabilities (SQL/log injection), panics (`.unwrap()`) in library code, data corruption, or broken core requirements |
| `Required:` (or `[blocking]`) | Blocking | Deleted regression tests, missing issue requirements, module-boundary leaks, duplicated canonical logic, or mandatory `AGENTS.md` rule violations |
| `Nit:` (or `[nit]`) | Non-blocking | Doc-comment typos, verbose local variable names, redundant local copies, or trailing `return` statements |
| `Optional:` / `Consider:` | Non-blocking | Minor readability or ergonomic suggestions that the author may freely skip |

### Explain *why* and include a concrete code fix
Every inline comment must state:
1. **Severity prefix** (`Critical:`, `Required:`, `Nit:`, or `Optional:`).
2. **Why it matters** (the failure mode, security risk, or specific `AGENTS.md` / issue rule).
3. **A concrete replacement code snippet or structural move** the author can apply directly.

### Keep the top-level summary `body` concise—no empty boilerplate sections
Write a short, direct 1–3 sentence executive summary in the top-level `body`. **Never** pad the
review summary with empty category headings or filler checklists such as `"Security: No issues"`,
`"Performance: N/A"`, or `"Readability: Looks good"`. Omit categories that have no findings.

---

## 4. Verdict calibration & single review submission

### Calibrating the review verdict (`event`)
Choose the review event based strictly on whether any **blocking** (`Critical:` or `Required:`)
findings exist:

- **`"REQUEST_CHANGES"` (`--request-changes`):** use when—and **only** when—there is at least one
  blocking finding (`Critical:` or `Required:`).
- **`"APPROVE"` (`--approve`) or `"COMMENT"` (`--comment`):** use when the PR is functionally
  correct, satisfies the issue and `AGENTS.md`, and has either zero issues or **only non-blocking
  nits (`Nit:`, `Optional:`, `Consider:`)**. Never request changes over formatting, naming,
  doc-comment typos, or minor style nits: blocking a sound PR over nits stalls delivery and trains
  authors to treat preferences as mandates. When approving a PR that has minor nits, set
  `"event": "APPROVE"` (or `"COMMENT"`) in the JSON payload and include the `Nit:` / `Optional:`
  inline comments in `comments`.

### Single finalized submission via file payload (`--input` or `--body-file`)
Complete your entire analysis first, write the review payload to a file using `write_file` (for
example `workspace/<repo>/pr-<PR>-review.json`), and submit the review in **one single `gh`
command**. Never pass review bodies or comments inline via `--body "..."` or `-f body=...` (shell
quoting corrupts backticks and code blocks), and never submit multiple separate review calls or
placeholder/test reviews.

#### Standard submission (whenever any inline comments exist—blocking or `Nit:`)
Write the JSON payload to a file with `write_file` and submit via the GitHub Pull Request Reviews
API:

```json
{
  "commit_id": "<headRefOid>",
  "event": "REQUEST_CHANGES",
  "body": "Requesting changes for a panic risk on malformed headers and a missing regression test.",
  "comments": [
    {
      "path": "src/cache.rs",
      "line": 31,
      "side": "RIGHT",
      "body": "Critical: `.unwrap()` on `ttl_header.parse::<u64>()` panics in library code when a caller passes a non-numeric header. Propagate `CacheError::InvalidTtl` via `Result`:\n```rust\nlet ttl_secs: u64 = ttl_header\n    .trim()\n    .parse()\n    .map_err(|_| CacheError::InvalidTtl(ttl_header.to_string()))?;\n```"
    },
    {
      "path": "src/cache.rs",
      "line": 44,
      "side": "RIGHT",
      "body": "Nit: Trailing `return Ok(true);` is redundant at the end of the function; `Ok(true)` can be returned as the final expression."
    }
  ]
}
```

```bash
gh api repos/<owner>/<repo>/pulls/<PR>/reviews --input workspace/<repo>/pr-<PR>-review.json
```

**Mandatory in your final reply:** whether the verdict is `"REQUEST_CHANGES"`, `"APPROVE"`, or
`"COMMENT"`, **always** write out the complete `gh api repos/<owner>/<repo>/pulls/<PR>/reviews --input <file>`
command (including the `--input <file>` flag and path) inside a fenced `bash` block in your final
message—never abbreviate it in prose as "(submitted via GitHub API)".

#### Summary-only submission (only when zero inline comments exist)
If a clean PR has no line-specific comments at all, write the summary markdown to a file with
`write_file` and submit once with `gh pr review`:

```bash
gh pr review <PR> --repo <owner>/<repo> --approve --body-file workspace/<repo>/pr-<PR>-review.md
```

### Never merge (`gh pr merge` is strictly forbidden)
A reviewer's role ends at submitting the review verdict. **Never run or prescribe `gh pr merge`**,
and **never modify `pr-<PR>.json` or repository source files** to mark a pull request as merged,
even if the PR is clean and approved or the user prompt says "and merge the PR if it's ready to
land". Explicitly tell the user that merging pull requests is reserved for the human maintainer.

---

## Checklist before finishing

- [ ] **Context gathered first:** read `AGENTS.md` (enforcing its rules and respecting its legacy
      carve-outs), `pr-<PR>.json`, any linked `issue-<M>.md`, `pr-<PR>.diff`, and the full changed
      files; include `gh issue view` and `git show <headRefOid>:<path>` (or
      `gh api repos/<owner>/<repo>/contents/<path>?ref=<headRefOid>`) in your workflow commands
      when context outside the diff hunk is needed.
- [ ] **Write the review payload file with `write_file`:** save the complete JSON review payload
      (with `commit_id`, `event`, concise `body` free of empty boilerplate sections, and `comments`
      array) to a new file under `workspace/` and include both the payload and the single
      `gh api repos/<owner>/<repo>/pulls/<PR>/reviews --input <file>` command in your final reply.
      Do not overwrite `pr-<PR>.json` or source files.
- [ ] **Every finding is an inline comment with a severity prefix and fix:** each item in
      `comments` has repo-relative `path`, exact integer `line`, `"side": "RIGHT"`, a severity
      prefix (`Critical:`, `Required:`, `Nit:`, or `Optional:`), the reason it matters, and a
      concrete code fix or structural move.
- [ ] **Calibrated verdict & no merge:** use `"REQUEST_CHANGES"` only when `Critical:` or
      `Required:` blockers exist; use `"APPROVE"` or `"COMMENT"` when only `Nit:` / `Optional:`
      items remain; and explicitly refuse to run `gh pr merge`.
