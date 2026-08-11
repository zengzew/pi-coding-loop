import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODER_TOOLS, createDeepSeekCoder } from "../../src/coder.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("createDeepSeekCoder", () => {
  it("creates an isolated session with the exact Coder tool allowlist", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pi-loop-coder-test-"));
    temporaryPaths.push(repo);
    await writeFile(join(repo, "fixture.txt"), "before\n", "utf8");

    const coder = await createDeepSeekCoder({
      repoRoot: repo,
      model: "deepseek-v4-flash",
      apiKey: "test-key",
    });

    try {
      expect(coder.sessionId).toBeTruthy();
      expect([...coder.activeToolNames].sort()).toEqual([...CODER_TOOLS].sort());
    } finally {
      coder.dispose();
    }
  });
});
