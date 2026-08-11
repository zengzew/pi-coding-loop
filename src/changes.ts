import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ChangeSet } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export class ReviewInputTooLargeError extends Error {
  readonly code = "review_input_too_large";

  constructor(
    readonly actualChars: number,
    readonly maxChars: number,
  ) {
    super(`Reviewer input is ${actualChars} characters; limit is ${maxChars}`);
    this.name = "ReviewInputTooLargeError";
  }
}

export async function collectChanges(
  repoRoot: string,
  baseCommit: string,
): Promise<ChangeSet> {
  const [trackedDiff, trackedPathOutput, untrackedPathOutput] = await Promise.all([
    git(repoRoot, ["diff", baseCommit, "--", "."]),
    git(repoRoot, ["diff", "--name-only", "-z", baseCommit, "--", "."]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const trackedPaths = parseNullSeparatedPaths(trackedPathOutput);
  const untrackedPaths = parseNullSeparatedPaths(untrackedPathOutput).sort();
  const untrackedFiles: ChangeSet["untrackedFiles"] = [];

  for (const path of untrackedPaths) {
    const bytes = await readUntrackedFile(repoRoot, path);
    const content = decodeText(bytes);
    untrackedFiles.push(
      content === undefined
        ? { path, binary: true, sizeBytes: bytes.byteLength }
        : { path, binary: false, sizeBytes: bytes.byteLength, content },
    );
  }

  const partial: ChangeSet = {
    baseCommit,
    trackedDiff,
    untrackedFiles,
    changedPaths: [...new Set([...trackedPaths, ...untrackedPaths])].sort(),
    totalChars: 0,
  };
  partial.totalChars = serializeChangeSetForReview(partial).length;
  return partial;
}

export function serializeChangeSetForReview(changeSet: ChangeSet): string {
  const sections: string[] = [];
  if (changeSet.trackedDiff.length > 0) sections.push(changeSet.trackedDiff);

  for (const file of changeSet.untrackedFiles) {
    if (file.binary) {
      sections.push(`=== NEW BINARY FILE: ${file.path} (${file.sizeBytes} bytes) ===\n`);
      continue;
    }

    const content = file.content ?? "";
    const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    sections.push(
      `=== NEW FILE: ${file.path} ===\n${content}${separator}=== END NEW FILE ===\n`,
    );
  }

  return sections.join("");
}

export function assertReviewInputWithinLimit(
  changeSet: ChangeSet,
  maxPatchChars: number,
): void {
  if (!Number.isSafeInteger(maxPatchChars) || maxPatchChars <= 0) {
    throw new RangeError("maxPatchChars must be a positive safe integer");
  }
  if (changeSet.totalChars > maxPatchChars) {
    throw new ReviewInputTooLargeError(changeSet.totalChars, maxPatchChars);
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return stdout;
}

function parseNullSeparatedPaths(output: string): string[] {
  return output.split("\0").filter((path) => path.length > 0);
}

async function readUntrackedFile(repoRoot: string, path: string): Promise<Buffer> {
  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(resolve(repoRoot), absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Untracked path escapes repository root: ${path}`);
  }

  const metadata = await lstat(absolutePath);
  if (metadata.isSymbolicLink()) {
    return Buffer.from(await readlink(absolutePath), "utf8");
  }
  if (!metadata.isFile()) {
    throw new Error(`Untracked path is not a regular file: ${path}`);
  }
  return readFile(absolutePath);
}

function decodeText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
