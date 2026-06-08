import { describe, it, expect } from "vitest";
import { Brain } from "../src/brain.js";
import { MockLLM } from "../src/llm/mock.js";

describe("Brain.run supervisor", () => {
  it("delegates to an agent then answers", async () => {
    const fetchMock = async () => new Response(JSON.stringify({ tempC: 21 }), { status: 200 });
    const brain = Brain.fromConfig({
      model: "mock",
      agents: [{
        name: "weather", description: "Weather specialist", instructions: "Answer weather.",
        connections: [{ type: "rest", baseUrl: "https://api.example.com",
          operations: [{ name: "get_current", method: "GET", path: "/current", description: "Current weather",
            input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }],
      }],
    });

    const supervisor = new MockLLM([
      { toolCalls: [{ id: "d1", name: "delegate_weather", arguments: { input: "weather in Paris?" } }] },
      { text: "It is 21C in Paris." },
    ]);
    const agentLLM = new MockLLM([
      { toolCalls: [{ id: "a1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "21C and clear." },
    ]);

    const out = await brain.run("weather in Paris?", {
      llmFor: (role) => (role === "supervisor" ? supervisor : agentLLM),
      env: {}, fetch: fetchMock as unknown as typeof fetch,
    });

    expect(out.text).toBe("It is 21C in Paris.");
    expect(out.delegations).toEqual([{ agent: "weather", result: "21C and clear." }]);
  });
});
