# Step 0 Pi Integration Spike Results

Date: 2026-08-11T04:38:10.415Z

Only checks actually exercised are marked PASS. Missing configuration is SKIPPED, and provider or protocol errors are FAIL.

| Check | Result | Evidence |
|---|---|---|
| DeepSeek provider resolution | PASS | Resolved deepseek/deepseek-v4-flash. |
| DeepSeek session reuse | PASS | Two prompts completed in session 019fef1c-af39-7a02-95cc-9d289a9a71d5; the second corrected the first change. |
| DeepSeek context compaction | PASS | Manual compaction completed in session 019fef1c-af39-7a02-95cc-9d289a9a71d5 with 3422 tokens before compaction and 500 estimated after; the next feedback repeated the immutable requirements and produced state=delta. |
| DeepSeek usage visibility | PASS | Observed 10 assistant usage event(s), 36394 total tokens. |
| Kimi provider resolution | PASS | Resolved moonshotai-cn/kimi-k2.7-code. |
| Reviewer tool allowlist | PASS | Active tools: find, grep, ls, read, submit_review. |
| `submit_review` custom tool | PASS | Captured and validated decision=approve. |
| Kimi usage visibility | PASS | Observed 4 assistant usage event(s), 8701 total tokens. |

## Pi API differences from the V1 spec

- Verified against `@earendil-works/pi-coding-agent` 0.82.1.
- The current SDK expects an explicit `Model` object. This spike resolves it through `ModelRuntime.create()` and `modelRuntime.getModel(provider, modelId)`, then passes both `modelRuntime` and `model` to `createAgentSession()`.
- `SessionManager.inMemory()` accepts an optional working directory; this spike passes the fixture directory.
- Active tool names can be asserted directly with `session.getActiveToolNames()`.
- Manual context compaction is exercised through `session.compact()` with an in-memory low `keepRecentTokens` threshold so the disposable spike triggers the real provider-backed summarization path deterministically.
- Runtime API keys are installed with `allowNetwork: false`; the packaged model catalog is sufficient for configured model resolution and avoids an unrelated remote-catalog refresh blocking session startup.
- Per-call provider/model/usage is observed from assistant `message_end` events; aggregate tokens and reported cost are available through `session.getSessionStats()`.
