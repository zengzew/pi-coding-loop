# Step 6 Git Change Collection Results

Date: 2026-08-11

The production change collector was exercised against disposable real Git repositories. No provider credentials are required for this step.

| Check | Result | Evidence |
|---|---|---|
| Immutable baseline | PASS | `git diff <baseCommit> -- .` includes both current working-tree changes and commits made after the captured baseline. |
| Tracked paths | PASS | Tracked paths come from the same immutable baseline and are merged deterministically into `changedPaths`. |
| Untracked text | PASS | `git ls-files --others --exclude-standard -z` preserves paths with spaces; complete UTF-8 content appears in the canonical Reviewer input. |
| Ignore rules | PASS | A matching ignored file is absent from `ChangeSet` and the Reviewer input. |
| Binary handling | PASS | NUL-containing untracked data is classified as binary; only path and byte size are serialized. |
| Symbolic links | PASS | The link target is serialized as Git's text representation without following the link outside the repository. |
| Index preservation | PASS | Porcelain status and cached diff are byte-for-byte unchanged before and after collection; no intent-to-add operation is used. |
| Canonical character count | PASS | `ChangeSet.totalChars` exactly equals `serializeChangeSetForReview(changeSet).length`. |
| Size guard | PASS | The exact limit is accepted; one character below it throws `ReviewInputTooLargeError` with code `review_input_too_large`, actual size, and configured limit. |

Formal STOPPED state routing remains Step 9 scope. Step 7 can consume the canonical serialization directly and does not need to reconstruct or filter the change set.
