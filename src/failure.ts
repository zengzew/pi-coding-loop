import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PiLoopConfig, VerificationCheckResult } from "./types.js";

const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const COMMON_TIMESTAMP = /\b\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;

export interface FailureSignatureOptions {
  repoRoot: string;
  bounds: Pick<
    PiLoopConfig["verification"],
    "headLines" | "tailLines" | "maxModelOutputChars"
  >;
}

export async function createFailureSignature(
  failedCheck: VerificationCheckResult,
  options: FailureSignatureOptions,
): Promise<string> {
  const raw = await readFailureOutput(failedCheck);
  const normalized = normalizeFailureOutput(raw, options.repoRoot);
  const bounded = boundFailureOutput(normalized, options.bounds);
  return createHash("sha256")
    .update(`${failedCheck.command}\n${bounded}`, "utf8")
    .digest("hex");
}

export function normalizeFailureOutput(output: string, repoRoot: string): string {
  const normalizedRepoRoot = repoRoot.replaceAll("\\", "/");
  return output
    .replace(ANSI_PATTERN, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\\", "/")
    .replaceAll(normalizedRepoRoot, "<REPO>")
    .replace(ISO_TIMESTAMP, "<TIMESTAMP>")
    .replace(COMMON_TIMESTAMP, "<TIMESTAMP>")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readFailureOutput(check: VerificationCheckResult): Promise<string> {
  try {
    const fullLog = await readFile(check.fullOutputPath, "utf8");
    const stderrMarker = "\n=== STDERR ===\n";
    const spawnMarker = "\n=== SPAWN ERROR ===\n";
    const stdout = fullLog.startsWith("=== STDOUT ===\n")
      ? fullLog.slice("=== STDOUT ===\n".length).split(stderrMarker, 1)[0] ?? ""
      : "";
    const stderrSection = fullLog.includes(stderrMarker)
      ? fullLog.slice(fullLog.indexOf(stderrMarker) + stderrMarker.length)
      : "";
    const stderr = stderrSection.split(spawnMarker, 1)[0] ?? "";
    const spawnError = fullLog.includes(spawnMarker)
      ? fullLog.slice(fullLog.indexOf(spawnMarker) + spawnMarker.length)
      : "";
    return stderr.trim() ? stderr : spawnError.trim() ? spawnError : stdout;
  } catch {
    return check.outputForModel;
  }
}

function boundFailureOutput(
  output: string,
  bounds: FailureSignatureOptions["bounds"],
): string {
  const lines = output.split("\n");
  const selected =
    lines.length <= bounds.headLines + bounds.tailLines
      ? lines
      : [
          ...lines.slice(0, bounds.headLines),
          "[... output truncated ...]",
          ...lines.slice(-bounds.tailLines),
        ];
  const rendered = selected.join("\n");
  if (rendered.length <= bounds.maxModelOutputChars) return rendered;
  const marker = "\n[... output truncated ...]\n";
  const available = Math.max(0, bounds.maxModelOutputChars - marker.length);
  const headChars = Math.ceil(available / 2);
  const tailChars = Math.floor(available / 2);
  return `${rendered.slice(0, headChars)}${marker}${rendered.slice(-tailChars)}`.slice(
    0,
    bounds.maxModelOutputChars,
  );
}
