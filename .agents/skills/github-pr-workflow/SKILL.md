---
name: github-pr-workflow
description: >
  Workflow for taking work from a GitHub issue to a pull request: splitting oversized work
  (>400–500 production lines, >2 endpoints/subcommands, read+write ops, or multi-layer changes)
  into sub-issues with Depends on #N; self-contained issues with feature labels and spec
  references; picking up an issue after checking merged dependencies; pre-PR production diff
  checks; --body-file/--input payloads; Closes #N and implementation notes in PR descriptions;
  triaging every review comment against the code, project docs and external docs as accept,
  reject or needs human input, asking with context and a recommendation before changing
  anything, and replying to each thread; github-pr-reviewer loops (--comment when the author
  cannot self-approve); and never running gh pr merge. Use for "open a PR", "file issues for
  this", "pick up issue #N", "address the review comments", or "which review comments are
  right?". Not for reviewing someone else's PR (use pr-review) or standalone commit messages.
---

# GitHub issue-to-PR workflow

This skill governs how work moves from a GitHub issue to a reviewed pull request ready for a
human maintainer to merge: sizing changes so every PR stays reviewable, writing issues and PR
descriptions that a fresh session can act on without guesswork, passing markdown payloads safely
through files, running iterative review rounds, and stopping before merge.

Always-on repository rules—exact build/test/lint commands, license headers, commit trailer rules
(such as no `Co-Authored-By`), and whether committing or pushing requires prior user confirmation—
live in each project's `AGENTS.md` or `CLAUDE.md`. Follow the project's `AGENTS.md` for those
policies alongside this workflow.

## Find what applies

