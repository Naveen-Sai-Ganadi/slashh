import { describe, it, expect } from "vitest";
import { BrainConfigSchema } from "../src/types.js";

describe("BrainConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const cfg = {
      model: "anthropic/claude-sonnet-4-6",
      agents: [
        {
          name: "weather",
          description: "Looks up weather",
          instructions: "Answer weather questions.",
          connections: [
            { type: "rest", baseUrl: "https://api.example.com", auth: { header: "Authorization", value: "Bearer ${WX_KEY}" },
              operations: [{ name: "get_current", method: "GET", path: "/current", description: "Current weather",
                input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }
          ]
        }
      ]
    };
    expect(() => BrainConfigSchema.parse(cfg)).not.toThrow();
  });

  it("rejects a config missing agent name", () => {
    expect(() => BrainConfigSchema.parse({ model: "x", agents: [{ description: "d", instructions: "i", connections: [] }] }))
      .toThrow();
  });
});
