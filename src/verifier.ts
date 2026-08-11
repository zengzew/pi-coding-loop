import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import type {
  PiLoopConfig,
  RunArtifacts,
  VerificationCheckResult,
  VerificationCommand,
  VerificationResult,
} from "./types.js";

const OUTPUT_TRUNCATED_MARKER = "[... output truncated ...]";
const LINE_TRUNCATED_MARKER = "[... line truncated ...]";

export interface RunVerificationOptions {
  repoRoot: string;
  artifacts: Pick<RunArtifacts, "runDirectory">;
  config: PiLoopConfig["verification"];
  signal?: AbortSignal;
}

export async function runVerification(
  options: RunVerificationOptions,
): Promise<VerificationResult> {
  const startedAt = performance.now();
  const verifierDirectory = join(options.artifacts.runDirectory, "verifier");
  await mkdir(verifierDirectory, { recursive: true });
  const sequenceStart = await nextLogSequence(verifierDirectory);
  const checks: VerificationCheckResult[] = [];

  for (const [index, command] of options.config.commands.entries()) {
    const check = await runCheck({
      repoRoot: options.repoRoot,
      verifierDirectory,
      command,
      index: sequenceStart + index,
      maxModelOutputChars: options.config.maxModelOutputChars,
      headLines: options.config.headLines,
      tailLines: options.config.tailLines,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    checks.push(check);
    if (!check.passed) {
      return {
        passed: false,
        checks,
        failedCheck: check,
        durationMs: elapsedMilliseconds(startedAt),
      };
    }
  }

  return {
    passed: true,
    checks,
    durationMs: elapsedMilliseconds(startedAt),
  };
}

interface RunCheckOptions {
  repoRoot: string;
  verifierDirectory: string;
  command: VerificationCommand;
  index: number;
  maxModelOutputChars: number;
  headLines: number;
  tailLines: number;
  signal?: AbortSignal;
}

async function runCheck(options: RunCheckOptions): Promise<VerificationCheckResult> {
  const startedAt = performance.now();
  const logName = `${String(options.index + 1).padStart(3, "0")}-${safeCheckName(options.command.name)}.log`;
  const fullOutputPath = join(options.verifierDirectory, logName);
  const stdoutTemporaryPath = `${fullOutputPath}.stdout.tmp`;
  const stderrTemporaryPath = `${fullOutputPath}.stderr.tmp`;
  const stdoutFile = createWriteStream(stdoutTemporaryPath, { flags: "wx" });
  const stderrFile = createWriteStream(stderrTemporaryPath, { flags: "wx" });
  const output = new BoundedOutputCollector(
    options.headLines,
    options.tailLines,
    options.maxModelOutputChars,
  );
  const stdoutDecoder = new StreamLineDecoder("stdout", options.maxModelOutputChars, output);
  const stderrDecoder = new StreamLineDecoder("stderr", options.maxModelOutputChars, output);

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let spawnError: Error | undefined;
  let exitCode: number | null = null;
  const detached = process.platform !== "win32";

  try {
    const child = spawn(options.command.command, {
      cwd: options.repoRoot,
      shell: true,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      stdoutDecoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      stderrDecoder.write(chunk);
    });
    child.stdout.pipe(stdoutFile);
    child.stderr.pipe(stderrFile);

    const completed = waitForChild(
      child,
      options.command.timeoutMs,
      detached,
      () => {
        timedOut = true;
      },
      options.signal,
    );
    const completion = await completed;
    exitCode = completion.spawnError ? null : completion.exitCode;
    spawnError = completion.spawnError;
    await Promise.all([finished(stdoutFile), finished(stderrFile)]);
    stdoutDecoder.end();
    stderrDecoder.end();
    if (spawnError) output.addLine(`[spawn] ${spawnError.message}\n`);
    await writeFullLog(
      fullOutputPath,
      stdoutTemporaryPath,
      stderrTemporaryPath,
      spawnError,
    );
  } finally {
    await Promise.all([
      rm(stdoutTemporaryPath, { force: true }),
      rm(stderrTemporaryPath, { force: true }),
    ]);
  }

  return {
    name: options.command.name,
    command: options.command.command,
    passed: exitCode === 0 && !timedOut && !spawnError,
    exitCode,
    timedOut,
    stdoutBytes,
    stderrBytes,
    outputForModel: output.render(),
    fullOutputPath,
    durationMs: elapsedMilliseconds(startedAt),
  };
}

interface ChildCompletion {
  exitCode: number | null;
  spawnError: Error | undefined;
}

function waitForChild(
  child: ChildProcess,
  timeoutMs: number,
  detached: boolean,
  onTimeout: () => void,
  signal?: AbortSignal,
): Promise<ChildCompletion> {
  return new Promise((resolve) => {
    let spawnError: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      onTimeout();
      terminateChild(child, "SIGTERM", detached);
      forceKillTimer = setTimeout(() => terminateChild(child, "SIGKILL", detached), 1_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    const onAbort = () => {
      terminateChild(child, "SIGTERM", detached);
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => terminateChild(child, "SIGKILL", detached), 1_000);
        forceKillTimer.unref();
      }
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, spawnError });
    });
  });
}

function terminateChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
  detached: boolean,
): void {
  if (detached && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when the process group is already gone.
    }
  }
  child.kill(signal);
}

async function writeFullLog(
  fullOutputPath: string,
  stdoutPath: string,
  stderrPath: string,
  spawnError: Error | undefined,
): Promise<void> {
  const file = await open(fullOutputPath, "wx");
  try {
    await file.writeFile("=== STDOUT ===\n");
    await appendFile(file, stdoutPath);
    await file.writeFile("\n=== STDERR ===\n");
    await appendFile(file, stderrPath);
    if (spawnError) {
      await file.writeFile(`\n=== SPAWN ERROR ===\n${spawnError.message}\n`);
    }
  } finally {
    await file.close();
  }
}

async function appendFile(destination: Awaited<ReturnType<typeof open>>, source: string) {
  for await (const chunk of createReadStream(source)) {
    await destination.writeFile(chunk as Buffer);
  }
}

interface OutputLine {
  index: number;
  text: string;
}

class BoundedOutputCollector {
  private readonly head: OutputLine[] = [];
  private readonly tail: OutputLine[] = [];
  private totalLines = 0;

  constructor(
    private readonly headLines: number,
    private readonly tailLines: number,
    private readonly maxChars: number,
  ) {}

  addLine(text: string): void {
    const line = { index: this.totalLines++, text: text.slice(0, this.maxChars) };
    if (this.head.length < this.headLines) this.head.push(line);
    this.tail.push(line);
    if (this.tail.length > this.tailLines) this.tail.shift();
  }

  render(): string {
    if (this.totalLines === 0) return truncateToChars("(no output)\n", this.maxChars);
    const selected = new Map<number, string>();
    for (const line of [...this.head, ...this.tail]) selected.set(line.index, line.text);
    const ordered = [...selected.entries()].sort(([left], [right]) => left - right);
    const parts: string[] = [];
    let previousIndex = -1;
    for (const [index, text] of ordered) {
      if (previousIndex >= 0 && index > previousIndex + 1) {
        parts.push(`${OUTPUT_TRUNCATED_MARKER}\n`);
      }
      parts.push(text);
      previousIndex = index;
    }
    return truncateToChars(parts.join(""), this.maxChars);
  }
}

class StreamLineDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private prefix = "";
  private suffix = "";
  private lineChars = 0;

  constructor(
    private readonly source: "stdout" | "stderr",
    private readonly maxLineChars: number,
    private readonly output: BoundedOutputCollector,
  ) {}

  write(chunk: Buffer): void {
    this.process(this.decoder.write(chunk));
  }

  end(): void {
    this.process(this.decoder.end());
    if (this.lineChars > 0) this.emitLine(false);
  }

  private process(text: string): void {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      if (newline === -1) {
        this.addSegment(text.slice(start));
        return;
      }
      this.addSegment(text.slice(start, newline));
      this.emitLine(true);
      start = newline + 1;
    }
  }

  private addSegment(segment: string): void {
    this.lineChars += segment.length;
    if (this.prefix.length < this.maxLineChars) {
      this.prefix += segment.slice(0, this.maxLineChars - this.prefix.length);
    }
    this.suffix = `${this.suffix}${segment}`.slice(-this.maxLineChars);
  }

  private emitLine(withNewline: boolean): void {
    const text = this.materializeLine();
    this.output.addLine(`[${this.source}] ${text}${withNewline ? "\n" : ""}`);
    this.prefix = "";
    this.suffix = "";
    this.lineChars = 0;
  }

  private materializeLine(): string {
    if (this.lineChars <= this.maxLineChars) return this.prefix;
    if (this.maxLineChars <= LINE_TRUNCATED_MARKER.length) {
      return LINE_TRUNCATED_MARKER.slice(0, this.maxLineChars);
    }
    const available = this.maxLineChars - LINE_TRUNCATED_MARKER.length;
    const headChars = Math.ceil(available / 2);
    const tailChars = available - headChars;
    return `${this.prefix.slice(0, headChars)}${LINE_TRUNCATED_MARKER}${
      tailChars > 0 ? this.suffix.slice(-tailChars) : ""
    }`;
  }
}

function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n${OUTPUT_TRUNCATED_MARKER}\n`;
  if (maxChars <= marker.length) return marker.slice(0, maxChars);
  const available = maxChars - marker.length;
  const headChars = Math.ceil(available / 2);
  const tailChars = available - headChars;
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function safeCheckName(name: string): string {
  return name
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/^\.+/g, "")
    .slice(0, 80) || "check";
}

async function nextLogSequence(verifierDirectory: string): Promise<number> {
  const entries = await readdir(verifierDirectory);
  let highestSequence = 0;
  for (const entry of entries) {
    const match = /^(\d+)-.+\.log$/.exec(entry);
    if (match?.[1]) highestSequence = Math.max(highestSequence, Number(match[1]));
  }
  return highestSequence;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
