import { describe, it, expect } from "vitest";
import { Brain } from "../src/brain.js";

const cfg = {
  model: "anthropic/claude-sonnet-4-6",
  agents: [{ name: "weather", description: "Looks up weather", instructions: "Answer.", connections: [] }],
};

describe("Brain config<->code", () => {
  it("loads from config and serializes back identically", () => {
    const brain = Brain.fromConfig(cfg);
    expect(brain.toConfig()).toEqual(cfg);
  });

  it("builds the same model via the code API", () => {
    const brain = new Brain({ model: "anthropic/claude-sonnet-4-6" })
      .addAgent({ name: "weather", description: "Looks up weather", instructions: "Answer.", connections: [] });
    expect(brain.toConfig()).toEqual(cfg);
  });

  it("rejects an invalid config", () => {
    expect(() => Brain.fromConfig({ agents: [] } as any)).toThrow();
  });
});
