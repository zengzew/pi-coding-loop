# Pi Coding Loop Repository Instructions

## Sources of truth

- `docs/V1 Implementation-Ready Spec.md` is the only authoritative implementation specification for V1. Read it completely before changing architecture, behavior, contracts, or scope.
- `docs/V1 Architecture & Roadmap.md` is non-authoritative background. It explains motivation and possible future directions; it must not override the Implementation-Ready Spec.
- If the two documents conflict, follow the Implementation-Ready Spec and note the conflict rather than blending the designs.

## Working rules

- Implement only the current requested step from the V1 sequence. Do not pull roadmap features into V1.
- Choose the simplest deterministic implementation satisfying the frozen contract.
- Keep the orchestrator as thin TypeScript. Do not add LangGraph, databases, queues, web UI, model escalation, or automatic worktree/push/merge/deploy behavior.
- Preserve typed domain contracts. In particular, feedback must remain a discriminated union and reviewer routing must use validated `submit_review` data, never parsed prose.
- Store run artifacts only below `<repo>/.git/pi-loop/`; never place them in the working tree.
- Never commit credentials. Keep `.env.example` to variable names only.
- Do not weaken tests or verification to make a change pass.
- Do not stash, reset, clean, rewrite history, push, merge, deploy, or release as an automatic implementation step.

## Validation

For non-provider changes, run:

```bash
npm run typecheck
npm test
npm run build
```

Run `npm run spike` only when the required provider credentials and model IDs are configured. A missing-credential run must report `SKIPPED`; it must never be presented as a passing integration test.

