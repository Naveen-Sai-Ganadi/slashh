import type { LLM, LLMRequest, LLMResponse } from "./interface.js";

export class MockLLM implements LLM {
  private turns: LLMResponse[];
  private i = 0;
  constructor(turns: LLMResponse[]) { this.turns = turns; }
  async complete(_req: LLMRequest): Promise<LLMResponse> {
    if (this.i >= this.turns.length) throw new Error("MockLLM: no scripted turn left");
    return this.turns[this.i++];
  }
}
