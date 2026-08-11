# V1 Implementation-Ready Spec.md

> Project: Pi Coding Loop  
> Status: **Implementation Ready / V1 Frozen**  
> Date: 2026-08-09  
> Runtime: Pi Agent SDK  
> Coder: DeepSeek API  
> Reviewer: Moonshot AI CN Kimi API (Pi `moonshotai-cn`)  
> Orchestrator: Thin TypeScript state machine  
> Verifier: Deterministic local commands (`lint / typecheck / test / build`)

---

## 0. Purpose

This document freezes the implementation contract for V1.

V1 is intentionally narrow. It must prove that the following loop can complete real coding tasks reliably and measurably:

```text
Task
  ↓
DeepSeek Coder
  ↓
Deterministic Verifier
  ↓
failed ───────────────→ DeepSeek fixes
  ↓ passed
Kimi Independent Reviewer
  ↓
changes requested ────→ DeepSeek fixes
  ↓
Verifier
  ↓
Kimi Review
  ↓
DONE
```

The V1 hypothesis is:

> A lower-cost coding model can handle high-frequency implementation work when paired with real deterministic feedback and a separate reviewer, without requiring a heavyweight orchestration framework.

The Harness—not the Coder—owns completion.

---

# 1. Frozen Decisions

| Area | V1 Decision |
|---|---|
| Agent runtime | Pi Agent SDK |
| Language | TypeScript |
| Coder | DeepSeek API |
| Reviewer | Moonshot AI CN Kimi API |
| Coder tools | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` |
| Reviewer tools | `read`, `grep`, `find`, `ls`, `submit_review` |
| Reviewer write access | None |
| Router | Deterministic TypeScript |
| Verifier | Shell commands, no LLM |
| State DB | None |
| Run artifacts | Local files under Git metadata |
| Task input | Plain Markdown |
| Crash resume | Not supported in V1 |
| Automatic worktree creation | Not supported in V1 |
| Auto PR / push / merge / deploy | Not supported |
| LangGraph | Not used |
| Browser / visual verification | Not used |
| Model escalation | Not used |
| Multi-reviewer voting | Not used |

---

# 2. External Dependency Contract: Pi

Install:

```bash
npm install @earendil-works/pi-coding-agent
```

The implementation depends on:

```ts
createAgentSession()
AgentSession.prompt()
AgentSession.abort()
AgentSession.subscribe()
SessionManager.inMemory()
tools allowlist
customTools
defineTool()
```

Pi built-in tools relevant to V1:

```text
read
bash
edit
write
grep
find
ls
```

A read-only Reviewer session must use an explicit tool allowlist rather than relying on prompt instructions.

Conceptual shape:

```ts
const { session: coderSession } = await createAgentSession({
  cwd: repoRoot,
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  sessionManager: SessionManager.inMemory(repoRoot),
});

