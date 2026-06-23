// Hands-on demo of Company Brain — no API key needed (uses the deterministic MockLLM).
// Run from packages/js:  node examples/quickstart.mjs
import { Brain, KnowledgeGraph, MockLLM } from "@slashh/core";

console.log("\n=== 1. Raw knowledge graph (no LLM) ===");
const g = new KnowledgeGraph();
g.upsertRelation({ type: "person", name: "Ada" }, "owns", { type: "service", name: "Billing" }, {}, "wiki");
g.upsertRelation({ type: "service", name: "Billing" }, "depends_on", { type: "service", name: "Auth" }, {}, "wiki");
g.upsertEntity({ type: "service", name: "Billing" }, { language: "go" }, "repo");
console.log("stats:", g.stats());
console.log("search 'who owns billing':", g.search("who owns billing").map((n) => n.id));
console.log("subgraph around Billing:", g.subgraph(["service:billing"], 1).edges.map((e) => `${e.from} --${e.type}--> ${e.to}`));

console.log("\n=== 2. Brain ingest + ask (LLM mocked) ===");
// The ingestor LLM is scripted to return a structured extraction; the knowledge
// LLM is scripted to answer. In production these are real provider calls.
const ingestor = new MockLLM([
  {
    toolCalls: [{
      id: "1", name: "record_knowledge",
      arguments: {
        entities: [
          { type: "service", name: "Billing", props: { language: "go" } },
          { type: "service", name: "Auth" },
          { type: "person", name: "Ada", props: { role: "owner" } },
        ],
        relations: [
          { from: { type: "person", name: "Ada" }, type: "owns", to: { type: "service", name: "Billing" } },
          { from: { type: "service", name: "Billing" }, type: "depends_on", to: { type: "service", name: "Auth" } },
        ],
      },
    }],
  },
]);
const knower = new MockLLM([{ text: "Ada owns Billing, which depends on Auth." }]);
const llmFor = (role) => (role === "ingestor" ? ingestor : knower);

const brain = new Brain({ model: "mock" });
const ingested = await brain.ingest(
  { text: "Ada owns the Billing service (written in Go). Billing depends on Auth.", source: "onboarding-doc" },
  { llmFor }
);
console.log("ingested:", ingested);

const answer = await brain.ask("what does billing depend on and who owns it?", { llmFor });
console.log("answer:", answer.text);
console.log("grounded:", answer.grounded, "| citations:", answer.citations);
