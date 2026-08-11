import type { PiLoopConfig, VerificationCommand } from "./types.js";

export const CONFIG_DEFAULTS = {
  reviewer: {
    protocolRetries: 1,
    maxPatchChars: 100_000,
  },
  verification: {
    maxModelOutputChars: 30_000,
    headLines: 100,
    tailLines: 200,
  },
  limits: {
    maxCoderIterations: 4,
    maxReviewCycles: 2,
    sameFailureLimit: 3,
    maxTaskMinutes: 30,
  },
} as const;

export interface ConfigInput {
  coder?: { provider?: "deepseek"; model?: string };
  reviewer?: {
    provider?: "moonshotai-cn";
    model?: string;
    protocolRetries?: number;
    maxPatchChars?: number;
  };
  verification?: {
    commands?: VerificationCommand[];
    maxModelOutputChars?: number;
    headLines?: number;
    tailLines?: number;
  };
  limits?: {
    maxCoderIterations?: number;
    maxReviewCycles?: number;
    sameFailureLimit?: number;
    maxTaskMinutes?: number;
  };
}

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export function defineConfig(config: ConfigInput): ConfigInput {
  return config;
}

export function loadConfig(
  input: ConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): PiLoopConfig {
  const config: PiLoopConfig = {
    coder: {
      provider: input.coder?.provider ?? "deepseek",
      model: input.coder?.model?.trim() || env.DEEPSEEK_CODER_MODEL?.trim() || "",
    },
    reviewer: {
      provider: input.reviewer?.provider ?? "moonshotai-cn",
      model: input.reviewer?.model?.trim() || env.KIMI_REVIEWER_MODEL?.trim() || "",
      protocolRetries:
        input.reviewer?.protocolRetries ?? CONFIG_DEFAULTS.reviewer.protocolRetries,
      maxPatchChars:
        input.reviewer?.maxPatchChars ?? CONFIG_DEFAULTS.reviewer.maxPatchChars,
    },
    verification: {
      commands: input.verification?.commands ?? [],
      maxModelOutputChars:
        input.verification?.maxModelOutputChars ??
        CONFIG_DEFAULTS.verification.maxModelOutputChars,
      headLines:
        input.verification?.headLines ?? CONFIG_DEFAULTS.verification.headLines,
      tailLines:
        input.verification?.tailLines ?? CONFIG_DEFAULTS.verification.tailLines,
    },
    limits: {
      maxCoderIterations:
        input.limits?.maxCoderIterations ?? CONFIG_DEFAULTS.limits.maxCoderIterations,
      maxReviewCycles:
        input.limits?.maxReviewCycles ?? CONFIG_DEFAULTS.limits.maxReviewCycles,
      sameFailureLimit:
        input.limits?.sameFailureLimit ?? CONFIG_DEFAULTS.limits.sameFailureLimit,
      maxTaskMinutes:
        input.limits?.maxTaskMinutes ?? CONFIG_DEFAULTS.limits.maxTaskMinutes,
    },
  };

  validateConfig(config);
  return config;
}

export function validateConfig(config: PiLoopConfig): void {
  const errors: string[] = [];

  if (config.coder.provider !== "deepseek") errors.push("coder.provider must be deepseek");
  if (!config.coder.model.trim()) errors.push("coder.model is required");
  if (config.reviewer.provider !== "moonshotai-cn") {
    errors.push("reviewer.provider must be moonshotai-cn");
  }
  if (!config.reviewer.model.trim()) errors.push("reviewer.model is required");
  if (!Number.isInteger(config.reviewer.protocolRetries) || config.reviewer.protocolRetries < 0) {
    errors.push("reviewer.protocolRetries must be a non-negative integer");
  }
  requirePositiveInteger(errors, "reviewer.maxPatchChars", config.reviewer.maxPatchChars);
  requirePositiveInteger(
    errors,
    "verification.maxModelOutputChars",
    config.verification.maxModelOutputChars,
  );
  requirePositiveInteger(errors, "verification.headLines", config.verification.headLines);
  requirePositiveInteger(errors, "verification.tailLines", config.verification.tailLines);
  requirePositiveInteger(errors, "limits.maxCoderIterations", config.limits.maxCoderIterations);
  requirePositiveInteger(errors, "limits.maxReviewCycles", config.limits.maxReviewCycles);
  requirePositiveInteger(errors, "limits.sameFailureLimit", config.limits.sameFailureLimit);
  requirePositiveInteger(errors, "limits.maxTaskMinutes", config.limits.maxTaskMinutes);

  for (const [index, command] of config.verification.commands.entries()) {
    if (!command.name.trim()) errors.push(`verification.commands[${index}].name is required`);
    if (!command.command.trim()) errors.push(`verification.commands[${index}].command is required`);
    requirePositiveInteger(
      errors,
      `verification.commands[${index}].timeoutMs`,
      command.timeoutMs,
    );
  }

  if (errors.length > 0) {
    throw new ConfigurationError(`Invalid Pi Loop configuration:\n- ${errors.join("\n- ")}`);
  }
}

function requirePositiveInteger(errors: string[], name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) errors.push(`${name} must be a positive integer`);
}