| Situation | Section |
|---|---|
| Assigned an issue or feature request ("pick up issue #N", "implement #N") | [1. Pre-flight scope check & picking up an issue](#1-pre-flight-scope-check--picking-up-an-issue) |
| Issue is too large for a single PR | [Splitting an oversized issue before writing code](#splitting-an-oversized-issue-before-writing-code) |
| Filing GitHub issues for a feature or remaining phases ("file issues for this") | [2. Filing self-contained GitHub issues](#2-filing-self-contained-github-issues) |
| Opening or updating a pull request ("open a PR") | [3. Verifying the diff & opening a pull request](#3-verifying-the-diff--opening-a-pull-request) |
| Addressing PR review feedback ("address the review comments"), or deciding which comments to accept, reject or ask about | [4. Multi-round review loop](#4-multi-round-review-loop) |
| `gh pr review --approve` fails with `Can not approve your own pull request` | [Recording subagent approval when the author token is active](#recording-subagent-approval-when-the-author-token-is-active) |

---

## 1. Pre-flight scope check & picking up an issue

Before creating a branch or writing any implementation code for an issue or feature request,
evaluate its scope and check its dependencies.

### PR production size ceiling

Keep every pull request under **500 lines of production code diff**, targeting **200–400 lines**
of production changes per PR.

- **Test files and generated lockfiles do not count** toward the 500-line ceiling (`*_tests.rs`,
  `tests/`, `*.test.ts`, `*.spec.ts`, `Cargo.lock`, `package-lock.json`, `pnpm-lock.yaml`).
  Excluding tests from the ceiling ensures thorough test coverage is never penalized, while
  capping production code keeps diffs small enough for a reviewer to catch subtle bugs and makes
  reverts clean.

### Splitting an oversized issue before writing code

Before branching or editing source files in `src/`, check whether the issue triggers any of these
oversized-scope signals:

1. **More than two distinct CLI subcommands or API/REST endpoints** in a single issue.
2. **Both read-only queries and mutating operations** combined in one change.
3. **Changes across multiple architectural layers at once** (for example, persistence/database +
   service/domain layer + CLI or frontend UI).
4. **An estimated production code diff exceeding 400–500 lines** (excluding tests and lockfiles).

**When an issue hits any of these triggers:**
- **Stop before writing implementation code or creating a monolithic branch.** Do not write the
  feature into `src/` first and offer to split later—untangling a monolithic working tree wastes
  turns and risks broken intermediate states.
- **Cite the production diff size ceiling** (target 200–400 lines, maximum 500 lines of production
  code diff excluding tests and lockfiles) and the specific scope triggers the issue hits.
- **Propose a decomposition plan** that splits the work into focused sub-issues (one layer or
  vertical slice per sub-issue), ordered with explicit `Depends on #<N>` links showing the
  implementation sequence.
- **Ask the user for confirmation before creating the sub-issues or writing code**, since the
  maintainer may have context that justifies an exception or prefers a different split. Once
  confirmed, file the sub-issues and implement one sub-issue per PR.

### Picking up a well-scoped issue (and checking `Depends on #<N>`)

When an issue fits within the single-PR ceiling (200–400 target, ≤500 production lines), run
these pre-flight steps before writing code:

1. **Verify all `Depends on #<N>` issues are closed/merged:** if the issue lists dependencies
   (e.g. `Depends on #7`, `Depends on #8`), inspect each dependency with `gh issue view <N>` to
   confirm it is closed and its PR has been merged before starting work.
2. **Read the PRs that closed the dependency issues for implementation context:** architectural
   decisions, non-obvious trade-offs, and helper patterns introduced during implementation are
   recorded in **pull request descriptions**, not in issue comments. Run `gh issue view <N> --json closedByPullRequestsReferences`
   or `gh pr view <PR>` (or `gh pr list --search "closes #<N>" --state merged`) to read the
   closing PR descriptions of every dependency issue before coding.
3. **Branch from an up-to-date `main` namespaced by feature:** check out `main`, pull the latest
   changes, and create a branch namespaced under the issue's feature label (`feat/<feature>/<task>`):
   ```bash
   # Verify dependency issues are closed and read their closing PR descriptions
   gh issue view 7 --json state,closedByPullRequestsReferences
   gh pr view 10 --json title,body

   # Update main and create a feature-namespaced branch
   git checkout main && git pull
   git checkout -b feat/search-index/query-tokenizer
   ```

---

## 2. Filing self-contained GitHub issues

When breaking down a specification or filing issues for the remaining phases of a feature, write
each issue so a fresh agent session can pick it up and implement it without asking for
clarification.

1. **Apply a shared feature label (`--label <feature>`):** every feature has a GitHub label
   matching its specification subdirectory name under `docs/<feature>/` (for example,
   `docs/search-index/SPEC.md` uses `--label search-index`). Check existing issues with
   `gh issue list --label <feature>`, create the label first if it does not exist
   (`gh label create <feature>`), and pass `--label <feature>` (or `-l <feature>`) on every
   `gh issue create` command for that feature.
2. **Reference specs by file path and section heading:** point to the specification document by
   exact path and section (e.g., `See docs/search-index/SPEC.md §2 ("## 2. Token Normalization")`)
   rather than copying the entire specification into every issue body. If the spec is updated
   later, path-and-section references stay accurate while pasted copies go stale.
3. **Include context, constraints, and acceptance criteria:** alongside the spec path and section
   reference, include the relevant architectural context, constraints, and a concrete checklist
   of acceptance criteria so the implementing session knows exactly what "done" means.
4. **Declare explicit `Depends on #<N>` lines:** state every prerequisite issue at the top of the
   body using the exact `Depends on #<N>` syntax (including already-completed foundation issues
   and earlier phases in the sequence) so implementation order is unambiguous.
5. **Pass every issue body via `--body-file <path>`:** write each issue's markdown body to a
   file and pass `--body-file <path>` (or `-F <path>`) to `gh issue create`. Never pass multiline
   markdown or backticks inline via `--body "..."` (or `$(cat <<EOF ...)` inside `--body`),
   because shell interpolation and quote escaping across bash, zsh, and PowerShell corrupt code
   spans and flags.

### Issue body template & `gh issue create` example

Write each issue body to a scratch file (e.g. `issue-phase-2.md`):

```markdown
Label: `search-index`
Depends on #7

## Context
See `docs/search-index/SPEC.md` §2 (`## 2. Token Normalization`). Issue #7 added the core
`DocumentToken` types in `src/lib.rs`; this issue implements the normalization pipeline stage.

## Constraints
- Normalization must allocate at most once per token and preserve byte offsets into the source line.
- Do not modify the public fields of `DocumentToken` introduced in #7.

## Acceptance Criteria
- [ ] `normalize_tokens` lowercases ASCII letters and strips surrounding punctuation while keeping original byte spans.
- [ ] Empty tokens after stripping punctuation are filtered out.
```

Then create the label (if needed) and file the issue with `--body-file` and `--label`:

```bash
gh label create search-index --description "Search index feature" --force
gh issue create \
  --title "search-index: add token normalization stage" \
  --label search-index \
  --body-file issue-phase-2.md
```

---

## 3. Verifying the diff & opening a pull request

### Step 1: Run project checks and the pre-PR production diff gate

Before opening a pull request (`gh pr create`):

1. **Run the automated checks defined in the project's `AGENTS.md` / `CLAUDE.md`** (such as
   `cargo test`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt`, or
   frontend test/lint/format/build scripts) and fix any failures.
2. **Run the pre-PR production diff verification command** against `origin/main`, excluding test
   files and lockfiles:
   ```bash
   git diff --shortstat origin/main -- . ':!*test*' ':!*tests*' ':!package-lock.json' ':!Cargo.lock'
   ```
3. **Enforce the 500-line production diff gate:**
   - Calculate the **production code additions** separately from test files (`*_tests.rs`,
     `tests/`, `*.test.*`) and lockfiles (`Cargo.lock`, `package-lock.json`).
   - If production code additions exceed **500 lines** (even if the overage only appears once test
     files and lockfiles are separated from the total diff), **do not run `gh pr create` yet**.
     Pause and **ask the user for confirmation**, presenting the production diff line count vs.
     total diff line count and either proposing how to split the changes into separate PRs or
     asking whether an exception is justified.

### Step 2: Write the PR description to a file and pass `--body-file`

Write the PR description to a file (e.g. `pr-body.md`) and pass it to `gh pr create` via
`--body-file <path>` (never inline `--body "..."`):

- **Use a GitHub auto-closing keyword (`Closes #<N>`, `Fixes #<N>`, or `Resolves #<N>`):**
  GitHub only auto-closes the linked issue on merge when one of its exact closing keywords is
  present. Never write `Implements #<N>` or `Addresses #<N>`, which leave the issue open after
  the PR merges.
- **Put implementation details in the PR description, never in issue comments:** record key
  architectural decisions, non-obvious trade-offs, and patterns introduced in the PR description
  (do not run `gh issue comment <N>` to post implementation notes on the issue). Future sessions
  working on dependent issues read closing PR descriptions for implementation context.
- **Include a `## Testing` section with unverified manual steps marked as not yet manually tested:**
  list the automated checks that passed, and if any verification requires manual action outside
  the headless session (such as clicking through an OAuth browser consent redirect, signing in
  with Google/Slack, or checking a live UI layout), list the step-by-step manual verification
  procedure under `## Testing` and **explicitly mark those steps as not yet manually tested** so
  the human reviewer knows to run them before merging.

### PR description template & `gh pr create` example

```markdown
Closes #10

## Summary & Implementation Notes
- Added `normalize_tokens` in `src/normalizer.rs` using a single-pass ASCII slice scanner so
  unmodified tokens borrow directly before allocating.
- Kept `SpanOffset` byte indices anchored to the original input buffer so downstream highlighter
  callers from #7 need no offset translation.

## Testing
- Automated checks passed:
  - `cargo test`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo fmt --check`
- Manual verification (**not yet manually tested**):
  - [ ] **Not yet manually tested:** Start the dev server, initiate the OAuth sign-in redirect in a browser, approve the workspace consent screen, and verify the callback redirects to `/settings/connected` with a stored token.
```

```bash
git diff --shortstat origin/main -- . ':!*test*' ':!*tests*' ':!package-lock.json' ':!Cargo.lock'
gh pr create \
  --base main \
  --title "feat(search-index): add token normalization stage" \
  --body-file pr-body.md
```

---

## 4. Multi-round review loop

Once the pull request is open, delegate review to the `github-pr-reviewer` subagent (or respond
to human review comments) in an iterative loop. A review comment is a claim about the code, not
an order: reviewers misread code, misremember APIs, and ask for things the spec rules out. Each
round goes **triage → decide → implement → reply → re-review**, and your workflow and final
summary **must explicitly include every step below**.

### Step 1: Triage every comment before changing code

1. **Read all the feedback first**: the review body and every inline comment, with its ID
   (`gh pr view <PR> --comments`, `gh api repos/<owner>/<repo>/pulls/<PR>/comments`,
   `gh api repos/<owner>/<repo>/pulls/<PR>/reviews`).
2. **Check each comment against evidence**, in this order, and keep what you found:
   - **the code** at the PR head: does the problem the comment describes actually happen?
     Trace it through the function, and the tests if there are any;
   - **the project's documentation**: `AGENTS.md`, the spec (ZNotes note or repo file), the
     issue the PR closes. A comment that asks for behavior the spec rules out is wrong for this
     PR, however reasonable it sounds;
   - **external documentation**, when the comment makes a claim about a language feature,
     library, API or protocol (std docs, docs.rs, the RFC). Look the claim up rather than
     trusting either the reviewer's memory or yours.
3. **Classify each comment** as exactly one of:
   - **Accept**: the evidence shows the comment is right and the change belongs in this PR.
   - **Reject**: the evidence shows the comment is wrong, or the spec or `AGENTS.md` addresses
     this exact case and rules the change out. A rejection always names its evidence (the line
     of code, the spec section, the doc page and what it says).
   - **Needs human input**: the evidence doesn't settle it. Typical cases are a product or
     behavior choice the spec doesn't cover, a change to a public API or to what existing data
     means, a trade-off between two reasonable designs, or a request that contradicts the spec
     where the spec itself may be what's wrong. Don't resolve these yourself: picking one quietly
     makes a product decision the maintainer never saw.

   For example, a reviewer who writes "`HashMap` iteration is sorted, so this `sort()` is
   redundant" is rejected with the std docs (iteration order is arbitrary). One who writes
   "should a deleted user's comments be deleted or anonymized?" needs a human: the code can do
   either, and the choice is about users, not correctness.

   Silence is not a ruling. If the spec never mentions the case a comment raises, don't stretch
   a general sentence into an answer and reject on it: nobody decided that case yet, so it
   needs a human. The same goes when the reviewer asks "do we want this?" or the change would
   alter what existing data, files or API calls mean. Whichever way it goes, that decision is
   the maintainer's.

### Step 2: Ask, or implement

- **If any comment needs human input, stop before changing code.** Implementing the accepted
  comments first means a second, mixed commit when the answer arrives, and the answer may change
  how the accepted fixes should look. Present the full triage, then ask. Each question must stand
  on its own, because the person answering may not have the PR open:
  - the comment, quoted, with its author and the file and line;
  - what the code does today, and what the spec or docs say (or that they are silent);
  - the options, and what each one means for callers, users or existing data;
  - **your recommendation and the reason for it**.

  Ask all the open questions together, then wait for the answers before Step 3.
- **When no comment needs human input**, implement every accepted comment and nothing else:
  rejected suggestions stay out of the code.

### Step 3: Implement, check, push

1. **Implement the accepted changes** in the working tree, with tests for changed behavior.
2. **Run the project's automated test, lint, and format checks** before committing, and fix any
   warnings or failures.
3. **Commit and push an incremental update commit** to the PR branch (following the project's
   `AGENTS.md` on commit conventions and whether pushing requires prior confirmation).

### Step 4: Reply to every comment

Every comment gets an answer, rejected ones included; a silent rejection reads as an ignored
comment and comes back next round.

- **Reply to each inline comment in its own thread**, so the answer sits next to the code it is
  about: `gh api repos/<owner>/<repo>/pulls/<PR>/comments/<comment_id>/replies -F body=@<file>`.
  For comments in the review body or conversation, post one `gh pr comment <PR> --body-file <path>`
  that answers each point in turn.
- **Accepted:** say what changed and in which commit.
- **Rejected:** give the evidence: the code path, the spec section, or the doc link and what it
  says. Keep it factual; the reviewer can still disagree in the thread.
- **Needs human input, now decided:** say what was decided and by whom.
- **Write every reply to a file and pass `--body-file`, `-F body=@<file>` or `--input`:** use
  `write_file` to create each reply file (e.g. `pr-<PR>-reply-<comment_id>.md`). **Never use
  `--body` or `-b` on any `gh pr comment` or `gh pr review` command, or `-f body=` on `gh api`,
  anywhere in your response.**

### Step 5: Re-review until approval

1. **Mandatory—re-engage the `github-pr-reviewer` subagent for a follow-up review round:**
   `github-pr-reviewer` is an in-session subagent (invoked via your subagent tool after pushing
   the fix and posting the replies—do **not** post a second `gh pr comment --body "@github-pr-reviewer ..."`).
   Tell it which comments you rejected and why, so it weighs your evidence instead of repeating
   the comment.
2. **Repeat the review loop until explicit approval (never self-approve or merge):** state
   explicitly in your workflow output that this iterative loop (`triage → fix → run checks → commit & push → reply via files → re-engage github-pr-reviewer subagent`) **repeats until `github-pr-reviewer` explicitly grants approval**, and that you must **never self-approve** the PR or run `gh pr merge`:
   ```bash
   cargo test
   cargo clippy --workspace --all-targets -- -D warnings
   cargo fmt --check
   git add src/lib.rs src/lib_tests.rs
   git commit -m "fix(normalizer): handle trailing ASCII whitespace"
   git push origin HEAD
   gh api repos/acme/normalizer/pulls/22/comments/5531/replies -F body=@pr-22-reply-5531.md
   gh api repos/acme/normalizer/pulls/22/comments/5534/replies -F body=@pr-22-reply-5534.md
   # Next: re-engage the github-pr-reviewer subagent to review the updated PR branch,
   # and repeat this loop until github-pr-reviewer explicitly approves (never run gh pr merge).
   ```

### Recording subagent approval when the author token is active

When the `github-pr-reviewer` subagent runs in a sandbox without direct `gh` CLI access and
returns an `APPROVED` verdict to you, attempting to submit `gh pr review <PR> --approve` with a
GitHub token belonging to the PR author fails with:

```text
GraphQL: Review Can not approve your own pull request
```

When this happens:
1. **Always write a new review comment body file using `write_file`** (e.g.
   `pr-<PR>-approval-comment.md`)—even if the subagent's report already exists in a workspace
   file—and **quote the comment body text in your final reply**. The written comment body must
   explicitly state that the **`github-pr-reviewer` subagent reviewed and approved the PR**
   (`Verdict: APPROVED`) along with its verification summary.
2. Submit that written file as a comment review using `--comment` and `--body-file`:
   ```bash
   gh pr review 22 --comment --body-file pr-22-approval-comment.md
   ```
3. **Stop and report to the user—never merge.**

### Never auto-merge (`gh pr merge` is strictly forbidden)

Never run or prescribe `gh pr merge` under any circumstances—even when all CI checks pass, the
`github-pr-reviewer` subagent has approved the PR, or the user's prompt asks to "wrap up" or
"merge it once created". Merging pull requests is exclusively reserved for the human maintainer.
Once the PR is open and approved, report the PR link, summary of changes, and verification status
to the user, and stop.

---

## Checklist before finishing

- [ ] **Include all prescribed `git` and `gh` commands in your final reply:** in file-editing-only
      environments, write out the exact `git` and `gh` CLI commands in fenced `bash` blocks in your
      final message alongside any written body files.
- [ ] **Pre-flight scope check:** if the issue exceeds ~400–500 production lines, spans multiple
      layers, mixes read queries and mutations, or adds >2 subcommands/endpoints, stop before
      coding, cite the 200–400 target / 500-line production diff ceiling (excluding tests and
      lockfiles), propose sub-issues with `Depends on #<N>`, and ask the user for confirmation.
- [ ] **Picking up an issue with `Depends on #<N>`:** verify via `gh` that all dependency issues
      are closed/merged, read the PR descriptions that closed them (`gh pr view`) for
      implementation context, and branch off updated `main` (`git checkout main && git pull`)
      under `feat/<feature>/<task>`.
- [ ] **Filing issues:** write each body to a file, pass `--body-file <path>` and
      `--label <feature>` to `gh issue create`, include explicit `Depends on #<N>` lines, and
      reference `docs/<feature>/SPEC.md` by file path and section heading alongside context,
      constraints, and acceptance criteria.
- [ ] **Pre-PR diff gate:** run `git diff --shortstat origin/main -- . ':!*test*' ':!*tests*' ':!package-lock.json' ':!Cargo.lock'`
      before `gh pr create`; if production code additions exceed 500 lines, pause and ask the user
      for confirmation before opening the PR.
- [ ] **PR description & payloads:** pass all issue, PR, and review bodies via `--body-file <path>`
      or `--input <path>` (never inline `--body` or `-b`); use `Closes #<N>` / `Fixes #<N>` /
      `Resolves #<N>` (never `Implements #<N>`); keep implementation notes in the PR description
      (never in `gh issue comment`); and list unverified manual test steps under `## Testing`
      marked as **not yet manually tested**.
- [ ] **Review triage:** check every review comment against the code, the project's docs and
      spec, and external docs for API claims; classify each as accept, reject (with its
      evidence) or needs human input; if any needs human input, change nothing yet and ask with
      the quoted comment, current behavior, what the spec says, the options and their effects,
      and a recommendation with its reason; otherwise implement only the accepted comments.
- [ ] **Replies:** answer every comment, rejected ones included, inline ones in their own thread
      (`gh api .../pulls/<PR>/comments/<id>/replies -F body=@<file>`): what changed for accepted
      comments, the evidence for rejected ones.
- [ ] **Review loop & never merge:** after pushing review fixes and replying via `--body-file`,
      re-engage the `github-pr-reviewer` subagent (not via a second `--body` comment) and state
      that the loop repeats until `github-pr-reviewer` explicitly approves (never self-approving);
      for author-token subagent approvals, write a new comment body file with `write_file` (and
      quote it in your reply) stating `github-pr-reviewer` approved the PR and submit with
      `gh pr review <PR> --comment --body-file <path>`; **never run or prescribe `gh pr merge`**.
