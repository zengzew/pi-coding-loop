import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  defineTool,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
  type SessionStats,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { serializeChangeSetForReview } from "./changes.js";
import { validateReviewResult } from "./feedback.js";
import type { ChangeSet, ReviewResult, VerificationResult } from "./types.js";

export const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "submit_review"] as const;

const reviewParameters = Type.Object({
  decision: Type.Union([Type.Literal("approve"), Type.Literal("changes_requested")]),
  blockers: Type.Array(
    Type.Object({
      id: Type.String(),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      issue: Type.String(),
      evidence: Type.String(),
      suggestedFix: Type.Optional(Type.String()),
    }),
  ),
  notes: Type.Array(Type.String()),
});

export interface ReviewerTurnInput {
  taskRequirements: string;
  changes: ChangeSet;
  verification: VerificationResult;
}

export interface CreateKimiReviewerOptions {
  repoRoot: string;
  model: string;
  apiKey: string;
  protocolRetries: number;
}

type ReviewerAgentSession = Pick<
  AgentSession,
  | "sessionId"
  | "systemPrompt"
  | "prompt"
  | "abort"
  | "dispose"
  | "getActiveToolNames"
  | "getSessionStats"
  | "subscribe"
>;

export class ReviewerProtocolError extends Error {
  override readonly name = "ReviewerProtocolError";
  readonly code = "reviewer_protocol_error";
}

export class ReviewerProviderError extends Error {
  override readonly name = "ReviewerProviderError";
}

export class StructuredReviewReceiver {
  private result: ReviewResult | undefined;
  private accepting = false;

  beginAttempt(): void {
    this.result = undefined;
    this.accepting = true;
  }

  submit(value: unknown): ReviewResult {
    if (!this.accepting) throw new Error("submit_review is not accepting a submission");
    if (this.result) throw new Error("submit_review may only be called once");
    this.result = validateReviewResult(value);
    return this.result;
  }

  finishAttempt(): ReviewResult | undefined {
    this.accepting = false;
    return this.result;
  }
}

export class KimiReviewer {
  private providerError: string | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly session: ReviewerAgentSession,
    private readonly receiver: StructuredReviewReceiver,
    private readonly protocolRetries: number,
  ) {
    this.unsubscribe = session.subscribe((event) => this.observeSessionEvent(event));
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get activeToolNames(): string[] {
    return this.session.getActiveToolNames();
  }

  get stats(): SessionStats {
    return this.session.getSessionStats();
  }

  async run(input: ReviewerTurnInput): Promise<ReviewResult> {
    if (!input.taskRequirements.trim()) {
      throw new TypeError("Reviewer task requirements must not be empty.");
    }
    if (!input.verification.passed) {
      throw new TypeError("Reviewer requires a passing deterministic verification result.");
    }

    for (let attempt = 0; attempt <= this.protocolRetries; attempt++) {
      this.receiver.beginAttempt();
      this.providerError = undefined;
      await this.session.prompt(renderReviewerPrompt(input, attempt), {
        expandPromptTemplates: false,
      });
      const result = this.receiver.finishAttempt();
      if (this.providerError) throw new ReviewerProviderError(this.providerError);
      if (result) return result;
    }

    throw new ReviewerProtocolError(
      `Reviewer completed ${this.protocolRetries + 1} attempt(s) without a valid submit_review call.`,
    );
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
      this.providerError = event.message.errorMessage || "Kimi returned an unknown error.";
    }
  }
}

