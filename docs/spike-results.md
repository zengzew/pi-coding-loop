# Step 0 Pi Integration Spike Results

Date: 2026-08-09T17:12:55.553Z

Only checks actually exercised are marked PASS. Missing configuration is SKIPPED, and provider or protocol errors are FAIL.

| Check | Result | Evidence |
|---|---|---|
| DeepSeek provider resolution | PASS | Resolved deepseek/deepseek-v4-flash. |
| DeepSeek session reuse | PASS | Two prompts completed in session 019fe783-1cab-7125-9355-0e0254c0393a; the second corrected the first change. |
| DeepSeek usage visibility | PASS | Observed 6 assistant usage event(s), 17522 total tokens. |
| Kimi provider resolution | PASS | Resolved moonshotai-cn/kimi-k2.7-code. |
| Reviewer tool allowlist | PASS | Active tools: find, grep, ls, read, submit_review. |
| `submit_review` custom tool | PASS | Captured and validated decision=approve. |
| Kimi usage visibility | PASS | Observed 4 assistant usage event(s), 7310 total tokens. |

## Pi API differences from the V1 spec

- Verified against `@earendil-works/pi-coding-agent` 0.82.1.
- The current SDK expects an explicit `Model` object. This spike resolves it through `ModelRuntime.create()` and `modelRuntime.getModel(provider, modelId)`, then passes both `modelRuntime` and `model` to `createAgentSession()`.
- `SessionManager.inMemory()` accepts an optional working directory; this spike passes the fixture directory.
- Active tool names can be asserted directly with `session.getActiveToolNames()`.
- Runtime API keys are installed with `allowNetwork: false`; the packaged model catalog is sufficient for configured model resolution and avoids an unrelated remote-catalog refresh blocking session startup.
- Per-call provider/model/usage is observed from assistant `message_end` events; aggregate tokens and reported cost are available through `session.getSessionStats()`.
