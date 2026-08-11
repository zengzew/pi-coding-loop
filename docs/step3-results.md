# Step 3 DeepSeek Coder Results

Date: 2026-08-11

The production `createDeepSeekCoder()` path was exercised with real DeepSeek credentials against a disposable Git repository.

| Check | Result | Evidence |
|---|---|---|
| DeepSeek session creation | PASS | Created session `019fef24-1d0f-7c5c-9ffd-9758698a9c69` with `deepseek-v4-flash`. |
| Canonical Coder system prompt | PASS | Factory asserts that `prompts/coder.md` is installed as the persistent Pi system prompt. |
| Coder tool allowlist | PASS | Active tools are exactly `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. |
| Initial task routing | PASS | The immutable task requirements were sent with prompt-template expansion disabled. |
| Repository change | PASS | DeepSeek changed `status.ts` from `before` to `after` in the temporary Git fixture. |
| Scope preservation | PASS | `status.ts` was the only working-tree change and no extra files were created. |
| Provider error propagation | PASS | Assistant `message_end` events with `stopReason=error` raise `CoderProviderError` instead of masquerading as a completed turn. |

The fixture repository was removed after the smoke run. No target repository, remote, or production resource was modified.
