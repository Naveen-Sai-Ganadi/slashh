import { describe, it, expect } from "vitest";
import { toAiSdkTools, fromAiSdkResult } from "../src/llm/ai-sdk.js";

describe("ai-sdk mapping", () => {
  it("maps our tool specs to AI SDK tool definitions", () => {
    const tools = toAiSdkTools([{ name: "get_current", description: "d", inputSchema: { type: "object", properties: {} } }]);
    expect(Object.keys(tools)).toEqual(["get_current"]);
    expect(tools.get_current.description).toBe("d");
  });

  it("normalizes an AI SDK result with tool calls", () => {
    const out = fromAiSdkResult({ text: "", toolCalls: [{ toolCallId: "1", toolName: "get_current", args: { city: "Paris" } }] });
    expect(out.toolCalls).toEqual([{ id: "1", name: "get_current", arguments: { city: "Paris" } }]);
  });

  it("normalizes a plain text result", () => {
    const out = fromAiSdkResult({ text: "hello", toolCalls: [] });
    expect(out).toEqual({ text: "hello", toolCalls: [] });
  });
});
