import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVerification } from "../../src/verifier.js";
import type { PiLoopConfig, VerificationCommand } from "../../src/types.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("runVerification", () => {
  it("runs commands sequentially and stores complete stdout and stderr logs", async () => {
    const fixture = await createFixture();
    const result = await verify(fixture, [
      command("first", 'process.stdout.write("one\\n")'),
      command("second", 'process.stderr.write("two\\n")'),
    ]);

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0]).toMatchObject({ passed: true, exitCode: 0, timedOut: false });
    expect(result.checks[0]?.stdoutBytes).toBe(4);
    expect(result.checks[1]?.stderrBytes).toBe(4);
    const firstLog = await readFile(result.checks[0]!.fullOutputPath, "utf8");
    const secondLog = await readFile(result.checks[1]!.fullOutputPath, "utf8");
    expect(firstLog).toContain("=== STDOUT ===\none");
    expect(secondLog).toContain("=== STDERR ===\ntwo");
  });

  it("stops after the first failed command", async () => {
    const fixture = await createFixture();
    const skippedPath = join(fixture.repoRoot, "should-not-exist.txt");
    const result = await verify(fixture, [
      command("fail", 'process.stderr.write("boom\\n"); process.exit(7)'),
      command("must-not-run", `require("node:fs").writeFileSync(${JSON.stringify(skippedPath)}, "x")`),
    ]);

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.failedCheck).toBe(result.checks[0]);
    expect(result.failedCheck).toMatchObject({ exitCode: 7, timedOut: false, passed: false });
    expect(result.failedCheck?.outputForModel).toContain("[stderr] boom");
    await expect(access(skippedPath)).rejects.toThrow();
  });

  it("terminates a command when its timeout expires", async () => {
    const fixture = await createFixture();
    const result = await verify(fixture, [
      { name: "timeout", command: nodeCommand("setInterval(() => {}, 1_000)"), timeoutMs: 50 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toMatchObject({ exitCode: null, timedOut: true, passed: false });
    expect(result.durationMs).toBeLessThan(2_000);
  });

  it("bounds model output by head lines, tail lines, and character count", async () => {
    const fixture = await createFixture();
    const lines = Array.from({ length: 8 }, (_, index) => `line-${index}`).join("\n");
    const result = await verify(
      fixture,
      [command("large-output", `process.stdout.write(${JSON.stringify(`${lines}\n`)})`)],
      { maxModelOutputChars: 120, headLines: 2, tailLines: 2 },
    );

    const output = result.checks[0]!.outputForModel;
    expect(output.length).toBeLessThanOrEqual(120);
    expect(output).toContain("line-0");
    expect(output).toContain("line-1");
    expect(output).toContain("output truncated");
    expect(output).toContain("line-7");
    expect(output).not.toContain("line-4");
  });

  it("caps a single unbounded line before exposing it to the model", async () => {
    const fixture = await createFixture();
    const result = await verify(
      fixture,
      [command("long-line", `process.stdout.write(${JSON.stringify("x".repeat(2_000))})`)],
      { maxModelOutputChars: 120, headLines: 2, tailLines: 2 },
    );

    const output = result.checks[0]!.outputForModel;
    expect(output.length).toBeLessThanOrEqual(120);
    expect(output).toContain("line truncated");
  });

  it("records process spawn failures as failed checks", async () => {
    const fixture = await createFixture();
    const result = await runVerification({
      repoRoot: join(fixture.repoRoot, "missing"),
      artifacts: { runDirectory: fixture.runDirectory },
      config: verificationConfig([command("spawn", "node --version")]),
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toMatchObject({ exitCode: null, timedOut: false, passed: false });
    expect(result.failedCheck?.outputForModel).toContain("[spawn]");
    expect(await readFile(result.failedCheck!.fullOutputPath, "utf8")).toContain("SPAWN ERROR");
  });
});

function command(name: string, source: string): VerificationCommand {
  return { name, command: nodeCommand(source), timeoutMs: 2_000 };
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-loop-verifier-test-"));
  temporaryPaths.push(root);
  const repoRoot = join(root, "repo");
  const runDirectory = join(root, "run");
  await Promise.all([mkdir(repoRoot), mkdir(runDirectory)]);
  return { repoRoot, runDirectory };
}

async function verify(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  commands: VerificationCommand[],
  overrides: Partial<PiLoopConfig["verification"]> = {},
) {
  return runVerification({
    repoRoot: fixture.repoRoot,
    artifacts: { runDirectory: fixture.runDirectory },
    config: verificationConfig(commands, overrides),
  });
}

function verificationConfig(
  commands: VerificationCommand[],
  overrides: Partial<PiLoopConfig["verification"]> = {},
): PiLoopConfig["verification"] {
  return {
    commands,
    maxModelOutputChars: 30_000,
    headLines: 100,
    tailLines: 200,
    ...overrides,
  };
}
