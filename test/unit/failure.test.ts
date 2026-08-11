import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFailureSignature } from "../../src/failure.js";
import type { VerificationCheckResult } from "../../src/types.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("createFailureSignature", () => {
  it("normalizes timestamps, ANSI, CRLF, and absolute repository paths", async () => {
    const first = await fixtureCheck(
      "npm test",
      "\u001b[31mFAIL\u001b[0m /tmp/repo-a/value.test.ts 2026-08-11T10:20:30.000Z\r\nexpected true   \r\n",
      "/tmp/repo-a",
    );
    const second = await fixtureCheck(
      "npm test",
      "FAIL /tmp/repo-b/value.test.ts 2026-08-12T11:21:31.000Z\nexpected true\n",
      "/tmp/repo-b",
    );

    expect(first.signature).toBe(second.signature);
  });

  it("includes the failed command in the signature", async () => {
    const first = await fixtureCheck("npm test", "same error\n", "/tmp/repo");
    const second = await fixtureCheck("npm run build", "same error\n", "/tmp/repo");

    expect(first.signature).not.toBe(second.signature);
  });

  it("prefers stderr over stdout", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-loop-failure-test-"));
    temporaryPaths.push(root);
    const logPath = join(root, "check.log");
    await writeFile(
      logPath,
      "=== STDOUT ===\nchanging noise\n\n=== STDERR ===\nstable error\n",
      "utf8",
    );
    const first = await createFailureSignature(check("npm test", logPath), signatureOptions(root));
    await writeFile(
      logPath,
      "=== STDOUT ===\ndifferent noise\n\n=== STDERR ===\nstable error\n",
      "utf8",
    );
    const second = await createFailureSignature(check("npm test", logPath), signatureOptions(root));

    expect(first).toBe(second);
  });
});

async function fixtureCheck(command: string, stderr: string, repoRoot: string) {
  const root = await mkdtemp(join(tmpdir(), "pi-loop-failure-test-"));
  temporaryPaths.push(root);
  const logPath = join(root, "check.log");
  await writeFile(logPath, `=== STDOUT ===\nnoise\n\n=== STDERR ===\n${stderr}`, "utf8");
  return {
    signature: await createFailureSignature(
      check(command, logPath),
      signatureOptions(repoRoot),
    ),
  };
}

function check(command: string, fullOutputPath: string): VerificationCheckResult {
  return {
    name: "test",
    command,
    passed: false,
    exitCode: 1,
    timedOut: false,
    stdoutBytes: 0,
    stderrBytes: 1,
    outputForModel: "fallback",
    fullOutputPath,
    durationMs: 1,
  };
}

function signatureOptions(repoRoot: string) {
  return {
    repoRoot,
    bounds: { headLines: 100, tailLines: 200, maxModelOutputChars: 30_000 },
  };
}
