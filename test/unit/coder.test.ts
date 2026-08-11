import { describe, expect, it, vi } from "vitest";
import {
  CoderProviderError,
  DeepSeekCoder,
  renderInitialCoderPrompt,
} from "../../src/coder.js";

describe("DeepSeekCoder", () => {
  it("uses one session for the initial task and typed feedback", async () => {
    const session = fakeSession();
    const coder = new DeepSeekCoder(session);

    await coder.run({ taskRequirements: "Keep the API stable.\n" });
    await coder.run({
      taskRequirements: "Keep the API stable.",
      feedback: {
        type: "verification_failure",
        failedCheck: "test",
        command: "npm test",
        exitCode: 1,
        timedOut: false,
        outputForModel: "expected 200, got 500",
        fullOutputPath: ".git/pi-loop/runs/x/verifier/test.log",
      },
    });

    expect(coder.sessionId).toBe("session-1");
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(session.prompt.mock.calls[0]?.[0]).toContain(
      "Immutable task requirements:\nKeep the API stable.\n\n\nInspect the repository",
    );
    expect(session.prompt.mock.calls[1]?.[0]).toContain("expected 200, got 500");
    expect(session.prompt.mock.calls[1]?.[0]).toContain("Keep the API stable.");
    expect(session.prompt).toHaveBeenCalledWith(expect.any(String), {
      expandPromptTemplates: false,
    });
  });

  it("rejects empty task requirements before prompting", async () => {
    const session = fakeSession();
    const coder = new DeepSeekCoder(session);

    await expect(coder.run({ taskRequirements: "  " })).rejects.toThrow(/must not be empty/);
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it("delegates cancellation and disposal to Pi", async () => {
    const session = fakeSession();
    const coder = new DeepSeekCoder(session);

    await coder.abort();
    coder.dispose();

    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.unsubscribe).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("raises provider errors reported through Pi events", async () => {
    const session = fakeSession();
    session.prompt.mockImplementationOnce(async () => {
      session.emit({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "Connection error.",
        },
      });
    });
    const coder = new DeepSeekCoder(session);

    await expect(coder.run({ taskRequirements: "Make the change." })).rejects.toThrowError(
      CoderProviderError,
    );
  });
});

describe("renderInitialCoderPrompt", () => {
  it("labels the complete task as immutable", () => {
    expect(renderInitialCoderPrompt("Requirement A\nRequirement B")).toContain(
      "Immutable task requirements:\nRequirement A\nRequirement B",
    );
  });
});

function fakeSession() {
  let listener: ((event: any) => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    sessionId: "session-1",
    systemPrompt: "coder prompt",
    prompt: vi.fn(
      async (_text: string, _options?: { expandPromptTemplates?: boolean }) => undefined,
    ),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => ["read", "bash", "edit", "write", "grep", "find", "ls"]),
    getSessionStats: vi.fn(() => ({
      sessionFile: undefined,
      sessionId: "session-1",
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    })),
    subscribe: vi.fn((nextListener: (event: any) => void) => {
      listener = nextListener;
      return unsubscribe;
    }),
    unsubscribe,
    emit: (event: any) => listener?.(event),
  };
}
