import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDeepSeekCoder } from "../src/coder.js";

const execFile = promisify(execFileCallback);

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_CODER_MODEL?.trim();
  if (!apiKey || !model) {
    const missing = [
      ...(apiKey ? [] : ["DEEPSEEK_API_KEY"]),
      ...(model ? [] : ["DEEPSEEK_CODER_MODEL"]),
    ];
    console.log(`Step 3 Coder smoke: SKIPPED — Missing ${missing.join(", ")}.`);
    return;
  }

  const repo = await mkdtemp(join(tmpdir(), "pi-loop-coder-spike-"));
  const fixturePath = join(repo, "status.ts");
  await writeFile(fixturePath, 'export const status = "before";\n', "utf8");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Pi Loop Spike"]);
  await git(repo, ["config", "user.email", "pi-loop@example.invalid"]);
  await git(repo, ["add", "status.ts"]);
  await git(repo, ["commit", "-m", "fixture baseline"]);

  let coder: Awaited<ReturnType<typeof createDeepSeekCoder>> | undefined;
  try {
    coder = await createDeepSeekCoder({ repoRoot: repo, model, apiKey });
    const sessionId = coder.sessionId;
    await coder.run({
      taskRequirements: [
        "Change the exported status in status.ts from before to after.",
        "The final file must contain exactly: export const status = \"after\";",
        "Do not create or modify any other file.",
      ].join("\n"),
    });

    const content = await readFile(fixturePath, "utf8");
    const changedPaths = (await git(repo, ["status", "--short"])).trim().split("\n").filter(Boolean);
    const files = (await readdir(repo)).filter((name) => name !== ".git");
    if (
      content !== 'export const status = "after";\n' ||
      changedPaths.join("\n") !== "M status.ts" ||
      files.join(",") !== "status.ts"
    ) {
      throw new Error(
        `Unexpected Coder result: content=${JSON.stringify(content)}, changes=${JSON.stringify(changedPaths)}, files=${JSON.stringify(files)}`,
      );
    }
    console.log(
      `Step 3 Coder smoke: PASS — Session ${sessionId} changed only status.ts in the temporary Git fixture.`,
    );
  } finally {
    coder?.dispose();
    await rm(repo, { recursive: true, force: true });
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout);
}

await main();
