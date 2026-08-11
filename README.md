# Pi Coding Loop

Pi Coding Loop V1 is a thin deterministic TypeScript harness for a real coding loop: DeepSeek implements, local commands verify, and an independent read-only Kimi session reviews through Moonshot AI CN and a typed `submit_review` protocol. The harness—not either model—owns completion.

The project is currently implemented through Step 2. It contains the frozen V1 contracts, a completed real-provider Pi integration spike, strict preflight checks, and run-state/event artifacts below Git metadata. The production Coder → Verifier → Reviewer state machine is intentionally not implemented yet.

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

With all variables configured, the spike creates a temporary fixture, uses one DeepSeek session for two prompts, creates a separate Kimi session with only read-only tools plus `submit_review`, validates the structured review, prints Pi usage statistics, and records the results in `docs/spike-results.md`. Without credentials or model IDs it exits successfully with an explicit `SKIPPED` report; it never fakes a provider pass.

Step 2 exposes `runPreflight()` for the future CLI. It refuses non-Git or dirty repositories, missing or empty task files, missing verification commands, credentials, models, or an immutable `HEAD`. A successful preflight creates the initial `state.json` and append-only `events.jsonl` only under `<repo>/.git/pi-loop/runs/<run-id>/`.

## Scope boundary

V1 has no LangGraph, database, queue, web UI, model escalation, automatic worktree creation, or automatic push/merge/deploy. Runtime artifacts live under `<repo>/.git/pi-loop/`, outside the working tree.

The next implementation step is Step 3: real DeepSeek Coder integration.

See `docs/V1 Implementation-Ready Spec.md` for the sole implementation contract. `docs/V1 Architecture & Roadmap.md` is background only.
