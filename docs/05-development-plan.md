# V1 Development Plan

This is a non-authoritative implementation tracker. `V1 Implementation-Ready Spec.md` remains the sole V1 implementation contract.

## Current iteration: Step 0 closure through Step 10 report and CLI

| Task | Status | Evidence |
|---|---|---|
| TASK-000 — Establish document roles and root `AGENTS.md` | Completed | Authoritative spec and background roadmap are separated; repository rules define precedence. |
| TASK-001 — Initialize minimal Node.js/TypeScript tooling | Completed | Locked npm dependencies, strict TypeScript config, build/test/spike scripts. |
| TASK-002 — Implement configuration and core typed contracts | Completed | V1 defaults, validation, typed feedback, ChangeSet, state, events, review invariants. |
| TASK-003 — Add canonical Coder and Reviewer prompts | Completed | Prompt files preserve frozen tool/behavior boundaries. |
| TASK-004 — Implement disposable real Pi integration spike | Completed | Pi 0.82.1 model resolution, `moonshotai-cn` Reviewer, offline catalog refresh, separate sessions, exact tool allowlists, typed `submit_review`, repeated prompt, usage observation. |
| TASK-005 — Add initialization-level tests and documentation | Completed | Eight unit tests plus README and spike result report. |
| TASK-006 — Exercise real DeepSeek and Kimi providers | Completed | DeepSeek session reuse and usage PASS. Moonshot CN `kimi-k2.7-code` resolution, Reviewer allowlist, typed `submit_review`, and usage visibility all PASS. |
| TASK-007 — Implement Step 2 preflight and run artifacts | Completed | Clean Git/task/config/credential/model/baseline gates, immutable baseline, run IDs, `.git/pi-loop/runs/` state and append-only events, plus nine temporary-Git integration tests. |
| TASK-008 — Close the Step 0 context-compaction acceptance gap | Completed | Real `session.compact()` emitted the expected manual start/end events, produced a provider-backed summary, retained the same session, and the next feedback repeated immutable requirements and changed the fixture correctly. |
| TASK-009 — Implement Step 3 DeepSeek Coder integration | Completed | One reusable Pi/DeepSeek session uses the canonical system prompt and exact Coder tool allowlist, routes initial requirements and typed feedback, surfaces provider errors, and changed only the requested file in a real temporary-Git smoke run. |
| TASK-010 — Implement Step 4 deterministic Verifier | Completed | Configured commands run sequentially in the repo root with per-command timeouts, first-failure short-circuiting, streamed full logs, bounded model output, byte counts, durations, and normalized spawn failures. |
| TASK-011 — Implement Step 5 Verifier → Coder feedback loop | Completed | Each Coder turn is verified, failed checks become typed `VerificationFeedback`, the complete immutable task is repeated to the same Coder session, fixes are re-verified, and a real DeepSeek smoke completed fail → feedback → fix → pass. |
| TASK-012 — Implement Step 6 Git change collection | Completed | Tracked changes are diffed from immutable `baseCommit`; ignored files are excluded; untracked text is serialized in full; binary files carry path/size metadata only; exact character limits fail closed without index mutation. |
| TASK-013 — Implement Step 7 independent Kimi Reviewer | Completed | Production Reviewer uses the canonical prompt, exact read-only tool allowlist, validated `submit_review`, one configurable protocol retry, provider error propagation, and complete task/change/verification context. |
| TASK-014 — Implement Step 8 Reviewer → Coder loop | Completed | Review blockers become typed feedback for the same Coder session; every fix is re-verified, recollected, and re-reviewed; approval requires a passing latest verification. |
| TASK-015 — Implement Step 9 stop conditions and state machine | Completed | Persistent state/events, normalized SHA-256 failure signatures, repeated failure detection, coder/review/global limits, active-stage cancellation, stable STOPPED reasons, and INTERRUPTED handling are implemented. |
| TASK-016 — Implement Step 10 telemetry, report, and CLI | Completed | `pi-loop run task.md`, config loading, stable exit codes, SIGINT, provider usage/cost telemetry, review JSON artifacts, and automatic final reports are wired to the production state machine. |

Implementation through Step 10 is complete. Step 11 real-task dogfood is next and remains outside this iteration.

## Deviations

- Pi SDK 0.82.1 requires resolving a `Model` through `ModelRuntime` and passing both to `createAgentSession`; the spike follows the installed API and records this in `spike-results.md`.
- `ModelRuntime.setRuntimeApiKey()` is called with `allowNetwork: false` in the spike and preflight because Pi's remote model-catalog refresh can block startup; configured models are resolved from the packaged 0.82.1 catalog before real provider requests.
- The `tsx` CLI attempted to create an IPC socket disallowed by the execution sandbox. The package script uses `node --import tsx` instead, which executes the same TypeScript entrypoint without that IPC path.
- The current Step 7–10 implementation turn had no provider credentials or model IDs in its shell, so production-path DeepSeek+Kimi dogfood was not rerun. Deterministic protocol/state/CLI gates passed; earlier Step 0 and Step 5 reports remain the provider evidence until Step 11.