export async function createKimiReviewer(
  options: CreateKimiReviewerOptions,
): Promise<KimiReviewer> {
  const repoRoot = resolve(options.repoRoot);
  const apiKey = options.apiKey.trim();
  const configuredModel = options.model.trim();
  if (!apiKey) throw new TypeError("Kimi API key must not be empty.");
  if (!configuredModel) throw new TypeError("Kimi model must not be empty.");
  if (!Number.isInteger(options.protocolRetries) || options.protocolRetries < 0) {
    throw new TypeError("Reviewer protocolRetries must be a non-negative integer.");
  }

  const [modelRuntime, reviewerPrompt] = await Promise.all([
    ModelRuntime.create(),
    readCanonicalReviewerPrompt(),
  ]);
  await modelRuntime.setRuntimeApiKey("moonshotai-cn", apiKey, { allowNetwork: false });
  const model = resolveKimiModel(modelRuntime, configuredModel);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: getAgentDir(),
    settingsManager,
    systemPrompt: reviewerPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const receiver = new StructuredReviewReceiver();
  const submitReviewTool = defineTool({
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the single final structured review result.",
    parameters: reviewParameters,
    execute: async (_toolCallId, parameters) => {
      receiver.submit(parameters);
      return {
        content: [{ type: "text" as const, text: "Review accepted." }],
        details: { accepted: true },
        terminate: true,
      };
    },
  });

  const { session } = await createAgentSession({
    cwd: repoRoot,
    model,
    modelRuntime,
    tools: [...REVIEWER_TOOLS],
    customTools: [submitReviewTool],
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(repoRoot),
  });
  assertReviewerSession(session, reviewerPrompt);
  return new KimiReviewer(session, receiver, options.protocolRetries);
}

export function renderReviewerPrompt(input: ReviewerTurnInput, attempt = 0): string {
  const verification = input.verification.checks
    .map(
      (check) =>
        `- ${check.name}: ${check.passed ? "PASS" : "FAIL"}; exit=${check.exitCode ?? "unavailable"}; timedOut=${check.timedOut}; durationMs=${check.durationMs}`,
    )
    .join("\n");
  return [
    "Independently review the current implementation against the immutable requirements.",
    ...(attempt > 0
      ? [
          "",
          `Protocol retry ${attempt}: the previous response did not include a valid submit_review call.`,
        ]
      : []),
    "",
    "Immutable task requirements:",
    input.taskRequirements,
    "",
    "Changed paths:",
    ...input.changes.changedPaths.map((path) => `- ${path}`),
    "",
    "Deterministic verification summary:",
    verification || "- No checks recorded.",
    "",
    "Git change set supplied by the harness:",
    serializeChangeSetForReview(input.changes),
    "",
    "Inspect repository files with read-only tools when needed. Finish by calling submit_review exactly once.",
  ].join("\n");
}

function resolveKimiModel(modelRuntime: ModelRuntime, configuredModel: string) {
  const prefix = "moonshotai-cn/";
  const modelId = configuredModel.startsWith(prefix)
    ? configuredModel.slice(prefix.length)
    : configuredModel;
  const model = modelRuntime.getModel("moonshotai-cn", modelId);
  if (!model) throw new TypeError(`Unknown moonshotai-cn model: ${configuredModel}`);
  return model;
}

async function readCanonicalReviewerPrompt(): Promise<string> {
  const candidates = [
    new URL("../prompts/reviewer.md", import.meta.url),
    new URL("../../prompts/reviewer.md", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const prompt = (await readFile(candidate, "utf8")).trim();
      if (prompt) return prompt;
    } catch {
      // Try source-tree and compiled-tree locations before failing.
    }
  }
  throw new Error(
    `Canonical Reviewer prompt is unavailable near ${fileURLToPath(import.meta.url)}.`,
  );
}

function assertReviewerSession(session: AgentSession, reviewerPrompt: string): void {
  const activeTools = session.getActiveToolNames();
  if (
    activeTools.length !== REVIEWER_TOOLS.length ||
    REVIEWER_TOOLS.some((tool) => !activeTools.includes(tool)) ||
    activeTools.some((tool) => ["bash", "edit", "write"].includes(tool))
  ) {
    session.dispose();
    throw new Error(`Unexpected Reviewer tools: ${activeTools.join(", ")}`);
  }
  if (!session.systemPrompt.includes(reviewerPrompt)) {
    session.dispose();
    throw new Error("Canonical Reviewer prompt was not installed as the session system prompt.");
  }
}
