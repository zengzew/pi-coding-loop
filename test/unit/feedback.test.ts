import { describe, expect, it } from "vitest";
import { renderCoderFeedback, validateReviewResult } from "../../src/feedback.js";

describe("validateReviewResult", () => {
  it("accepts approval with no blockers", () => {
    expect(validateReviewResult({ decision: "approve", blockers: [], notes: [] })).toEqual({
      decision: "approve",
      blockers: [],
      notes: [],
    });
  });

  it("rejects approval with blockers", () => {
    expect(() =>
      validateReviewResult({
        decision: "approve",
        blockers: [{ id: "B1", issue: "Bug", evidence: "Failing case" }],
        notes: [],
      }),
    ).toThrow(/zero blockers/);
  });

  it("rejects changes_requested without blockers", () => {
    expect(() =>
      validateReviewResult({ decision: "changes_requested", blockers: [], notes: [] }),
    ).toThrow(/at least one blocker/);
  });
});

describe("renderCoderFeedback", () => {
  it("repeats immutable requirements with typed verification evidence", () => {
    const rendered = renderCoderFeedback("Keep the API stable.", {
      type: "verification_failure",
      failedCheck: "test",
      command: "npm test",
      exitCode: 1,
      timedOut: false,
      outputForModel: "expected 200, got 500",
      fullOutputPath: ".git/pi-loop/runs/x/verifier/test.log",
    });
    expect(rendered).toContain("Keep the API stable.");
    expect(rendered).toContain("expected 200, got 500");
  });
});

