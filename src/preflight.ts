import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { serializeRunEvent } from "./events.js";
import type {
  LoopState,
  PiLoopConfig,
  RunArtifacts,
  RunBaseline,
  RunEvent,
} from "./types.js";

const execFile = promisify(execFileCallback);

export type PreflightErrorCode =
  | "not_git_repository"
  | "task_unavailable"
  | "dirty_worktree"
  | "verification_commands_missing"
  | "credentials_missing"
  | "model_unavailable"
  | "baseline_unavailable"
  | "artifact_unavailable";

export class PreflightError extends Error {
  override readonly name = "PreflightError";

  constructor(
    readonly code: PreflightErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface PreflightOptions {
  cwd: string;
  taskPath: string;
  config: PiLoopConfig;
  env?: NodeJS.ProcessEnv;
  resolveModels?: ModelResolver;
  now?: () => Date;
  runIdFactory?: (now: Date) => string;
}

export interface PreflightResult {
  baseline: RunBaseline;
  taskPath: string;
  taskRequirements: string;
  runId: string;
  artifacts: RunArtifacts;
  state: LoopState;
}

export type ModelResolver = (
  config: PiLoopConfig,
  credentials: ProviderCredentials,
) => Promise<void>;

export interface ProviderCredentials {
  deepseekApiKey: string;
  kimiApiKey: string;
}

export async function runPreflight(options: PreflightOptions): Promise<PreflightResult> {
  const env = options.env ?? process.env;
  const now = (options.now ?? (() => new Date()))();
  const cwd = resolve(options.cwd);
  const taskPath = isAbsolute(options.taskPath)
    ? options.taskPath
    : resolve(cwd, options.taskPath);

  const repoRoot = await resolveRepoRoot(cwd);
  const taskRequirements = await readTaskRequirements(taskPath);
  await assertCleanWorktree(repoRoot);
  const baseline = await readBaseline(repoRoot);
  assertVerificationCommands(options.config);
  const credentials = readCredentials(env);
  await assertModelsResolve(
    options.resolveModels ?? resolveConfiguredModels,
    options.config,
    credentials,
  );

  const runId = (options.runIdFactory ?? createRunId)(now);
  const artifacts = await createRunArtifacts(repoRoot, runId);
  const state: LoopState = {
    runId,
    taskPath,
    taskRequirements,
    repoRoot,
    baseCommit: baseline.baseCommit,
    status: "coding",
    coderIteration: 0,
    reviewCycle: 0,
    repeatedFailureCount: 0,
    startedAt: now.toISOString(),
  };

  try {
    await writeFile(artifacts.statePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    const startedEvent: RunEvent<RunBaseline & { taskPath: string }> = {
      eventId: randomUUID(),
      runId,
      type: "run_started",
      timestamp: now.toISOString(),
      data: { ...baseline, taskPath },
    };
    await writeFile(artifacts.eventsPath, serializeRunEvent(startedEvent), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throw new PreflightError(
      "artifact_unavailable",
      `Could not initialize run artifacts below ${artifacts.runDirectory}.`,
      { cause: error },
    );
  }

  return { baseline, taskPath, taskRequirements, runId, artifacts, state };
}

export async function persistState(artifacts: RunArtifacts, state: LoopState): Promise<void> {
  const temporaryPath = `${artifacts.statePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, artifacts.statePath);
}

export async function appendRunEvent(
  artifacts: RunArtifacts,
  event: RunEvent,
): Promise<void> {
  await appendFile(artifacts.eventsPath, serializeRunEvent(event), "utf8");
}

export function createRunId(now: Date = new Date()): string {
  const timestamp = now.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
}

async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    throw new PreflightError("not_git_repository", `${cwd} is not inside a Git repository.`, {
      cause: error,
    });
  }
}

async function readTaskRequirements(taskPath: string): Promise<string> {
  try {
    const taskStat = await stat(taskPath);
    if (!taskStat.isFile()) throw new Error("Task path is not a file.");
    const content = await readFile(taskPath, "utf8");
    if (!content.trim()) throw new Error("Task file is empty.");
    return content;
  } catch (error) {
    throw new PreflightError(
      "task_unavailable",
      `Task file must exist and contain non-whitespace text: ${taskPath}`,
      { cause: error },
    );
  }
}

async function assertCleanWorktree(repoRoot: string): Promise<void> {
  const status = await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (status) {
    throw new PreflightError(
      "dirty_worktree",
      "Working tree is not clean. Commit or otherwise resolve changes before starting Pi Loop.",
    );
  }
}

function assertVerificationCommands(config: PiLoopConfig): void {
  if (config.verification.commands.length === 0) {
    throw new PreflightError(
      "verification_commands_missing",
      "At least one verification command is required.",
    );
  }
}

function readCredentials(env: NodeJS.ProcessEnv): ProviderCredentials {
  const deepseekApiKey = env.DEEPSEEK_API_KEY?.trim();
  const kimiApiKey = env.KIMI_API_KEY?.trim();
  const missing = [
    ...(deepseekApiKey ? [] : ["DEEPSEEK_API_KEY"]),
    ...(kimiApiKey ? [] : ["KIMI_API_KEY"]),
  ];
  if (missing.length > 0) {
    throw new PreflightError(
      "credentials_missing",
      `Missing required provider credentials: ${missing.join(", ")}.`,
    );
  }
  return { deepseekApiKey: deepseekApiKey!, kimiApiKey: kimiApiKey! };
}

async function resolveConfiguredModels(
  config: PiLoopConfig,
  credentials: ProviderCredentials,
): Promise<void> {
  try {
    const runtime = await ModelRuntime.create();
    await runtime.setRuntimeApiKey("deepseek", credentials.deepseekApiKey, {
      allowNetwork: false,
    });
    await runtime.setRuntimeApiKey("moonshotai-cn", credentials.kimiApiKey, {
      allowNetwork: false,
    });
    assertModelExists(runtime, "deepseek", config.coder.model);
    assertModelExists(runtime, "moonshotai-cn", config.reviewer.model);
  } catch (error) {
    throw new PreflightError("model_unavailable", "A configured provider model could not be resolved.", {
      cause: error,
    });
  }
}

async function assertModelsResolve(
  resolver: ModelResolver,
  config: PiLoopConfig,
  credentials: ProviderCredentials,
): Promise<void> {
  try {
    await resolver(config, credentials);
  } catch (error) {
    if (error instanceof PreflightError && error.code === "model_unavailable") throw error;
    throw new PreflightError("model_unavailable", "A configured provider model could not be resolved.", {
      cause: error,
    });
  }
}

function assertModelExists(
  runtime: ModelRuntime,
  provider: "deepseek" | "moonshotai-cn",
  configuredModel: string,
): void {
  const prefix = `${provider}/`;
  const modelId = configuredModel.startsWith(prefix)
    ? configuredModel.slice(prefix.length)
    : configuredModel;
  if (!runtime.getModel(provider, modelId)) {
    throw new Error(`Unknown ${provider} model: ${configuredModel}`);
  }
}

async function readBaseline(repoRoot: string): Promise<RunBaseline> {
  try {
    const [baseCommit, branchName] = await Promise.all([
      git(repoRoot, ["rev-parse", "HEAD"]),
      git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    ]);
    if (!baseCommit) throw new Error("Git repository has no HEAD commit.");
    return {
      repoRoot,
      baseCommit,
      branch: branchName === "HEAD" ? null : branchName,
    };
  } catch (error) {
    throw new PreflightError(
      "baseline_unavailable",
      "Could not resolve an immutable HEAD baseline for this repository.",
      { cause: error },
    );
  }
}

async function createRunArtifacts(repoRoot: string, runId: string): Promise<RunArtifacts> {
  try {
    const gitDirectory = await git(repoRoot, ["rev-parse", "--absolute-git-dir"]);
    const runsDirectory = join(gitDirectory, "pi-loop", "runs");
    const runDirectory = join(runsDirectory, runId);
    await mkdir(runsDirectory, { recursive: true });
    await mkdir(runDirectory);
    return {
      runDirectory,
      statePath: join(runDirectory, "state.json"),
      eventsPath: join(runDirectory, "events.jsonl"),
    };
  } catch (error) {
    throw new PreflightError(
      "artifact_unavailable",
      "Could not create the run artifact directory below Git metadata.",
      { cause: error },
    );
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return String(result.stdout).trim();
}
