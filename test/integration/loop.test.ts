import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCoderVerifierLoop, toVerificationFeedback } from "../../src/loop.js";
import { runVerification } from "../../src/verifier.js";
import type { CoderTurnInput } from "../../src/coder.js";
import type { VerificationResult } from "../../src/types.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("runCoderVerifierLoop", () => {
  it("returns typed verifier feedback to the same Coder and verifies its fix", async () => {
    const fixture = await createFixture();
    const received: CoderTurnInput[] = [];
    const coder = {
      sessionId: "same-session",
      run: vi.fn(async (input: CoderTurnInput) => {
        received.push(input);
        if (input.feedback) await writeFile(fixture.targetPath, "good\n", "utf8");
      }),
    };

    const result = await runCoderVerifierLoop({
      coder,
      taskRequirements: "value.txt must contain good.",
      maxCoderIterations: 2,
      verify: () => verifyFixture(fixture),
    });

    expect(result.status).toBe("verification_passed");
    expect(result.coderIterations).toBe(2);
    expect(result.verifications.map((verification) => verification.passed)).toEqual([false, true]);
    expect(coder.run).toHaveBeenCalledTimes(2);
    expect(coder.sessionId).toBe("same-session");
    expect(received[0]).toEqual({ taskRequirements: "value.txt must contain good." });
    expect(received[1]?.taskRequirements).toBe("value.txt must contain good.");
    expect(received[1]?.feedback).toMatchObject({
      type: "verification_failure",
      failedCheck: "fixture",
      exitCode: 1,
      timedOut: false,
    });
    const feedback = received[1]?.feedback;
    if (!feedback || feedback.type !== "verification_failure") {
      throw new Error("Expected typed verification feedback on the second Coder turn.");
    }
    expect(feedback.outputForModel).toContain("expected good");
    await expect(access(feedback.fullOutputPath)).resolves.toBeUndefined();
    expect(await readFile(fixture.targetPath, "utf8")).toBe("good\n");
    expect(result.verifications[0]?.checks[0]?.fullOutputPath).toMatch(/001-fixture\.log$/);
    expect(result.verifications[1]?.checks[0]?.fullOutputPath).toMatch(/002-fixture\.log$/);
  });

  it("returns the last typed feedback when the mechanical iteration cap is exhausted", async () => {
    const fixture = await createFixture();
    const coder = { sessionId: "same-session", run: vi.fn(async () => undefined) };

    const result = await runCoderVerifierLoop({
      coder,
      taskRequirements: "value.txt must contain good.",
      maxCoderIterations: 2,
      verify: () => verifyFixture(fixture),
    });

    expect(result.status).toBe("coder_iterations_exhausted");
    expect(result.coderIterations).toBe(2);
    expect(result.verifications).toHaveLength(2);
    expect(coder.run).toHaveBeenCalledTimes(2);
    expect(result.feedback).toMatchObject({ type: "verification_failure", exitCode: 1 });
  });

  it("rejects an invalid failed verification protocol", () => {
    const invalid = { passed: false, checks: [], durationMs: 1 } satisfies VerificationResult;
    expect(() => toVerificationFeedback(invalid)).toThrow(/failedCheck/);
  });
});

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "pi-loop-feedback-test-"));
  temporaryPaths.push(repoRoot);
  const targetPath = join(repoRoot, "value.txt");
  const runDirectory = join(repoRoot, "run-artifacts");
  await writeFile(targetPath, "bad\n", "utf8");
  return { repoRoot, targetPath, runDirectory };
}

function verifyFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const source = [
    'const { readFileSync } = require("node:fs");',
    'const actual = readFileSync("value.txt", "utf8");',
    'if (actual !== "good\\n") { console.error("expected good, received " + JSON.stringify(actual)); process.exit(1); }',
  ].join(" ");
  return runVerification({
    repoRoot: fixture.repoRoot,
    artifacts: { runDirectory: fixture.runDirectory },
    config: {
      commands: [{ name: "fixture", command: nodeCommand(source), timeoutMs: 2_000 }],
      maxModelOutputChars: 1_000,
      headLines: 10,
      tailLines: 10,
    },
  });
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}
