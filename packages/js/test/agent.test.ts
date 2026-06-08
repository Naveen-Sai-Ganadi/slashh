import { describe, it, expect } from "vitest";
import { runAgent } from "../src/agent.js";
import { MockLLM } from "../src/llm/mock.js";
import type { Tool } from "../src/tool.js";

describe("runAgent", () => {
  it("calls a tool then returns the final text", async () => {
    const calls: Record<string, unknown>[] = [];
    const tool: Tool = {
      name: "get_current", description: "Current weather",
      inputSchema: { type: "object", properties: {} },
      async invoke(args) { calls.push(args); return { tempC: 21 }; },
    };
    const llm = new MockLLM([
      { toolCalls: [{ id: "t1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "It is 21C in Paris." },
    ]);
    const out = await runAgent({
      agent: { name: "weather", description: "d", instructions: "Answer.", connections: [] },
      input: "weather in Paris?", llm, tools: [tool],
    });
    expect(calls).toEqual([{ city: "Paris" }]);
    expect(out.text).toBe("It is 21C in Paris.");
    expect(out.toolCalls.map((c) => c.name)).toEqual(["get_current"]);
  });
});
