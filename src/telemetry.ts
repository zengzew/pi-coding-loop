import type { SessionStats } from "@earendil-works/pi-coding-agent";
import type { ModelTelemetry } from "./types.js";

export function modelTelemetry(
  provider: string,
  model: string,
  stats: SessionStats,
): ModelTelemetry {
  return {
    provider,
    model,
    messages: stats.assistantMessages,
    inputTokens: stats.tokens.input,
    outputTokens: stats.tokens.output,
    cacheReadTokens: stats.tokens.cacheRead,
    cacheWriteTokens: stats.tokens.cacheWrite,
    reportedCost: Number.isFinite(stats.cost) ? stats.cost : "unknown",
  };
}
