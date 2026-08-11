import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDeepSeekCoder } from "../src/coder.js";
import { runCoderVerifierLoop } from "../src/loop.js";
import { runVerification } from "../src/verifier.js";

const execFile = promisify(execFileCallback);

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_CODER_MODEL?.trim();
  if (!apiKey || !model) {
    const missing = [
      ...(apiKey ? [] : ["DEEPSEEK_API_KEY"]),
      ...(model ? [] : ["DEEPSEEK_CODER_MODEL"]),
    ];
    console.log(`Step 5 feedback smoke: SKIPPED — Missing ${missing.join(", ")}.`);
    return;
  }

  const repo = await mkdtemp(join(tmpdir(), "pi-loop-feedback-spike-"));
  const targetPath = join(repo, "status.ts");
  let coder: Awaited<ReturnType<typeof createDeepSeekCoder>> | undefined;
  try {
    await writeFile(targetPath, 'export const status = "before";\n', "utf8");
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.name", "Pi Loop Spike"]);
    await git(repo, ["config", "user.email", "pi-loop@example.invalid"]);
    await git(repo, ["add", "status.ts"]);
    await git(repo, ["commit", "-m", "fixture baseline"]);
    const runDirectory = join(repo, ".git", "pi-loop", "runs", "step5-smoke");
    await mkdir(runDirectory, { recursive: true });

    coder = await createDeepSeekCoder({ repoRoot: repo, model, apiKey });
    const result = await runCoderVerifierLoop({
      coder,
      taskRequirements: [
        "This is a two-turn harness fixture.",
        "On the initial request, change status.ts from before to intermediate and stop; do not set it to final yet.",
        "Only after deterministic verification reports that final is required, change status.ts to exactly: export const status = \"final\";",
        "Do not create or modify any other working-tree file.",
      ].join("\n"),
      maxCoderIterations: 2,
      verify: () => runVerification({
        repoRoot: repo,
        artifacts: { runDirectory },
        config: {
          commands: [{
            name: "status-final",
            command: nodeCommand([
              'const { readFileSync } = require("node:fs");',
              'const actual = readFileSync("status.ts", "utf8");',
              'if (actual !== "export const status = \\\"final\\\";\\n") { console.error("expected final status, received " + JSON.stringify(actual)); process.exit(1); }',
            ].join(" ")),
            timeoutMs: 2_000,
          }],
          maxModelOutputChars: 2_000,
          headLines: 20,
          tailLines: 20,
        },
      }),
    });

    const content = await readFile(targetPath, "utf8");
    const changedPaths = (await git(repo, ["status", "--short"])).trim();
    if (
      result.status !== "verification_passed" ||
      result.coderIterations !== 2 ||
      result.verifications.map((verification) => verification.passed).join(",") !== "false,true" ||
      content !== 'export const status = "final";\n' ||
      changedPaths !== "M status.ts"
    ) {
      throw new Error(
        `Unexpected Step 5 result: status=${result.status}, iterations=${result.coderIterations}, verifications=${result.verifications.map((item) => item.passed).join(",")}, content=${JSON.stringify(content)}, changes=${JSON.stringify(changedPaths)}`,
      );
    }
    console.log(
      `Step 5 feedback smoke: PASS — Session ${coder.sessionId} failed verification once, received typed feedback, fixed status.ts, and passed re-verification.`,
    );
  } finally {
    coder?.dispose();
    await rm(repo, { recursive: true, force: true });
  }
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout);
}

await main();
