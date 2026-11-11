---
name: interview-me
description: >
  Turns underspecified or buzzword-heavy requests into clear decisions before building: reading
  workspace files first so facts in existing code and conventional defaults are never asked;
  implementing directly with zero questions when a request is already specified; asking 2–4
  high-impact product or architectural trade-off questions per round with a Recommended option and
  one-line trade-off first; probing behind convention-signaling asks to find the real bottleneck;
  stopping once remaining unknowns have sensible defaults; and summarizing settled decisions (with
  chosen defaults and non-goals) to record in ZNotes via znotes notes update/create instead of
  repository docs/ files (linking planning). Use for "interview me", "grill me", "help me figure
  out what I want", "what clarifying questions do you have?", or vague feature requests. Not for
  clear bug fixes, unit tests (rust-testing), PR reviews (pr-review), or opening PRs.
---

<!--
SPDX-License-Identifier: Apache-2.0

Original skill text for this repository. Batched recommendation-first interviewing and ZNotes
decision-recording conventions are derived from how this repository's specification was settled
("Skills Collection — Specification", Decisions resolved 2026-10-11). Ideas on probing behind
convention-signaling requests ("want vs. should want") and explicit out-of-scope restatements
are adapted in original words from Addy Osmani's interview-me skill
(https://github.com/addyosmani/agent-skills/blob/main/skills/interview-me/SKILL.md,
Copyright (c) Addy Osmani, MIT License).
-->

# Clarifying underspecified requests before building (`interview-me`)

The cheapest time to discover that a feature request is missing a core product or architectural
decision is before writing code. Equally important, **over-asking is a failure**: asking the user
about details already present in the codebase, asking about standard engineering defaults, or
manufacturing questions when a request is already clear wastes turns and stalls implementation.

This skill governs **when to interview vs. when to build immediately**, **how to filter out
questions already answered by the codebase or conventional defaults**, **how to format a focused
round of 2–4 recommendation-first questions**, **how to probe behind convention-signaling or
buzzword requests**, and **when to stop and record settled decisions in ZNotes (handing off to the
`planning` skill)**.

## Find what applies

