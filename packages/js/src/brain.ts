import { readFileSync } from "node:fs";
import { BrainConfigSchema, type BrainConfig, type AgentConfigT } from "./types.js";
import type { LLM, LLMMessage } from "./llm/interface.js";
import type { Tool } from "./tool.js";
import { buildRestTools } from "./connections/rest.js";
import { openMcpStdio, openMcpHttp } from "./connections/mcp.js";
import { runAgent } from "./agent.js";
import { KnowledgeGraph } from "./graph/knowledge-graph.js";
import { ingestText, type IngestResult } from "./graph/ingest.js";
import { answerFromGraph } from "./graph/query.js";

export interface BrainRunOptions {
  llmFor?: (role: "supervisor" | string) => LLM;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** When true, ingest each delegation result into the knowledge graph so the brain learns over time. */
  learn?: boolean;
}

export interface BrainRunResult {
  text: string;
  delegations: { agent: string; result: string }[];
}

const SUPERVISOR_SYSTEM =
  "You are the supervisor. Delegate to specialist agents via the delegate_* tools, then answer the user.";
const MAX_STEPS = 10;

export class Brain {
  model: string;
  agents: AgentConfigT[];
  /** The brain's accumulated, persistable knowledge of its sources. */
  knowledge: KnowledgeGraph;
  private knowledgePath?: string;

  constructor(opts: {
    model: string;
    agents?: AgentConfigT[];
    knowledge?: KnowledgeGraph;
    knowledgePath?: string;
  }) {
    this.model = opts.model;
    this.agents = opts.agents ?? [];
    this.knowledgePath = opts.knowledgePath;
    this.knowledge =
      opts.knowledge ??
      (opts.knowledgePath ? KnowledgeGraph.load(opts.knowledgePath) : new KnowledgeGraph());
  }

  static fromConfig(input: BrainConfig | string): Brain {
    const raw = typeof input === "string" ? JSON.parse(readFileSync(input, "utf8")) : input;
    const cfg = BrainConfigSchema.parse(raw);
    return new Brain({ model: cfg.model, agents: cfg.agents, knowledgePath: cfg.knowledge?.path });
  }

  /** Pick an LLM for a role, defaulting to the Vercel AI SDK adapter. */
  private async resolveLlmFor(
    opts: BrainRunOptions
  ): Promise<(role: string) => LLM> {
    if (opts.llmFor) return opts.llmFor;
    const { AiSdkLLM } = await import("./llm/ai-sdk.js");
    return (role: string) => {
      const agent = role === "supervisor" ? undefined : this.agents.find((a) => a.name === role);
      return new AiSdkLLM(agent?.model ?? this.model);
    };
  }

  /**
   * Teach the brain from a piece of source text: extract entities/relations
   * into the knowledge graph and persist if a knowledge path is configured.
   */
  async ingest(
    params: { text: string; source: string },
    opts: BrainRunOptions = {}
  ): Promise<IngestResult> {
    const llmFor = await this.resolveLlmFor(opts);
    const result = await ingestText({ ...params, llm: llmFor("ingestor"), graph: this.knowledge });
    if (this.knowledgePath) this.knowledge.save(this.knowledgePath);
    return result;
  }

  /** Answer a question purely from the accumulated knowledge graph. */
  async ask(question: string, opts: BrainRunOptions = {}) {
    const llmFor = await this.resolveLlmFor(opts);
    return answerFromGraph({ question, graph: this.knowledge, llm: llmFor("knowledge") });
  }

  addAgent(agent: AgentConfigT): this {
    this.agents.push(agent);
    return this;
  }

  toConfig(): BrainConfig {
    return BrainConfigSchema.parse({ model: this.model, agents: this.agents });
  }

  /**
   * Open every connection for an agent and return its callable tools plus a
   * closer that releases all stateful connections (MCP clients/subprocesses).
   * REST connections are stateless, so their closer is a no-op.
   */
  private async openAgentTools(
    agent: AgentConfigT,
    opts: BrainRunOptions
  ): Promise<{ tools: Tool[]; close: () => Promise<void> }> {
    const tools: Tool[] = [];
    const closers: Array<() => Promise<void>> = [];
    for (const conn of agent.connections) {
      if (conn.type === "rest") {
        tools.push(...buildRestTools(conn, { env: opts.env, fetch: opts.fetch }));
      } else if (conn.type === "mcp-stdio") {
        const opened = await openMcpStdio(conn, { env: opts.env });
        tools.push(...opened.tools);
        closers.push(opened.close);
      } else if (conn.type === "mcp-http") {
        const opened = await openMcpHttp(conn, { env: opts.env });
        tools.push(...opened.tools);
        closers.push(opened.close);
      }
    }
    const close = async () => {
      for (const c of closers) {
        try {
          await c();
        } catch {
          /* best-effort cleanup */
        }
      }
    };
    return { tools, close };
  }

  async run(input: string, opts: BrainRunOptions = {}): Promise<BrainRunResult> {
    const llmFor = await this.resolveLlmFor(opts);

    const supervisor = llmFor("supervisor");
    const delegations: { agent: string; result: string }[] = [];

    const delegateTools: Tool[] = this.agents.map((agent) => ({
      name: `delegate_${agent.name}`,
      description: `Delegate to ${agent.name}: ${agent.description}`,
      inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
      invoke: async (args) => {
        const { tools: agentTools, close } = await this.openAgentTools(agent, opts);
        try {
          const result = await runAgent({
            agent,
            input: String(args.input ?? ""),
            llm: llmFor(agent.name),
            tools: agentTools,
          });
          delegations.push({ agent: agent.name, result: result.text });
          // Self-evolving loop: durably learn from what the agent discovered.
          if (opts.learn && result.text.trim()) {
            await ingestText({
              text: result.text,
              source: `agent:${agent.name}`,
              llm: llmFor("ingestor"),
              graph: this.knowledge,
            });
            if (this.knowledgePath) this.knowledge.save(this.knowledgePath);
          }
          return { result: result.text };
        } finally {
          await close();
        }
      },
    }));

    // The supervisor can always consult accumulated knowledge before delegating.
    const queryTool: Tool = {
      name: "query_knowledge",
      description:
        "Answer a question from the company's accumulated knowledge graph before delegating to a live source.",
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      invoke: async (args) =>
        answerFromGraph({
          question: String(args.question ?? ""),
          graph: this.knowledge,
          llm: llmFor("knowledge"),
        }),
    };

    const supervisorTools = [queryTool, ...delegateTools];
    const byName = new Map(supervisorTools.map((t) => [t.name, t]));
    const messages: LLMMessage[] = [{ role: "user", content: input }];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await supervisor.complete({
        system: SUPERVISOR_SYSTEM,
        messages,
        tools: supervisorTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });

      if (res.toolCalls?.length) {
        for (const call of res.toolCalls) {
          const tool = byName.get(call.name);
          const content = JSON.stringify(
            tool ? await tool.invoke(call.arguments) : { error: `unknown ${call.name}` }
          );
          messages.push({ role: "assistant", content: "", toolCallId: call.id, name: call.name });
          messages.push({ role: "tool", content, toolCallId: call.id, name: call.name });
        }
        continue;
      }

      return { text: res.text ?? "", delegations };
    }
    throw new Error("Supervisor exceeded step budget");
  }
}