const { session: reviewerSession } = await createAgentSession({
  cwd: repoRoot,
  tools: ["read", "grep", "find", "ls", "submit_review"],
  customTools: [submitReviewTool],
  sessionManager: SessionManager.inMemory(repoRoot),
});
```

V1 does not depend on Pi RPC mode.

---

# 3. Step 0 — Mandatory Pi Integration Spike

Before implementing the full loop, create a minimal disposable spike.

The spike is complete only when all checks below pass with real credentials.

## 3.1 DeepSeek session

Verify:

1. A Pi session can be created with the selected DeepSeek model.
2. It can `read` a fixture file.
3. It can `edit` or `write` a fixture file.
4. `session.prompt()` can be called again with verifier-style feedback.
5. The second call retains enough context to understand the first change.
6. Usage information can be observed from Pi messages/events for the selected provider.

## 3.2 Kimi session

Verify:

1. A separate Pi session can be created with the selected Kimi model.
2. The session can use `read`, `grep`, `find`, and `ls`.
3. `write`, `edit`, and `bash` are not exposed.
4. A custom `submit_review` tool can be invoked.
5. The tool arguments are received as structured data.
6. Usage information can be observed for the selected provider.

## 3.3 Context / compaction check

Run enough messages to understand actual compaction behaviour.

V1 must not assume that old task requirements will remain perfectly recoverable after compaction.

Therefore:

> Every feedback prompt sent back to the Coder must include the immutable task requirements again.

## 3.4 Spike failure rule

If any of the following fails:

```text
DeepSeek provider resolution
Kimi provider resolution
per-session tool allowlist
custom tool invocation
repeated session.prompt()
```

stop implementation and revise the integration boundary.

Do not work around a failed Pi capability by adding hidden ad-hoc processes inside the orchestrator.

---

# 4. Provider Configuration

Required environment variables:

```bash
export DEEPSEEK_API_KEY="..."
export KIMI_API_KEY="..."
```

Model IDs are configuration, not source-code constants.

```bash
export DEEPSEEK_CODER_MODEL="..."
export KIMI_REVIEWER_MODEL="..."
```

The CLI must fail fast if either model cannot be resolved.

V1 uses Pi's built-in `moonshotai-cn` provider for the ordinary Moonshot API. The Reviewer model remains configurable; the current Step 0 validation uses `kimi-k2.7-code`. The shorter `k3` ID belongs only to Pi's separate `kimi-coding` provider; ordinary Moonshot K3 uses `kimi-k3` when the account has access. The Harness keeps `KIMI_API_KEY` as its environment contract and injects it into `moonshotai-cn` at runtime. Do not add a second independent LLM SDK directly into V1.

---

# 5. Repository Layout

```text
pi-coding-loop/
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── preflight.ts
│   ├── loop.ts
│   ├── coder.ts
│   ├── reviewer.ts
│   ├── verifier.ts
│   ├── changes.ts
│   ├── feedback.ts
│   ├── failure-signature.ts
│   ├── events.ts
│   ├── telemetry.ts
│   ├── report.ts
│   └── types.ts
├── prompts/
│   ├── coder.md
│   └── reviewer.md
├── test/
│   ├── fixtures/
│   ├── unit/
│   └── integration/
├── pi-loop.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

Run artifacts must not be stored in the working tree.

Use:

```text
<repo>/.git/pi-loop/runs/<run-id>/
```

Example:

```text
.git/pi-loop/runs/20260809T012000Z-a1b2c3/
├── state.json
├── events.jsonl
├── verifier/
│   ├── 001-npm-test.log
│   └── 002-npm-build.log
├── reviews/
│   ├── review-01.json
│   └── review-02.json
└── final-report.md
```

---

# 6. CLI Contract

Primary command:

```bash
pi-loop run task.md
```

Optional:

```bash
pi-loop run task.md --config ./pi-loop.config.ts
```

## 6.1 `task.md`

V1 task files are plain Markdown with no required frontmatter.

Example:

```md
# Task

Add optimistic concurrency protection to the account update endpoint.

## Requirements

- Reject stale updates with HTTP 409.
- Preserve the current response contract for successful updates.
- Add tests covering stale and current versions.
- Do not change unrelated API behaviour.
```

The complete Markdown file becomes the immutable `taskRequirements`.

## 6.2 CLI exit codes

```text
0   DONE
2   STOPPED due to loop/protocol/task limit
3   preflight/configuration error
130 interrupted by user
1   unexpected harness failure
```

---

# 7. Configuration Contract

Use a typed TypeScript config validated at startup.

```ts
export interface PiLoopConfig {
  coder: {
    provider: "deepseek";
    model: string;
  };

  reviewer: {
    provider: "moonshotai-cn";
    model: string;
    protocolRetries: number;
    maxPatchChars: number;
  };

  verification: {
    commands: VerificationCommand[];
    maxModelOutputChars: number;
    headLines: number;
    tailLines: number;
  };

  limits: {
    maxCoderIterations: number;
    maxReviewCycles: number;
    sameFailureLimit: number;
    maxTaskMinutes: number;
  };
}

export interface VerificationCommand {
  name: string;
  command: string;
  timeoutMs: number;
}
```

Defaults:

```text
reviewer.protocolRetries = 1
reviewer.maxPatchChars = 100000

verification.maxModelOutputChars = 30000
verification.headLines = 100
verification.tailLines = 200

limits.maxCoderIterations = 4
limits.maxReviewCycles = 2
limits.sameFailureLimit = 3
limits.maxTaskMinutes = 30
```

Invalid config must terminate before any Agent session starts.

---

# 8. Preflight Contract

Before a run starts, verify:

```text
current directory is inside a Git repository
task file exists and is non-empty
working tree is clean
configured verification commands are non-empty
required API credentials are available
configured models resolve successfully
run artifact directory can be created
```

Dirty repository behaviour:

```text
REFUSE TO START
```

Do not:

```text
stash
reset
clean
auto-commit
```

Record:

```ts
type RunBaseline = {
  repoRoot: string;
  baseCommit: string;
  branch: string | null;
};
```

`baseCommit` is immutable for the run.

---

# 9. Core State

```ts
export type RunStatus =
  | "coding"
  | "verifying"
  | "reviewing"
  | "done"
  | "stopped"
  | "interrupted";

export interface LoopState {
  runId: string;
  taskPath: string;
  taskRequirements: string;

  repoRoot: string;
  baseCommit: string;

  status: RunStatus;

  coderIteration: number;
  reviewCycle: number;

  feedback?: Feedback;

  lastVerification?: VerificationResult;
  lastReview?: ReviewResult;

  lastFailureSignature?: string;
  repeatedFailureCount: number;

  startedAt: string;
  finishedAt?: string;

  stopReason?: StopReason;
}
```

---

# 10. Feedback Contract

Use a discriminated union.

```ts
export type Feedback =
  | VerificationFeedback
  | ReviewFeedback;

export interface VerificationFeedback {
  type: "verification_failure";
  failedCheck: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  outputForModel: string;
  fullOutputPath: string;
}

export interface ReviewFeedback {
  type: "review_blockers";
  blockers: ReviewBlocker[];
}
```

Every Coder continuation:

```ts
await coderSession.prompt(
  renderCoderFeedback(taskRequirements, feedback)
);
```

The rendered feedback must repeat the full task requirements.

---

# 11. DeepSeek Coder Contract

Create one Coder session per run and reuse it.

Tools:

```text
read
bash
edit
write
grep
find
ls
```

## 11.1 Coder prompt

```text
You are the implementation agent.

Your responsibility is to implement the supplied task in the current repository.

Rules:
- Inspect the repository before changing code.
- Implement the smallest complete solution satisfying the requirements.
- Follow existing project conventions.
- Do not weaken tests or validation merely to make checks pass.
- Do not make unrelated changes.
- Treat verifier and reviewer feedback as evidence to investigate, not instructions to blindly follow.
- Preserve already-correct behaviour when fixing failures.
- Do not push, merge, deploy, release, reset, clean, stash, or rewrite Git history.
- You do not decide when the task is complete. The external harness decides completion.

When feedback is provided:
- identify the root cause;
- make the smallest correct change;
- preserve already-correct behaviour.
```

Coder claims such as `Done` have no routing authority.

After every Coder turn, the Harness runs the Verifier.

---

# 12. Verifier Contract

The Verifier contains no LLM calls.

## 12.1 Execution

Every configured command runs with:

```text
cwd = repo root
timeout = command.timeoutMs
```

Pass:

```text
exitCode === 0
```

Fail:

```text
exitCode !== 0
OR timeout
OR process spawn failure
```

Commands run sequentially.

V1 may stop after the first failed verifier command.

## 12.2 Types

```ts
export interface VerificationCheckResult {
  name: string;
  command: string;

  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;

  stdoutBytes: number;
  stderrBytes: number;

  outputForModel: string;
  fullOutputPath: string;

  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheckResult[];
  failedCheck?: VerificationCheckResult;
  durationMs: number;
}
```

## 12.3 Output truncation

Full output:

```text
.git/pi-loop/runs/<run-id>/verifier/<check>.log
```

Model-visible output:

```text
first N lines
+
"[... output truncated ...]"
+
last M lines
```

Defaults:

```text
head = 100 lines
tail = 200 lines
max chars = 30000
```

Never inject unbounded command output into model context.

---

# 13. Failure Signature Contract

```text
signature =
SHA-256(
  failed command
  + "
"
  + normalize(failure output)
)
```

Normalization:

```text
strip ANSI
CRLF → LF
absolute repo path → <REPO>
obvious date/time timestamps → <TIMESTAMP>
trim trailing whitespace
collapse >2 blank lines
apply same bounded head/tail extraction
```

Prefer:

```text
stderr if non-empty
otherwise stdout
```

Repeated failure behaviour:

