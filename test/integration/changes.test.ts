import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReviewInputWithinLimit,
  collectChanges,
  ReviewInputTooLargeError,
  serializeChangeSetForReview,
} from "../../src/changes.js";

const execFileAsync = promisify(execFile);
const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Git change collection", () => {
  it("collects tracked and untracked changes without mutating the index", async () => {
    const fixture = await createRepository();
    await writeFile(join(fixture.root, "tracked.txt"), "changed\n", "utf8");
    await mkdir(join(fixture.root, "new folder"));
    await writeFile(join(fixture.root, "new folder", "hello world.txt"), "hello\nworld", "utf8");
    await writeFile(join(fixture.root, "binary.dat"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(fixture.root, "..notes"), "valid dot path", "utf8");
    await symlink("tracked.txt", join(fixture.root, "tracked-link"));
    await writeFile(join(fixture.root, "ignored.log"), "ignore me", "utf8");
    const statusBefore = await git(fixture.root, ["status", "--porcelain=v1"]);
    const indexBefore = await git(fixture.root, ["diff", "--cached"]);

    const changes = await collectChanges(fixture.root, fixture.baseCommit);
    const reviewInput = serializeChangeSetForReview(changes);

    expect(changes.trackedDiff).toContain("+changed");
    expect(changes.changedPaths).toEqual([
      "..notes",
      "binary.dat",
      "new folder/hello world.txt",
      "tracked-link",
      "tracked.txt",
    ]);
    expect(changes.untrackedFiles).toEqual([
      { path: "..notes", binary: false, sizeBytes: 14, content: "valid dot path" },
      { path: "binary.dat", binary: true, sizeBytes: 4 },
      {
        path: "new folder/hello world.txt",
        binary: false,
        sizeBytes: 11,
        content: "hello\nworld",
      },
      { path: "tracked-link", binary: false, sizeBytes: 11, content: "tracked.txt" },
    ]);
    expect(reviewInput).toContain("=== NEW FILE: new folder/hello world.txt ===\nhello\nworld\n=== END NEW FILE ===");
    expect(reviewInput).toContain("=== NEW BINARY FILE: binary.dat (4 bytes) ===");
    expect(reviewInput).not.toContain("ignored.log");
    expect(changes.totalChars).toBe(reviewInput.length);
    expect(await git(fixture.root, ["status", "--porcelain=v1"])).toBe(statusBefore);
    expect(await git(fixture.root, ["diff", "--cached"])).toBe(indexBefore);
  });

  it("diffs from the immutable base commit, including later committed changes", async () => {
    const fixture = await createRepository();
    await writeFile(join(fixture.root, "tracked.txt"), "committed later\n", "utf8");
    await git(fixture.root, ["add", "tracked.txt"]);
    await git(fixture.root, ["commit", "-m", "later commit"]);

    const changes = await collectChanges(fixture.root, fixture.baseCommit);

    expect(changes.trackedDiff).toContain("+committed later");
    expect(changes.changedPaths).toEqual(["tracked.txt"]);
  });

  it("enforces the exact serialized reviewer input limit", async () => {
    const fixture = await createRepository();
    await writeFile(join(fixture.root, "new.txt"), "review me", "utf8");
    const changes = await collectChanges(fixture.root, fixture.baseCommit);

    expect(() => assertReviewInputWithinLimit(changes, changes.totalChars)).not.toThrow();
    expect(() => assertReviewInputWithinLimit(changes, changes.totalChars - 1)).toThrowError(
      ReviewInputTooLargeError,
    );
    try {
      assertReviewInputWithinLimit(changes, changes.totalChars - 1);
    } catch (error) {
      expect(error).toMatchObject({
        code: "review_input_too_large",
        actualChars: changes.totalChars,
        maxChars: changes.totalChars - 1,
      });
    }
    expect(() => assertReviewInputWithinLimit(changes, 0)).toThrowError(RangeError);
  });
});

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pi-loop-changes-test-"));
  temporaryPaths.push(root);
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Pi Loop Test"]);
  await git(root, ["config", "user.email", "pi-loop@example.test"]);
  await writeFile(join(root, ".gitignore"), "*.log\n", "utf8");
  await writeFile(join(root, "tracked.txt"), "original\n", "utf8");
  await git(root, ["add", ".gitignore", "tracked.txt"]);
  await git(root, ["commit", "-m", "baseline"]);
  const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
  return { root, baseCommit };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
