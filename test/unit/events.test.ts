import { describe, expect, it } from "vitest";
import { serializeRunEvent } from "../../src/events.js";

describe("serializeRunEvent", () => {
  it("writes one JSONL record", () => {
    const line = serializeRunEvent({
      eventId: "event-1",
      runId: "run-1",
      type: "run_started",
      timestamp: "2026-08-09T00:00:00.000Z",
      data: { branch: "feature/example" },
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({ eventId: "event-1", type: "run_started" });
  });
});