```text
same signature → repeatedFailureCount++
different signature → repeatedFailureCount = 1
```

When:

```text
repeatedFailureCount >= sameFailureLimit
```

stop with:

```text
repeated_verification_failure
```

No embeddings or LLM classification in V1.

---

# 14. Change Collection Contract

At startup:

```text
baseCommit = git rev-parse HEAD
```

Tracked/committed changes:

```bash
git diff <baseCommit> -- .
```

Untracked files:

```bash
git ls-files --others --exclude-standard
```

For each untracked text file, append:

```text
=== NEW FILE: relative/path.ts ===
<file contents>
=== END NEW FILE ===
```

Do not use `git add -N .`; the Harness must not mutate the index.

```ts
export interface ChangeSet {
  baseCommit: string;
  trackedDiff: string;

  untrackedFiles: {
    path: string;
    binary: boolean;
    sizeBytes: number;
    content?: string;
  }[];

  changedPaths: string[];
  totalChars: number;
}
```

Binary files:

```text
record path + size + binary=true
do not inject bytes
```

If serialized review input exceeds:

```text
reviewer.maxPatchChars
```

V1 stops with:

```text
review_input_too_large
```

Do not silently omit arbitrary changes.

---

# 15. Kimi Reviewer Contract

Create an independent Reviewer session.

Do not pass DeepSeek's reasoning trajectory.

Reviewer context contains:

```text
full task requirements
ChangeSet
verification summary
changed path list
```

Reviewer tools:

```text
read
grep
find
ls
submit_review
```

Reviewer must not receive:

```text
bash
edit
write
```

The Harness provides the Git change set; Kimi does not execute `git diff`.

## 15.1 Reviewer prompt

```text
You are an independent code reviewer.

You did not implement this change.

Review the implementation against the supplied requirements.

Focus on:
- requirement violations;
- correctness bugs;
- regressions;
- missing important edge cases;
- unsafe or invalid assumptions;
- tests that do not actually validate the required behaviour;
- materially harmful maintainability issues.

Do not request stylistic changes unless they materially affect correctness or maintainability.

Only report issues that justify another coding iteration.

You must finish by calling submit_review exactly once.
Do not claim approval in plain text without calling submit_review.
```

---

# 16. Structured Review Protocol

Natural-language parsing is not allowed for routing.

Use custom tool:

```text
submit_review
```

## 16.1 Domain schema

```ts
export interface ReviewBlocker {
  id: string;
  file?: string;
  line?: number;
  issue: string;
  evidence: string;
  suggestedFix?: string;
}

export interface ReviewResult {
  decision: "approve" | "changes_requested";
  blockers: ReviewBlocker[];
  notes: string[];
}
```

Invariant:

```text
approve → blockers.length === 0
changes_requested → blockers.length > 0
```

Recommended implementation:

```text
TypeBox for Pi custom-tool parameters
+
Zod or explicit runtime domain validation
```

## 16.2 Protocol handling

`submit_review`:

1. validates input;
2. accepts exactly one final submission;
3. stores the valid result;
4. returns a short acknowledgement.

After Reviewer completion:

```text
valid submit_review → route normally

missing/invalid submit_review → protocol retry once

second failure → STOPPED: reviewer_protocol_error
```

Protocol failure must never be converted to approval.

---

# 17. Reviewer False Positives

There is no explicit Coder appeal protocol in V1.

If Kimi returns blockers, DeepSeek may:

```text
modify the implementation
add a validating test
leave correct behaviour unchanged after investigation
```

The next Reviewer cycle evaluates the current repository state again.

Persistent disagreement eventually stops through `maxReviewCycles`.

This is intentional V1 behaviour.

---

# 18. State Machine

```text
START
  ↓
CODING
  ↓
VERIFYING
  ├── fail → CODING
  └── pass → REVIEWING
                ├── changes_requested → CODING
                └── approve → DONE
```

Canonical pseudo-code:

