import type { RunEvent } from "./types.js";

export function serializeRunEvent(event: RunEvent): string {
  assertRunEvent(event);
  return `${JSON.stringify(event)}\n`;
}

function assertRunEvent(event: RunEvent): void {
  if (!event.eventId || !event.runId || !event.type) {
    throw new TypeError("Run events require eventId, runId, and type");
  }
  if (Number.isNaN(Date.parse(event.timestamp))) {
    throw new TypeError("Run event timestamp must be an ISO-compatible date string");
  }
}

