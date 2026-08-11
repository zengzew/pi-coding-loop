import { describe, expect, it, vi } from "vitest";
import {
  KimiReviewer,
  ReviewerProtocolError,
  StructuredReviewReceiver,
  renderReviewerPrompt,
} from "../../src/reviewer.js";
import type { ChangeSet, VerificationResult } from "../../src/types.js";

const changes: ChangeSet = {
  baseCommit: "abc123",
  trackedDiff: "diff --git a/value.ts b/value.ts\n+export const value = 1;\n",
  untrackedFiles: [
    { path: "new file.ts", binary: false, sizeBytes: 9, content: "new text\n" },
  ],
  changedPaths: ["new file.ts", "value.ts"],
  totalChars: 0,
};

const verification: VerificationResult = {
  passed: true,
  checks: [
    {
      name: "test",
      command: "npm test",
      passed: true,
      exitCode: 0,
      timedOut: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      outputForModel: "",
      fullOutputPath: "/tmp/test.log",
      durationMs: 12,
    },
  ],
  durationMs: 12,
};

describe("KimiReviewer", () => {
  it("retries a missing submission once and returns the valid structured result", async () => {
    const receiver = new StructuredReviewReceiver();
    let prompts = 0;
    const session = fakeSession(async () => {
      prompts++;
      if (prompts === 2) {
        receiver.submit({ decision: "approve", blockers: [], notes: ["complete"] });
      }
    });
    const reviewer = new KimiReviewer(session, receiver, 1);

    const result = await reviewer.run({
      taskRequirements: "Implement value.",
      changes,
      verification,
    });

    expect(result).toEqual({ decision: "approve", blockers: [], notes: ["complete"] });
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(session.prompt.mock.calls[1]?.[0]).toContain("Protocol retry 1");
  });

  it("fails closed after the configured protocol retry", async () => {
    const receiver = new StructuredReviewReceiver();
    const session = fakeSession(async () => undefined);
    const reviewer = new KimiReviewer(session, receiver, 1);

    await expect(
      reviewer.run({ taskRequirements: "Implement value.", changes, verification }),
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(session.prompt).toHaveBeenCalledTimes(2);
  });

  it("requires passing deterministic verification", async () => {
    const reviewer = new KimiReviewer(
      fakeSession(async () => undefined),
      new StructuredReviewReceiver(),
      1,
    );

    await expect(
      reviewer.run({
        taskRequirements: "Implement value.",
        changes,
        verification: { ...verification, passed: false },
      }),
    ).rejects.toThrow(/passing deterministic verification/);
  });
});

describe("renderReviewerPrompt", () => {
  it("contains requirements, paths, verification, and untracked content", () => {
    const prompt = renderReviewerPrompt({
      taskRequirements: "Implement value.",
      changes,
      verification,
    });

    expect(prompt).toContain("Implement value.");
    expect(prompt).toContain("- value.ts");
    expect(prompt).toContain("test: PASS");
    expect(prompt).toContain("=== NEW FILE: new file.ts ===\nnew text");
  });
});

function fakeSession(onPrompt: (prompt: string) => Promise<void>) {
  return {
    sessionId: "reviewer-session",
    systemPrompt: "reviewer",
    prompt: vi.fn(async (prompt: string) => onPrompt(prompt)),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => ["read", "grep", "find", "ls", "submit_review"]),
    getSessionStats: vi.fn(() => ({
      sessionFile: undefined,
      sessionId: "reviewer-session",
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    })),
    subscribe: vi.fn(() => () => undefined),
  };
}
