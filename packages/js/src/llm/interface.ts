export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  tools: LLMToolSpec[];
}

export interface LLMResponse {
  text?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLM {
  complete(req: LLMRequest): Promise<LLMResponse>;
}
