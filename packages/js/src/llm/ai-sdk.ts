import { generateText, jsonSchema, tool as aiTool } from "ai";
import type { LLM, LLMRequest, LLMResponse, LLMToolSpec } from "./interface.js";

export function toAiSdkTools(specs: LLMToolSpec[]): Record<string, ReturnType<typeof aiTool>> {
  const out: Record<string, ReturnType<typeof aiTool>> = {};
  for (const s of specs) {
    out[s.name] = aiTool({
      description: s.description,
      parameters: jsonSchema(s.inputSchema as Record<string, unknown>),
    });
  }
  return out;
}

export function fromAiSdkResult(result: {
  text: string;
  toolCalls: { toolCallId: string; toolName: string; args: unknown }[];
}): LLMResponse {
  if (result.toolCalls?.length) {
    return {
      text: result.text || undefined,
      toolCalls: result.toolCalls.map((c) => ({
        id: c.toolCallId,
        name: c.toolName,
        arguments: (c.args ?? {}) as Record<string, unknown>,
      })),
    };
  }
  return { text: result.text, toolCalls: [] };
}

export class AiSdkLLM implements LLM {
  constructor(private model: string) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const result = await generateText({
      model: this.model as never, // AI SDK resolves "provider/model" strings via the gateway
      system: req.system,
      messages: req.messages.map(
        (m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content } as never)
      ),
      tools: toAiSdkTools(req.tools),
    });
    return fromAiSdkResult(result as never);
  }
}
