import type { AgentConfigT } from "./types.js";
import type { LLM, LLMMessage, LLMToolCall } from "./llm/interface.js";
import type { Tool } from "./tool.js";

export interface AgentRunResult {
  text: string;
  toolCalls: LLMToolCall[];
}

const MAX_STEPS = 10;

export async function runAgent(params: {
  agent: AgentConfigT;
  input: string;
  llm: LLM;
  tools: Tool[];
}): Promise<AgentRunResult> {
  const { agent, input, llm, tools } = params;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages: LLMMessage[] = [{ role: "user", content: input }];
  const allCalls: LLMToolCall[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.complete({
      system: agent.instructions,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });

    if (res.toolCalls?.length) {
      for (const call of res.toolCalls) {
        allCalls.push(call);
        const tool = byName.get(call.name);
        let content: string;
        try {
          content = JSON.stringify(tool ? await tool.invoke(call.arguments) : { error: `unknown tool ${call.name}` });
        } catch (err) {
          content = JSON.stringify({ error: String(err instanceof Error ? err.message : err) });
        }
        messages.push({ role: "assistant", content: "", toolCallId: call.id, name: call.name });
        messages.push({ role: "tool", content, toolCallId: call.id, name: call.name });
      }
      continue;
    }

    return { text: res.text ?? "", toolCalls: allCalls };
  }
  throw new Error(`Agent ${agent.name} exceeded ${MAX_STEPS} steps`);
}