| Situation | Section |
|---|---|
| Vague or underspecified feature request ("build me X", "help me figure out what I want", "interview me on the requirements") | [1. Inspect the codebase first & classify every unknown](#1-inspect-the-codebase-first--classify-every-unknown) and [2. Question format: 2–4 grouped questions with Recommended first](#2-question-format-24-grouped-questions-with-recommended-first) |
| Request is already clear and specified (even if the user asks "what clarifying questions do you have before coding?") | [When Bucket 3 is empty: do not interview—implement immediately](#when-bucket-3-is-empty-do-not-interviewimplement-immediately) |
| Request names heavy infrastructure or buzzwords ("split into a microservice", "put a Kafka bus in front of X", "make it cloud-native") | [3. Probe behind convention-signaling requests](#3-probe-behind-convention-signaling-requests) |
| Core trade-offs are answered and only minor details remain ("interview me on the rest or lock in the decisions") | [4. Stop once defaults suffice & record decisions in ZNotes](#4-stop-once-defaults-suffice--record-decisions-in-znotes) |

---

## 1. Inspect the codebase first & classify every unknown

### Read workspace files before formulating any question

Before deciding whether to ask a single question, read the relevant files in the workspace:
`AGENTS.md` / `CLAUDE.md`, `Cargo.toml` / `package.json`, any ZNotes snapshot or existing notes,
and the source modules (`src/lib.rs`, `src/config.rs`, domain types, constants, and error enums).

- **Why:** Asking a user what data structures exist, how wire messages are formatted, or what
  configuration constants are set when those exact definitions are already in `src/` forces the
  user to read their own codebase back to you.

### Partition every potential question into three buckets

After reading the workspace files, classify every apparent unknown into one of three buckets:

1. **Bucket 1 — Already settled by the codebase or existing notes:**
   Existing structs and fields, wire/header constants, auth schemes, timeout or capacity values in
   config types, error variants, and ZNotes directory paths (`--path <project>`).
   - **Rule:** **Never ask the user to decide anything in Bucket 1**—even if the user's prompt
     explicitly lists those topics as things to interview them about.
   - **Required in your reply:** Include an explicit **`### Already Settled from the Codebase`**
     section naming the exact files, structs/fields, constants, and config values you read so the
     user sees why those topics are excluded from the interview.

2. **Bucket 2 — Conventional engineering defaults:**
   Standard implementation choices that do not change product behavior or external contracts—such
   as temp-file naming conventions, decimal formatting precision, log-rotation intervals,
   connection-pool sizing, boundary index handling, or internal module layout.
   - **Rule:** **Never ask the user about Bucket 2 items.** Pick concrete, idiomatic defaults,
     state them under **`### Assumed Conventional Defaults`**, and move on.

3. **Bucket 3 — High-impact product or architectural trade-offs only the user can decide:**
   Choices where two reasonable designs produce materially different software—such as who the
   feature is for and what decision it supports, delivery surface (CLI/TUI vs. HTTP JSON vs. HTML
   UI), synchronous caller blocking vs. background execution, durability vs. dropping on failure,
   or multi-tenant routing and filtering rules.
   - **Rule:** **Interview only on Bucket 3 decisions.** While Bucket 3 has unresolved decisions,
     **do not write or modify source files (`src/...`)**—present your codebase findings and your
     focused question round first.

### When Bucket 3 is empty: do not interview—implement immediately

When the user's request and the existing codebase already specify the function signature, input
and output types, error variants, and core behavior (leaving only Bucket 1 facts and Bucket 2
conventional edge cases):

- **Never manufacture questions just because the user invited them.** Users often ask for an
  interview out of habit (*"Ask me whatever you need before starting"* or *"Feel free to grill me
  first"*) even when their specification is already complete. Asking invented questions on a clear
  spec is over-asking.
- **Required workflow when the request is already specified:**
  1. **Explicitly state that no interview or clarifying questions are needed** because the
     requirements, types, constants, and bounds/error behavior are already specified by the prompt
     and `src/`.
  2. **State any minor conventional edge-case defaults** you are adopting directly (for example,
     how an empty collection or exact boundary index behaves).
  3. **Ask zero clarifying questions** and **write the implementation to the target source file
     (`write_file`) in the same turn.**

---

## 2. Question format: 2–4 grouped questions with Recommended first

When genuine Bucket 3 trade-offs exist, ask a single, bounded round of questions following these
rules:

### Batch 2 to 4 questions per round, grouped by decision area

- **Always ask between 2 and 4 clarifying questions in a round**—never a single isolated question
  when 2–4 related decisions can be settled together, and **never 5 or more questions** (do not hide
  extra questions as multi-part bullets inside numbered items).
- **Why 2–4 questions:** One-at-a-time questioning turns three related architectural choices into a
  slow multi-turn ping-pong, while dumping 5+ questions mixes minor trivia with core trade-offs and
  causes skim-reading. If more than 4 unknowns exist, ask the 2–4 highest-leverage ones that unlock
  or eliminate the rest.

### Put an explicit `Recommended` option and one-line trade-off first on every question

Every clarifying question in your reply must lead with a concrete recommended default marked with
**`Recommended:`** (or **`(Recommended)`**), followed by a one-line trade-off and the main
alternative(s):

- **Why:** Reacting to a concrete recommendation with an explicit trade-off takes seconds and
  exposes hidden assumptions immediately; open-ended questions (*"How should storage work?"*) push
  all design synthesis onto the user. Leading with `Recommended:` lets the user accept the whole
  batch in one line (*"Defaults look good"*) or override a single item (*"Use the alternative on
  #2, recommended for #1 and #3"*).

### Question round template

Use this structure when interviewing on an underspecified request:

```markdown
### Already Settled from the Codebase
- **`src/lib.rs` (`<StructName>`, `<CONST_NAME>`):** <what the existing types, fields, and functions already define>.
- **`src/config.rs` (`<ConfigStruct>`):** <what timeout, header, or limit defaults are already configured>.

### Assumed Conventional Defaults
- <1–2 minor engineering defaults you will apply without asking, e.g., JSON wire encoding, standard error propagation, or boundary behavior>.

### Open Decisions (2–4 Questions)

1. **<Decision Area 1 — e.g., Primary Audience & Delivery Surface>**
   <One-sentence question asking what changes what gets built?>
   - **Recommended:** <Concrete option A> — *Trade-off:* <one line explaining why this fits the current crate and what it trades off>.
   - **Alternative:** <Concrete option B> — *Trade-off:* <one line explaining when to pick this instead>.

2. **<Decision Area 2 — e.g., Failure Handling & Durability>**
   <One-sentence question?>
   - **Recommended:** <Concrete option A> — *Trade-off:* <one line explaining the benefit vs. cost>.
   - **Alternative:** <Concrete option B> — *Trade-off:* <one line explaining when to pick this instead>.

3. **<Decision Area 3 — e.g., Scope & Retention / Filtering>**
   <One-sentence question?>
   - **Recommended:** <Concrete option A> — *Trade-off:* <one line explaining the benefit vs. cost>.
   - **Alternative:** <Concrete option B> — *Trade-off:* <one line explaining when to pick this instead>.
```

---

## 3. Probe behind convention-signaling requests

Users frequently ask for a heavy architectural pattern—*"split this into a gRPC microservice"*,
*"put a Kafka event bus in front of the ingestion handler"*, *"add multi-region read replicas"*, or
*"make this service cloud-native"*—because that pattern is a familiar industry convention, not
because they have verified that the current code needs it.

- **Why you must not take convention-signaling framing at face value:** If you immediately ask 5
  questions about broker partition counts, service mesh mTLS, and consumer-group rebalancing for a
  crate that currently processes bounded in-memory inputs synchronously, you lock the project into
  unnecessary operational complexity without ever checking what bottleneck the user is actually
  trying to solve.

### How to handle buzzword or heavy-infrastructure requests

1. **Read `src/` first and cite the codebase's current baseline:**
   Explicitly name the existing functions, data structures, and scale constants in `src/lib.rs`
   (including any documented limits or typical workload sizes in the crate) so the reply grounds
   the conversation in what the code does today.
2. **Probe the concrete bottleneck, scale target, or user outcome in Question 1:**
   Ask what specific failure mode, latency target, or workload volume is driving the request rather
   than only asking how to configure the proposed external infrastructure.
3. **Recommend a simpler in-process or streaming design first on every question:**
   In your 2–4 questions, lead each question's **`Recommended:`** option with the simplest
   architecture that solves the problem inside the existing crate (such as synchronous in-process
   execution, streaming responses, or bounded in-memory state), stating the one-line trade-off and
   naming the heavier external infrastructure as the **`Alternative:`** for when cross-node state
   or decoupled background execution is truly required.

---

## 4. Stop once defaults suffice & record decisions in ZNotes

### Stop interviewing as soon as only conventional defaults remain

Stop asking questions the moment the high-impact Bucket 3 trade-offs are resolved and the
remaining open items are Bucket 2 conventional engineering defaults (such as temp-file naming
patterns, decimal formatting precision, log-rotation intervals, or standard tuning parameters).

- **Why:** Grinding through extra rounds for minor engineering parameters wastes the user's attention
  on decisions that have well-known defaults.
- **Even when the user explicitly asks whether another interview round is needed** for remaining
  minor details (e.g., *"We haven't decided the temp-file naming pattern or the decimal precision
  for latency summaries yet—interview me on those, or lock in the decisions"*), **stop
  interviewing immediately**:
  - State explicitly that **no further interview questions are needed** because the core product
    and architectural trade-offs are settled and the remaining items have sensible defaults.
  - **Ask zero follow-up questions.**
  - Select and state concrete default values for every remaining minor item yourself.

### Output a structured Decision Summary (including Non-Goals)

When locking in decisions after an interview round, present a structured summary with three
mandatory sections:

1. **Confirmed Decisions (`### Confirmed Decisions`):** Every major decision settled by the user,
   stating the chosen option and the trade-off/behavior it locks in.
2. **Selected Conventional Defaults (`### Selected Conventional Defaults`):** Concrete, specific
   values for every remaining minor engineering item mentioned in the thread (for example, exact
   flag names like `--listen-addr` and `--max-batch`, exact numeric levels or precision, and exact
   retry base/max delays and jitter strategy). Never leave these as a vague phrase like *"use
   sensible defaults for the rest"*.
3. **Explicit Non-Goals / Out of Scope (`### Non-Goals / Out of Scope`):** What the design
   explicitly excludes (such as filtered-out event classes, unsupported transports, or deferred
   external services), because silent disagreement on non-goals is a primary source of scope creep.

### Record settled decisions in ZNotes (never in repository `docs/` files)

**All settled interview decisions, intent summaries, product requirements (PRDs), and technical
specifications belong in ZNotes (`--path <project>`), following the `planning` skill—never in
repository `docs/` files (`docs/intent/*.md`, `docs/*.md`, or `SPEC.md`).**

- **Why ZNotes instead of `docs/`:** Recording decisions in ZNotes makes them searchable across
  sessions via `znotes notes search` and `znotes notes ask` without polluting git commits or pull
  request diffs with markdown files.
- **Refuse requests to write `docs/intent/<topic>.md` or `docs/<topic>.md`:**
  If the user asks you to save locked-in decisions to `docs/intent/<name>.md` (or any path under
  `docs/`), **explicitly refuse to create the `docs/` file**, state that settled decisions and
  specifications live in ZNotes (`--path <project>`, per the `planning` skill) rather than in
  repository `docs/` files, and **do not write any file under `docs/`**.
- **Include the exact `znotes` CLI command in a fenced `bash` block:**
  1. Resolve `--path <project>` from `AGENTS.md` / `CLAUDE.md` first, or default to the
     repository/crate name.
  2. If an existing ZNotes specification note is present for the feature (check `notes-snapshot.md`
     or run `znotes notes list --path <project>` / `znotes notes search`), update that existing
     note **in place by its UUID** using `znotes notes update <UUID>` (with `--append`,
     `--content`, or `--file`) to record a dated `## Decisions Resolved` section:
     ```bash
     # Record the settled interview decisions on the existing ZNotes specification note
     znotes notes update <NOTE_UUID> \
       --append "\n## Decisions Resolved (YYYY-MM-DD)\n- <Decision 1>\n- <Decision 2>\n- <Conventional defaults & non-goals>"
     ```
  3. If no ZNotes note exists yet for the feature, create one with
     `znotes notes create --path <project> --title "<Feature> — Decisions & Specification"` and
     hand off to the `planning` skill to expand the full specification and break it into GitHub
     issues.

---

## Checklist before finishing

- [ ] **Read workspace files first:** inspect `AGENTS.md`, `Cargo.toml`, any ZNotes snapshot, and
      `src/` files before deciding whether or what to ask.
- [ ] **Clear requests skip interviewing completely:** if the prompt and `src/` already specify the
      types, signature, and behavior, explicitly state that no interview is needed, note any minor
      conventional defaults, ask **zero questions**, and implement the code in `src/` immediately.
- [ ] **No code changes during an active interview round:** when genuine Bucket 3 trade-offs remain
      open, do not write or modify files under `src/` before the user answers.
- [ ] **State what the codebase already settles:** list existing structs, fields, wire/signature
      constants, and config timeouts under `### Already Settled from the Codebase` and never ask the
      user to re-decide them.
- [ ] **2 to 4 questions per round, `Recommended` first:** keep every question batch strictly to
      2–4 questions, and start every question with `**Recommended:** <option> — *Trade-off:* <one
      line>` followed by `**Alternative:**`.
- [ ] **Probe convention-signaling asks:** when the user asks for heavy infrastructure or buzzwords,
      cite the current synchronous/in-memory baseline in `src/lib.rs`, ask what concrete bottleneck
      or scale target drives the request, and recommend a simpler in-process or streaming option
      first.
- [ ] **Stop when only conventional defaults remain & record in ZNotes:** ask zero follow-up
      questions once core trade-offs are settled, state concrete values for all remaining minor
      defaults plus explicit `### Non-Goals / Out of Scope`, refuse to write `docs/intent/*.md` or
      any repository `docs/` file (citing ZNotes and the `planning` skill), and include the exact
      `znotes notes update <UUID>` (or `znotes notes create --path <project>`) command.