```ts
while (true) {
  assertWithinGlobalLimits(state);

  state.status = "coding";
  persistState(state);

  await coder.run({
    taskRequirements: state.taskRequirements,
    feedback: state.feedback,
  });

  state.coderIteration++;

  state.status = "verifying";
  persistState(state);

  const verification = await verifier.run();
  state.lastVerification = verification;

  if (!verification.passed) {
    updateFailureSignature(state, verification);
    state.feedback = toVerificationFeedback(verification);

    if (shouldStop(state)) return stopRun(state);
    continue;
  }

  state.repeatedFailureCount = 0;
  state.lastFailureSignature = undefined;

  const changes = await collectChanges(state.baseCommit);

  if (changes.totalChars > config.reviewer.maxPatchChars) {
    return stopRun(state, "review_input_too_large");
  }

  state.status = "reviewing";
  persistState(state);

  const review = await reviewer.run({
    taskRequirements: state.taskRequirements,
    changes,
    verification,
  });

  state.reviewCycle++;
  state.lastReview = review;

  if (review.decision === "approve") {
    return completeRun(state);
  }

  state.feedback = {
    type: "review_blockers",
    blockers: review.blockers,
  };

  if (shouldStop(state)) return stopRun(state);
}
```

---

# 19. Stop Conditions

Defaults:

```text
maxCoderIterations = 4
maxReviewCycles = 2
sameFailureLimit = 3
maxTaskMinutes = 30
```

## DONE

Only:

```text
latest deterministic verification passed
AND
latest Reviewer result == approve
```

## STOPPED reasons

```ts
export type StopReason =
  | "max_coder_iterations"
  | "max_review_cycles"
  | "max_task_time"
  | "repeated_verification_failure"
  | "reviewer_protocol_error"
  | "review_input_too_large"
  | "required_access_unavailable"
  | "environment_failure"
  | "configuration_error";
```

STOPPED means the Harness cannot prove completion within the V1 contract.

---

# 20. Timeouts and Cancellation

`maxTaskMinutes` is a global wall-clock limit.

Verifier commands also have per-command timeouts.

On global timeout:

1. abort active Pi session if applicable;
2. terminate active verifier child process;
3. persist state;
4. emit `run_stopped`;
5. generate final report.

On `Ctrl+C`:

```text
status = interrupted
exit code = 130
```

V1 does not resume interrupted runs.

---

# 21. Events Contract

`events.jsonl` is append-only.

```ts
export interface RunEvent<T = unknown> {
  eventId: string;
  runId: string;
  type: RunEventType;
  timestamp: string;
  data?: T;
}
```

Event types:

```ts
export type RunEventType =
  | "run_started"
  | "coder_started"
  | "coder_completed"
  | "verification_completed"
  | "review_started"
  | "review_completed"
  | "feedback_sent"
  | "run_completed"
  | "run_stopped"
  | "run_interrupted";
```

Do not log:

```text
API keys
auth headers
provider credentials
```

Large process output is referenced by path, not duplicated into events.

---

# 22. Telemetry Contract

Record:

## Coder

```text
provider
model
LLM calls/messages
input tokens
output tokens
cache read/write tokens when available
reported cost when available
coder iterations
```

## Reviewer

```text
provider
model
LLM calls/messages
input tokens
output tokens
cache read/write tokens when available
reported cost when available
review cycles
```

## Harness

```text
verifier runs
failed checks
repeated failure count
duration
final status
stop reason
changed file count
```

Use Pi/provider-reported usage and cost when available.

If monetary cost is unavailable:

```text
cost = unknown
```

Do not silently estimate cost using stale hard-coded prices.

---

# 23. Final Report

Write:

```text
.git/pi-loop/runs/<run-id>/final-report.md
```

Minimum content:

```md
# Pi Coding Loop Run

## Result
Status: DONE
Task: task.md
Run: <run-id>

## Baseline
Base commit: abc123
Branch: feature/example

## Coder
Provider: DeepSeek
Model: ...
Iterations: 3
Input tokens: ...
Output tokens: ...
Reported cost: ...

## Verifier
- lint: PASS
- typecheck: PASS
- test: PASS
- build: PASS

## Reviewer
Provider: Kimi
Model: ...
Review cycles: 1
Decision: approve
Input tokens: ...
Output tokens: ...
Reported cost: ...

## Changes
Changed files: 6
Untracked/new files: 2

## Timing
Started: ...
Finished: ...
Duration: ...

## Stop Reason
N/A
```

STOPPED/INTERRUPTED reports must include the last verification/review summary.

---

# 24. Security Boundary

V1 is approved only for:

