import { defineConfig } from "./src/config.js";

export default defineConfig({
  verification: {
    commands: [
      { name: "typecheck", command: "npm run typecheck", timeoutMs: 120_000 },
      { name: "test", command: "npm test", timeoutMs: 120_000 },
      { name: "build", command: "npm run build", timeoutMs: 120_000 },
    ],
  },
});

