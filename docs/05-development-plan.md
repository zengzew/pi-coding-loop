# V1 Development Plan

This is a non-authoritative implementation tracker. `V1 Implementation-Ready Spec.md` remains the sole V1 implementation contract.

## Current iteration: initialization through Step 2 infrastructure

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

Initialization, real Step 0 provider acceptance, Step 1 contracts, and Step 2 infrastructure are complete. No full Coder → Verifier → Reviewer loop work is included in this iteration; Step 3 DeepSeek Coder integration is next.

## Deviations

- Pi SDK 0.82.1 requires resolving a `Model` through `ModelRuntime` and passing both to `createAgentSession`; the spike follows the installed API and records this in `spike-results.md`.
- `ModelRuntime.setRuntimeApiKey()` is called with `allowNetwork: false` in the spike and preflight because Pi's remote model-catalog refresh can block startup; configured models are resolved from the packaged 0.82.1 catalog before real provider requests.
- The `tsx` CLI attempted to create an IPC socket disallowed by the execution sandbox. The package script uses `node --import tsx` instead, which executes the same TypeScript entrypoint without that IPC path.
