import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import {
  PreflightError,
  appendRunEvent,
  persistState,
  runPreflight,
} from "../../src/preflight.js";
import type { PiLoopConfig } from "../../src/types.js";

const execFile = promisify(execFileCallback);
const temporaryPaths: string[] = [];
const credentials = {
  DEEPSEEK_API_KEY: "deepseek-test-key",
  KIMI_API_KEY: "kimi-test-key",
};
const modelEnvironment = {
  DEEPSEEK_CODER_MODEL: "deepseek-v4-flash",
  KIMI_REVIEWER_MODEL: "kimi-k2.7-code",
};

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("runPreflight", () => {
  it("initializes state and append-only events below Git metadata", async () => {
    const repo = await createFixtureRepo("# Task\n\nMake the fixture better.\n");
    const resolveModels = vi.fn(async () => undefined);
    const now = new Date("2026-08-10T01:02:03.004Z");

    const result = await runPreflight({
      cwd: repo,
      taskPath: "task.md",
      config: validConfig(),
      env: { ...credentials },
      resolveModels,
      now: () => now,
      runIdFactory: () => "20260810T010203004Z-a1b2c3d4",
    });

    expect(resolveModels).toHaveBeenCalledOnce();
    const canonicalRepo = await realpath(repo);
    expect(result.baseline.repoRoot).toBe(canonicalRepo);
    expect(result.baseline.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.baseline.branch).toBe("main");
    expect(result.artifacts.runDirectory).toBe(
      join(canonicalRepo, ".git", "pi-loop", "runs", result.runId),
    );
    expect(result.state).toMatchObject({
      status: "coding",
      coderIteration: 0,
      reviewCycle: 0,
      repeatedFailureCount: 0,
      startedAt: now.toISOString(),
    });

    const storedState = JSON.parse(await readFile(result.artifacts.statePath, "utf8"));
    expect(storedState).toEqual(result.state);

    await appendRunEvent(result.artifacts, {
      eventId: "event-2",
      runId: result.runId,
      type: "coder_started",
      timestamp: "2026-08-10T01:02:04.000Z",
    });
    const events = (await readFile(result.artifacts.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(["run_started", "coder_started"]);
    expect(JSON.stringify(events)).not.toContain(credentials.DEEPSEEK_API_KEY);
    expect(JSON.stringify(events)).not.toContain(credentials.KIMI_API_KEY);

    const nextState = { ...result.state, status: "verifying" as const, coderIteration: 1 };
    await persistState(result.artifacts, nextState);
    expect(JSON.parse(await readFile(result.artifacts.statePath, "utf8"))).toEqual(nextState);
    expect(await git(repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
  });

  it("rejects a dirty worktree without creating run artifacts", async () => {
    const repo = await createFixtureRepo("# Task\n");
    await writeFile(join(repo, "dirty.txt"), "uncommitted\n", "utf8");

    await expectPreflightError(
      runPreflight(baseOptions(repo)),
      "dirty_worktree",
    );
    await expect(readFile(join(repo, ".git", "pi-loop", "runs"), "utf8")).rejects.toThrow();
  });

  it("rejects an empty task before model resolution", async () => {
    const repo = await createFixtureRepo("");
    const resolveModels = vi.fn(async () => undefined);

    await expectPreflightError(
      runPreflight({ ...baseOptions(repo), resolveModels }),
      "task_unavailable",
    );
    expect(resolveModels).not.toHaveBeenCalled();
  });

  it("rejects a repository without an immutable HEAD baseline", async () => {
    const parent = await makeTemporaryDirectory();
    const repo = join(parent, "repo");
    await git(parent, ["init", "-b", "main", repo]);
    const externalTask = join(parent, "task.md");
    await writeFile(externalTask, "# Task\n", "utf8");

    await expectPreflightError(
      runPreflight({ ...baseOptions(repo), taskPath: externalTask }),
      "baseline_unavailable",
    );
  });

  it("rejects missing verification commands", async () => {
    const repo = await createFixtureRepo("# Task\n");
    const config = loadConfig({}, modelEnvironment);

    await expectPreflightError(
      runPreflight({ ...baseOptions(repo), config }),
      "verification_commands_missing",
    );
  });

  it("rejects missing credentials without exposing configured values", async () => {
    const repo = await createFixtureRepo("# Task\n");

    const error = await capturePreflightError(
      runPreflight({ ...baseOptions(repo), env: {} }),
    );
    expect(error.code).toBe("credentials_missing");
    expect(error.message).toContain("DEEPSEEK_API_KEY");
    expect(error.message).not.toContain(credentials.DEEPSEEK_API_KEY);
  });

  it("converts model resolver failures into a stable preflight error", async () => {
    const repo = await createFixtureRepo("# Task\n");
    const failure = new Error("provider detail");

    const error = await capturePreflightError(
      runPreflight({
        ...baseOptions(repo),
        resolveModels: async () => {
          throw failure;
        },
      }),
    );
    expect(error.code).toBe("model_unavailable");
    expect(error.cause).toBe(failure);
  });

  it("rejects a directory outside a Git repository", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "task.md"), "# Task\n", "utf8");

    await expectPreflightError(
      runPreflight(baseOptions(directory)),
      "not_git_repository",
    );
  });

  it.runIf(
    Boolean(process.env.DEEPSEEK_API_KEY?.trim() && process.env.KIMI_API_KEY?.trim()),
  )("resolves the configured models through the default Pi runtime", async () => {
    const repo = await createFixtureRepo("# Task\n");

    const result = await runPreflight({
      cwd: repo,
      taskPath: "task.md",
      config: validConfig(),
      env: process.env,
    });

    expect(result.state.status).toBe("coding");
    expect(result.artifacts.runDirectory).toContain(join(".git", "pi-loop", "runs"));
  });
});

function validConfig(): PiLoopConfig {
  return loadConfig(
    {
      verification: {
        commands: [{ name: "test", command: "npm test", timeoutMs: 120_000 }],
      },
    },
    modelEnvironment,
  );
}

function baseOptions(repo: string) {
  return {
    cwd: repo,
    taskPath: "task.md",
    config: validConfig(),
    env: { ...credentials },
    resolveModels: async () => undefined,
  };
}

async function createFixtureRepo(task: string): Promise<string> {
  const repo = await makeTemporaryDirectory();
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Pi Loop Test"]);
  await git(repo, ["config", "user.email", "pi-loop@example.invalid"]);
  await writeFile(join(repo, "task.md"), task, "utf8");
  await git(repo, ["add", "task.md"]);
  await git(repo, ["commit", "-m", "fixture baseline"]);
  return repo;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-loop-preflight-"));
  temporaryPaths.push(directory);
  return directory;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout).trim();
}

async function expectPreflightError(
  promise: Promise<unknown>,
  code: PreflightError["code"],
): Promise<void> {
  const error = await capturePreflightError(promise);
  expect(error.code).toBe(code);
}

async function capturePreflightError(promise: Promise<unknown>): Promise<PreflightError> {
  try {
    await promise;
    throw new Error("Expected preflight to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(PreflightError);
    return error as PreflightError;
  }
}
