# Step 9 Stop Conditions Results

Date: 2026-08-11

| Check | Result | Evidence |
|---|---|---|
| Failure signature | PASS | SHA-256 input includes the command and normalized failure output; ANSI, timestamps, CRLF, repo paths, trailing whitespace, and excess blank lines are normalized. |
| Repeated failures | PASS | Equivalent failures increment the counter and stop with `repeated_verification_failure` before the broader Coder cap when its threshold is reached. |
| Iteration limits | PASS | Coder and Reviewer limits produce stable `max_coder_iterations` and `max_review_cycles` reasons. |
| Global timeout | PASS | `max_task_time` has global precedence and cancellation aborts the active Pi session or Verifier process group. |
| Interrupt | PASS | External cancellation persists `interrupted`, emits `run_interrupted`, and maps to exit code 130. |
| Protocol and size stops | PASS | Reviewer protocol exhaustion and oversized canonical input map to `reviewer_protocol_error` and `review_input_too_large`. |
| Durable state/events | PASS | Transitions are persisted and event payloads contain summaries and log paths rather than provider credentials or large output. |