```text
trusted repositories
human-started runs
clean dedicated branch/worktree
no production credentials
no production mutation
```

Pi Coder `bash` executes with local user privileges.

Forbidden automatic actions:

```text
push
merge
deploy
release
production database mutation
destructive infrastructure change
external irreversible action
```

Prompt restrictions are not a security sandbox.

Sandboxing is deferred beyond V1.

---

# 25. Test Strategy

## 25.1 Unit tests

Required:

```text
config validation
failure normalization
failure signature stability
output truncation
ReviewResult invariants
Feedback rendering
stop-condition ordering
event serialization
change collection
untracked-file collection
```

Important cases:

```text
same error with different timestamp → same signature
same error with different repo path → same signature
different command → different signature
approve + blockers → invalid
changes_requested + zero blockers → invalid
```

## 25.2 Integration tests

Use a small fixture Git repo.

### A — Verifier feedback loop

Assert:

```text
Coder called
Verifier fails
typed feedback created
same Coder session called again
```

### B — Review feedback loop

Assert:

```text
Verifier passes
Reviewer changes_requested
Coder receives ReviewFeedback
Verifier runs again
Reviewer runs again
```

### C — DONE

Assert:

```text
Verifier passes
Reviewer approves
status == done
exit code == 0
```

### D — Repeated failure

Assert:

```text
equivalent failure repeats
limit reached
status == stopped
reason == repeated_verification_failure
```

### E — New file review visibility

Assert:

```text
untracked file appears in ChangeSet
Reviewer input includes it
```

### F — Reviewer protocol failure

Assert:

```text
Reviewer fails to call submit_review
one retry
then reviewer_protocol_error
```

---

# 26. End-to-End Acceptance Criteria

V1 is complete only when:

1. `pi-loop run task.md` starts from a clean Git repo.
2. DeepSeek modifies the repo through Pi.
3. Deterministic verification runs automatically.
4. Verification failure returns automatically to the same Coder session.
5. Original task requirements are repeated on each Coder feedback turn.
6. Verifier output is bounded in context and fully stored on disk.
7. Equivalent repeated failures are detected.
8. Passing verification triggers Kimi Review.
9. Kimi uses an independent session without write/edit/bash.
10. Kimi must submit a valid review through `submit_review`.
11. Review blockers feed automatically back to DeepSeek.
12. Post-review changes are verified again.
13. Kimi approval is accepted only after passing verification.
14. New/untracked files are included in Reviewer input.
15. Loop/time limits terminate deterministically.
16. DONE requires `verification passed && reviewer approved`.
17. STOPPED never masquerades as DONE.
18. State/events live outside the Git working tree.
19. Token usage is recorded where available.
20. Final report is generated automatically.
21. No manual copy/paste is needed between Coder, Verifier, and Reviewer.

---

# 27. Implementation Sequence

## Step 0 — Pi integration spike

Prove:

```text
DeepSeek session
Kimi session
session.prompt() reuse
tool allowlists
submit_review custom tool
usage visibility
```

## Step 1 — Contracts

Implement:

```text
config
LoopState
Feedback
VerificationResult
ReviewResult
events
stop reasons
```

## Step 2 — Preflight + run artifacts

Implement:

```text
clean Git check
baseline commit
run ID
.git/pi-loop/runs/
state.json
events.jsonl
```

## Step 3 — DeepSeek Coder

Success:

```text
task → Pi/DeepSeek → repo change
```

## Step 4 — Deterministic Verifier

Implement:

```text
commands
timeouts
full logs
bounded context output
```

## Step 5 — Verifier → Coder loop

```text
Coder → Verify → FailureFeedback → Coder
```

## Step 6 — Change collection

Implement:

```text
baseCommit diff
untracked files
ChangeSet
review size guard
```

## Step 7 — Kimi Reviewer

Implement:

```text
independent read-only session
submit_review
protocol retry
```

## Step 8 — Reviewer → Coder loop

```text
ReviewFeedback
re-verify
re-review
```

## Step 9 — Stop conditions

Implement:

```text
iteration limits
review limits
global timeout
failure signatures
interrupt handling
```

## Step 10 — Telemetry + report

Implement run metrics and final report.

## Step 11 — Dogfood

Run 5–10 real coding tasks.

