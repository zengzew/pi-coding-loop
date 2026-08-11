import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, ConfigurationError, loadConfig } from "../../src/config.js";

const models = {
  DEEPSEEK_CODER_MODEL: "deepseek-v4-flash",
  KIMI_REVIEWER_MODEL: "kimi-k2.7-code",
};

describe("loadConfig", () => {
  it("uses the frozen V1 defaults", () => {
    const config = loadConfig({}, models);
    expect(config.reviewer.provider).toBe("moonshotai-cn");
    expect(config.reviewer).toMatchObject(CONFIG_DEFAULTS.reviewer);
    expect(config.verification).toMatchObject(CONFIG_DEFAULTS.verification);
    expect(config.limits).toEqual(CONFIG_DEFAULTS.limits);
  });

  it("fails clearly when model configuration is absent", () => {
    expect(() => loadConfig({}, {})).toThrowError(ConfigurationError);
    expect(() => loadConfig({}, {})).toThrow(/coder\.model is required/);
  });

  it("rejects invalid verification commands", () => {
    expect(() =>
      loadConfig(
        { verification: { commands: [{ name: "", command: "npm test", timeoutMs: 0 }] } },
        models,
      ),
    ).toThrow(/commands\[0\]\.name/);
  });
});
