import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Brain } from "../src/brain.js";
import { MockLLM } from "../src/llm/mock.js";
import type { LLM } from "../src/llm/interface.js";

const recordTurn = (entities: unknown[], relations: unknown[] = []) => ({
  toolCalls: [{ id: "r1", name: "record_knowledge", arguments: { entities, relations } }],
});

describe("Brain knowledge integration", () => {
  it("ingests text, persists to disk, and answers from the graph", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "brain-kg-")), "graph.json");

    const ingestor = new MockLLM([
      recordTurn(
        [
          { type: "service", name: "Billing" },
          { type: "service", name: "Auth" },
        ],
        [{ from: { type: "service", name: "Billing" }, type: "depends_on", to: { type: "service", name: "Auth" } }]
      ),
    ]);
    const knower = new MockLLM([{ text: "Billing depends on Auth." }]);
    const llmFor = (role: string): LLM => {
      if (role === "ingestor") return ingestor;
      if (role === "knowledge") return knower;
      throw new Error(`unexpected role ${role}`);
    };

    const brain = new Brain({ model: "mock", knowledgePath: path });
    const ingest = await brain.ingest({ text: "Billing depends on Auth.", source: "doc" }, { llmFor });
    expect(ingest.stats).toEqual({ nodes: 2, edges: 1 });

    const ans = await brain.ask("what does billing depend on?", { llmFor });
    expect(ans.grounded).toBe(true);
    expect(ans.text).toBe("Billing depends on Auth.");

    // Persisted: a fresh brain pointed at the same path recovers the knowledge.
    const reborn = new Brain({ model: "mock", knowledgePath: path });
    expect(reborn.knowledge.stats()).toEqual({ nodes: 2, edges: 1 });
  });

  it("learns from delegation results when learn:true", async () => {
    const supervisor = new MockLLM([
      { toolCalls: [{ id: "d1", name: "delegate_research", arguments: { input: "who owns billing?" } }] },
      { text: "Ada owns Billing." },
    ]);
    const research = new MockLLM([{ text: "Ada owns the Billing service." }]);
    const ingestor = new MockLLM([
      recordTurn([{ type: "person", name: "Ada" }], [
        { from: { type: "person", name: "Ada" }, type: "owns", to: { type: "service", name: "Billing" } },
      ]),
    ]);
    const llmFor = (role: string): LLM => {
      if (role === "supervisor") return supervisor;
      if (role === "research") return research;
      if (role === "ingestor") return ingestor;
      throw new Error(`unexpected role ${role}`);
    };

    const brain = new Brain({
      model: "mock",
      agents: [{ name: "research", description: "Researcher", instructions: "Research.", connections: [] }],
    });
    const result = await brain.run("who owns billing?", { llmFor, learn: true });

    expect(result.text).toBe("Ada owns Billing.");
    // The delegation result was distilled into durable knowledge.
    expect(brain.knowledge.getNode("person:ada")).toBeDefined();
    expect(brain.knowledge.allEdges().some((e) => e.type === "owns")).toBe(true);
  });
});
