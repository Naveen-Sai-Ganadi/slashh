import { readFileSync } from "node:fs";
import { BrainConfigSchema, type BrainConfig, type AgentConfigT } from "./types.js";

export class Brain {
  model: string;
  agents: AgentConfigT[];

  constructor(opts: { model: string; agents?: AgentConfigT[] }) {
    this.model = opts.model;
    this.agents = opts.agents ?? [];
  }

  static fromConfig(input: BrainConfig | string): Brain {
    const raw = typeof input === "string" ? JSON.parse(readFileSync(input, "utf8")) : input;
    const cfg = BrainConfigSchema.parse(raw);
    return new Brain({ model: cfg.model, agents: cfg.agents });
  }

  addAgent(agent: AgentConfigT): this {
    this.agents.push(agent);
    return this;
  }

  toConfig(): BrainConfig {
    return BrainConfigSchema.parse({ model: this.model, agents: this.agents });
  }
}
