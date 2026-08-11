# Step 4 Deterministic Verifier Results

Date: 2026-08-11

The production `runVerification()` path was exercised through disposable-directory integration tests with real child processes.

| Check | Result | Evidence |
|---|---|---|
| Sequential execution | PASS | Two successful commands ran in configuration order and produced two `VerificationCheckResult` records. |
| Exit-code handling | PASS | Exit code `7` produced a failed check and prevented the next command from running. |
| Per-command timeout | PASS | A non-terminating Node process exceeded its 50 ms limit, its process group was terminated, and the result recorded `timedOut=true` with `exitCode=null`. |
| Process spawn failure | PASS | A missing working directory produced a failed check with `exitCode=null` and recorded spawn-error evidence. |
| Full output logs | PASS | Complete stdout and stderr were streamed into separate sections of the check log without placing the full output in model context. |
| Output byte counts | PASS | `stdoutBytes` and `stderrBytes` matched the emitted byte lengths. |
| Line-bounded model output | PASS | Output preserved the configured first and last lines with an explicit truncation marker. |
| Character-bounded model output | PASS | A single 2,000-character line was bounded to 120 characters with an explicit line-truncation marker. |

All test artifacts were created outside the working tree and removed after each test. Step 4 contains no LLM calls and does not yet send failure feedback to the Coder.
