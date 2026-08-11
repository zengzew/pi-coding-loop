# Step 10 Telemetry, Report, and CLI Results

Date: 2026-08-11

| Check | Result | Evidence |
|---|---|---|
| Primary CLI | PASS | Source and compiled entrypoints accept `pi-loop run task.md` with optional `--config`. |
| Exit codes | PASS | DONE=0, STOPPED=2, preflight/config=3, INTERRUPTED=130, and unexpected harness failure=1. |
| Telemetry | PASS | Coder and Reviewer session statistics record messages, input/output/cache tokens, and provider-reported cost; no price estimation is performed. |
| Review artifacts | PASS | Each valid review is written to `<run>/reviews/review-NN.json`. |
| Final report | PASS | DONE, STOPPED, and INTERRUPTED results write `<run>/final-report.md` with baseline, model metrics, verification, review, changes, timing, and stop reason. |
| Working-tree boundary | PASS | Runtime artifacts remain below `.git/pi-loop/runs/`. |
| Real full-loop provider run | NOT RUN | The current shell lacked all four required provider/model environment variables; this is deferred to Step 11 dogfood. |
