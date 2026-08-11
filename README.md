# Pi Coding Loop

Pi Coding Loop V1 is a thin deterministic TypeScript harness for a real coding loop: DeepSeek implements, local commands verify, and an independent read-only Kimi session reviews through Moonshot AI CN and a typed `submit_review` protocol. The harness—not either model—owns completion.

The project is currently implemented through Step 6. It contains the frozen V1 contracts, a completed real-provider Pi integration spike including context compaction, strict preflight checks, run-state/event artifacts below Git metadata, a reusable real DeepSeek Coder session, a deterministic command Verifier, the automatic Verifier → Coder feedback loop, and immutable-baseline Git change collection. Kimi Reviewer integration and the complete state machine are intentionally not implemented yet.

## Requirements

- Node.js 22 or newer
- npm
- A clean Git repository for future loop runs
- DeepSeek and Kimi credentials for real-provider checks and future loop runs

Install dependencies:

```bash
npm install
```

Copy `.env.example` values into your environment. Model IDs are required configuration and are never hard-coded:

```bash
export DEEPSEEK_API_KEY="..."
export KIMI_API_KEY="..."
export DEEPSEEK_CODER_MODEL="..."
export KIMI_REVIEWER_MODEL="..."
```

The Reviewer provider is Pi's ordinary Moonshot CN provider (`moonshotai-cn`). The current Step 0 validation uses `kimi-k2.7-code`, configured through `KIMI_REVIEWER_MODEL`. The shorter `k3` ID belongs only to the separate `kimi-coding` subscription endpoint; ordinary Moonshot K3 uses `kimi-k3` when the account has access.

## Local validation

```bash
npm run typecheck
npm test
npm run build
```

Run the real Pi integration spike:

```bash
npm run spike
```

Run the real Step 3 Coder smoke against a disposable Git fixture:

```bash
npm run spike:coder
```

Run the real Step 5 feedback-loop smoke:

```bash
npm run spike:feedback
```

With all variables configured, the spike creates a temporary fixture and uses one DeepSeek session for repeated prompts, a real manual context compaction, and a post-compaction feedback turn that repeats the immutable requirements. It also creates a separate Kimi session with only read-only tools plus `submit_review`, validates the structured review, prints Pi usage statistics, and records the results in `docs/spike-results.md`. Without credentials or model IDs it exits successfully with an explicit `SKIPPED` report; it never fakes a provider pass.

Step 2 exposes `runPreflight()` for the future CLI. It refuses non-Git or dirty repositories, missing or empty task files, missing verification commands, credentials, models, or an immutable `HEAD`. A successful preflight creates the initial `state.json` and append-only `events.jsonl` only under `<repo>/.git/pi-loop/runs/<run-id>/`.

Step 3 exposes `createDeepSeekCoder()`. It creates one in-memory Pi session with the canonical Coder system prompt and the exact `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` allowlist. The same session accepts the initial immutable task and subsequent typed feedback; Pi provider errors are raised instead of being mistaken for a completed turn.

Step 4 exposes `runVerification()`. It executes configured commands sequentially in the repository root, stops after the first failure, terminates timed-out process groups, and treats spawn failures as failed checks. Complete stdout and stderr are streamed to `<run>/verifier/<check>.log`; model-visible output is independently bounded by configured head lines, tail lines, and maximum characters.

Step 5 exposes `runCoderVerifierLoop()`. Every Coder turn is followed by deterministic verification. A failed check becomes typed `VerificationFeedback` and is automatically returned to the same Coder session with the complete immutable task requirements; the resulting change is verified again. A mechanical iteration cap prevents an unbounded partial loop, while formal STOPPED routing remains deferred to Step 9.

Step 6 exposes `collectChanges()`, `serializeChangeSetForReview()`, and `assertReviewInputWithinLimit()`. Tracked changes are diffed from the immutable startup commit, untracked text files are included in full, and binary files contribute metadata without injecting bytes. Collection never mutates the Git index. The exact serialized Reviewer input owns `totalChars`; inputs above `reviewer.maxPatchChars` fail with `review_input_too_large` instead of being truncated.

## Scope boundary

V1 has no LangGraph, database, queue, web UI, model escalation, automatic worktree creation, or automatic push/merge/deploy. Runtime artifacts live under `<repo>/.git/pi-loop/`, outside the working tree.

The next implementation step is Step 7: independent Kimi Reviewer integration.

See `docs/V1 Implementation-Ready Spec.md` for the sole implementation contract. `docs/V1 Architecture & Roadmap.md` is background only.
