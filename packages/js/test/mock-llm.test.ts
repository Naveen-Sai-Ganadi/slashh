import { describe, it, expect } from "vitest";
import { MockLLM } from "../src/llm/mock.js";

describe("MockLLM", () => {
  it("returns scripted turns in order", async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: "1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "It is sunny in Paris." },
    ]);
    const first = await llm.complete({ system: "s", messages: [], tools: [] });
    expect(first.toolCalls?.[0].name).toBe("get_current");
    const second = await llm.complete({ system: "s", messages: [], tools: [] });
    expect(second.text).toBe("It is sunny in Paris.");
  });

  it("throws when scripted turns run out", async () => {
    const llm = new MockLLM([{ text: "done" }]);
    await llm.complete({ system: "s", messages: [], tools: [] });
    await expect(llm.complete({ system: "s", messages: [], tools: [] })).rejects.toThrow(/no scripted turn/i);
  });
});