Do not expand scope during dogfood unless fixing a V1 correctness defect.

---

# 28. Implementation Rule

If a detail is not explicitly specified:

> choose the simplest deterministic implementation that satisfies this contract.

Do not introduce:

```text
LangGraph
database
queue
web dashboard
new agent roles
dynamic routing
automatic escalation
persistent memory
```

without a new version decision.

---

# 29. Post-V1 Iteration Plan

## V1.1 — Evaluation

Create 10–20 representative coding tasks.

Measure:

```text
success rate
human correction rate
cost per successful task
duration
coder iterations
review cycles
regressions
```

## V1.2 — Ablation

Compare:

```text
A: DeepSeek only
B: DeepSeek + Verifier
C: DeepSeek + Verifier + Kimi Reviewer
```

## V1.3 — Reliability

Add:

```text
automatic worktrees
crash recovery
durable sessions
resume
stronger process cleanup
```

## V1.4 — Sandbox

Add container/VM isolation for:

```text
filesystem
network
credentials
CPU/memory/time
```

## V1.5 — Cost Optimization

Optimize:

```text
review context
review frequency
cache behaviour
token budgets
cost budgets
```

## V1.6 — Model Escalation

Only after evaluation proves need:

```text
DeepSeek
↓ repeated unresolved blocker
stronger Coder
```

## V1.7 — Remote Agent Machine

Move to always-on machine and add private remote access.

## V1.8 — Browser / Visual Verification

For UI tasks:

```text
code
→ build
→ render
→ browser/screenshot observation
→ review
```

## V1.9 — Human Approval

Add explicit gates for high-risk changes.

## V2 — Graph Engineering

Consider LangGraph or another graph orchestrator only when real requirements include:

```text
parallel reviewers
fan-out/fan-in
human interrupts
durable checkpoints
external events
multiple conditional branches
long-running workflows
```

---

# 30. Core Principles

## 30.1 Real verification beats model opinion

```text
Can it compile? → build it
Do tests pass? → run them
Does type checking pass? → execute typecheck
```

## 30.2 Reviewer is low-frequency and high-value

Kimi reviews only after deterministic checks pass.

## 30.3 Reviewer and Coder are independent

Kimi receives:

```text
requirements
actual changes
actual verification evidence
read-only repository access
```

not the Coder reasoning trajectory.

## 30.4 Every loop must acquire new evidence

Good:

```text
change → real failure → fix
change → new patch → independent blocker → fix
```

Bad:

```text
think again → reread same information → optimize again
```

## 30.5 Completion is a Harness decision

```text
DONE =
latest deterministic verification passed
AND
latest structured Kimi review approved
```

---

# Appendix A — Suggested `submit_review` Tool Shape

Illustrative only; use the installed Pi SDK's exact types.

```ts
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export const ReviewResultToolSchema = Type.Object({
  decision: Type.Union([
    Type.Literal("approve"),
    Type.Literal("changes_requested"),
  ]),
  blockers: Type.Array(
    Type.Object({
      id: Type.String(),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      issue: Type.String(),
      evidence: Type.String(),
      suggestedFix: Type.Optional(Type.String()),
    })
  ),
  notes: Type.Array(Type.String()),
});
```

Domain validation must additionally enforce the decision/blocker invariant.

---

# Appendix B — Suggested Preflight Output

```text
Pi Coding Loop V1

Repository: /repo/example
Branch: feature/example
Base commit: a1b2c3d
Task: task.md

Coder:
  provider: deepseek
  model: <resolved>

Reviewer:
  provider: moonshotai-cn
  model: <resolved>

Verifier:
  lint       npm run lint
  typecheck  npm run typecheck
  test       npm test
  build      npm run build

Limits:
  coder iterations: 4
  review cycles: 2
  repeated failure: 3
  task timeout: 30m

Preflight: PASS
Run: <run-id>
```

---

# Appendix C — Pi References

Pi-specific assumptions were checked against current documentation on 2026-08-09:

- SDK: https://pi.dev/docs/latest/sdk
- Providers: https://pi.dev/docs/latest/providers
- Sessions: https://pi.dev/docs/latest/sessions
- Session format: https://pi.dev/docs/latest/session-format

The spec intentionally does not freeze model IDs or provider prices because they may change independently of the Harness.
