import type { Feedback, ReviewBlocker, ReviewResult } from "./types.js";

export class ReviewResultValidationError extends Error {
  override readonly name = "ReviewResultValidationError";
}

export function validateReviewResult(value: unknown): ReviewResult {
  if (!isRecord(value)) throw new ReviewResultValidationError("Review result must be an object");
  const { decision, blockers, notes } = value;
  if (decision !== "approve" && decision !== "changes_requested") {
    throw new ReviewResultValidationError("decision must be approve or changes_requested");
  }
  if (!Array.isArray(blockers) || !blockers.every(isReviewBlocker)) {
    throw new ReviewResultValidationError("blockers must contain valid ReviewBlocker objects");
  }
  if (!Array.isArray(notes) || !notes.every((note) => typeof note === "string")) {
    throw new ReviewResultValidationError("notes must be an array of strings");
  }
  if (decision === "approve" && blockers.length !== 0) {
    throw new ReviewResultValidationError("approve requires zero blockers");
  }
  if (decision === "changes_requested" && blockers.length === 0) {
    throw new ReviewResultValidationError("changes_requested requires at least one blocker");
  }
  return { decision, blockers, notes };
}

export function renderCoderFeedback(taskRequirements: string, feedback: Feedback): string {
  const evidence =
    feedback.type === "verification_failure"
      ? [
          `Verification failed: ${feedback.failedCheck}`,
          `Command: ${feedback.command}`,
          `Exit code: ${feedback.exitCode ?? "unavailable"}`,
          `Timed out: ${feedback.timedOut}`,
          "Output:",
          feedback.outputForModel,
          `Full output: ${feedback.fullOutputPath}`,
        ].join("\n")
      : renderBlockers(feedback.blockers);

  return [
    "Continue implementing the task using the new evidence below.",
    "",
    "Immutable task requirements:",
    taskRequirements,
    "",
    "New evidence:",
    evidence,
    "",
    "Investigate the evidence and make the smallest correct change. The harness decides completion.",
  ].join("\n");
}

function renderBlockers(blockers: ReviewBlocker[]): string {
  return blockers
    .map((blocker) => {
      const location = blocker.file
        ? `${blocker.file}${blocker.line === undefined ? "" : `:${blocker.line}`}`
        : "unspecified location";
      return [
        `[${blocker.id}] ${blocker.issue}`,
        `Location: ${location}`,
        `Evidence: ${blocker.evidence}`,
        ...(blocker.suggestedFix ? [`Suggested fix: ${blocker.suggestedFix}`] : []),
      ].join("\n");
    })
    .join("\n\n");
}

function isReviewBlocker(value: unknown): value is ReviewBlocker {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.file === undefined || typeof value.file === "string") &&
    (value.line === undefined || (Number.isInteger(value.line) && Number(value.line) > 0)) &&
    typeof value.issue === "string" &&
    value.issue.length > 0 &&
    typeof value.evidence === "string" &&
    value.evidence.length > 0 &&
    (value.suggestedFix === undefined || typeof value.suggestedFix === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

