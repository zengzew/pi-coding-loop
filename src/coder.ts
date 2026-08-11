import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCoderFeedback } from "./feedback.js";
import type { Feedback } from "./types.js";

export const CODER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export interface CoderTurnInput {
  taskRequirements: string;
  feedback?: Feedback;
}

export interface CreateDeepSeekCoderOptions {
  repoRoot: string;
  model: string;
  apiKey: string;
}

type CoderAgentSession = Pick<
  AgentSession,
  | "sessionId"
  | "systemPrompt"
  | "prompt"
  | "abort"
  | "dispose"
  | "getActiveToolNames"
  | "subscribe"
>;

export class CoderProviderError extends Error {
  override readonly name = "CoderProviderError";
}

export class DeepSeekCoder {
  private providerError: string | undefined;
  private readonly unsubscribe: () => void;

  constructor(private readonly session: CoderAgentSession) {
    this.unsubscribe = session.subscribe((event) => this.observeSessionEvent(event));
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get activeToolNames(): string[] {
    return this.session.getActiveToolNames();
  }

  async run(input: CoderTurnInput): Promise<void> {
    const taskRequirements = input.taskRequirements;
    if (!taskRequirements.trim()) throw new TypeError("Coder task requirements must not be empty.");

    const prompt = input.feedback
      ? renderCoderFeedback(taskRequirements, input.feedback)
      : renderInitialCoderPrompt(taskRequirements);
    this.providerError = undefined;
    await this.session.prompt(prompt, { expandPromptTemplates: false });
    if (this.providerError) throw new CoderProviderError(this.providerError);
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  dispose(): void {
    this.unsubscribe();
    this.session.dispose();
  }

  private observeSessionEvent(event: AgentSessionEvent): void {
    if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      event.message.stopReason === "error"
    ) {
      this.providerError = event.message.errorMessage || "DeepSeek returned an unknown error.";
    }
  }
}

export async function createDeepSeekCoder(
  options: CreateDeepSeekCoderOptions,
): Promise<DeepSeekCoder> {
  const repoRoot = resolve(options.repoRoot);
  const apiKey = options.apiKey.trim();
  const configuredModel = options.model.trim();
  if (!apiKey) throw new TypeError("DeepSeek API key must not be empty.");
  if (!configuredModel) throw new TypeError("DeepSeek model must not be empty.");

  const [modelRuntime, coderPrompt] = await Promise.all([
    ModelRuntime.create(),
    readCanonicalCoderPrompt(),
  ]);
  await modelRuntime.setRuntimeApiKey("deepseek", apiKey, { allowNetwork: false });
  const model = resolveDeepSeekModel(modelRuntime, configuredModel);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: getAgentDir(),
    settingsManager,
    systemPrompt: coderPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: repoRoot,
    model,
    modelRuntime,
    tools: [...CODER_TOOLS],
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(repoRoot),
  });
  assertCoderSession(session, coderPrompt);
  return new DeepSeekCoder(session);
}

export function renderInitialCoderPrompt(taskRequirements: string): string {
  return [
    "Implement the task described by the immutable requirements below.",
    "",
    "Immutable task requirements:",
    taskRequirements,
    "",
    "Inspect the repository and make the smallest complete change. The harness decides completion.",
  ].join("\n");
}

function resolveDeepSeekModel(modelRuntime: ModelRuntime, configuredModel: string) {
  const prefix = "deepseek/";
  const modelId = configuredModel.startsWith(prefix)
    ? configuredModel.slice(prefix.length)
    : configuredModel;
  const model = modelRuntime.getModel("deepseek", modelId);
  if (!model) throw new TypeError(`Unknown deepseek model: ${configuredModel}`);
  return model;
}

async function readCanonicalCoderPrompt(): Promise<string> {
  const candidates = [
    new URL("../prompts/coder.md", import.meta.url),
    new URL("../../prompts/coder.md", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const prompt = (await readFile(candidate, "utf8")).trim();
      if (prompt) return prompt;
    } catch {
      // Try the source-tree and compiled-tree locations before failing.
    }
  }
  throw new Error(
    `Canonical Coder prompt is unavailable near ${fileURLToPath(import.meta.url)}.`,
  );
}

function assertCoderSession(session: AgentSession, coderPrompt: string): void {
  const activeTools = session.getActiveToolNames();
  if (
    activeTools.length !== CODER_TOOLS.length ||
    CODER_TOOLS.some((tool) => !activeTools.includes(tool))
  ) {
    session.dispose();
    throw new Error(`Unexpected Coder tools: ${activeTools.join(", ")}`);
  }
  if (!session.systemPrompt.includes(coderPrompt)) {
    session.dispose();
    throw new Error("Canonical Coder prompt was not installed as the session system prompt.");
  }
}
