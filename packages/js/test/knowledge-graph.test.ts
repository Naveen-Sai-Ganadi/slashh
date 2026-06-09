import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeGraph } from "../src/graph/knowledge-graph.js";
import { ingestText } from "../src/graph/ingest.js";
import { answerFromGraph } from "../src/graph/query.js";
import { MockLLM } from "../src/llm/mock.js";

describe("KnowledgeGraph", () => {
  it("merges repeated entities by type+name and tracks provenance", () => {
    const g = new KnowledgeGraph();
    g.upsertEntity({ type: "service", name: "Billing" }, { lang: "go" }, "doc-a");
    g.upsertEntity({ type: "service", name: "Billing" }, { team: "payments" }, "doc-b");

    expect(g.stats().nodes).toBe(1);
    const node = g.getNode("service:billing")!;
    expect(node.props).toEqual({ lang: "go", team: "payments" });
    expect(node.sources).toEqual(["doc-a", "doc-b"]);
  });

  it("creates relations and expands neighbourhoods via subgraph", () => {
    const g = new KnowledgeGraph();
    g.upsertRelation({ type: "service", name: "Billing" }, "depends_on", { type: "service", name: "Auth" });
    const sub = g.subgraph(["service:billing"], 1);
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["service:auth", "service:billing"]);
    expect(sub.edges).toHaveLength(1);
  });

  it("ranks nodes by query token overlap", () => {
    const g = new KnowledgeGraph();
    g.upsertEntity({ type: "person", name: "Ada Lovelace" }, { role: "engineer" });
    g.upsertEntity({ type: "service", name: "Billing" });
    const hits = g.search("who is ada");
    expect(hits[0].id).toBe("person:ada-lovelace");
  });

  it("round-trips through disk persistence", () => {
    const g = new KnowledgeGraph();
    g.upsertRelation({ type: "person", name: "Ada" }, "owns", { type: "service", name: "Billing" }, {}, "src");
    const path = join(mkdtempSync(join(tmpdir(), "kg-")), "graph.json");
    g.save(path);

    const loaded = KnowledgeGraph.load(path);
    expect(loaded.stats()).toEqual({ nodes: 2, edges: 1 });
    expect(loaded.getNode("service:billing")!.name).toBe("Billing");
  });
});

describe("ingestText", () => {
  it("extracts entities/relations from text into the graph", async () => {
    const llm = new MockLLM([
      {
        toolCalls: [
          {
            id: "x1",
            name: "record_knowledge",
            arguments: {
              entities: [
                { type: "service", name: "Billing", props: { lang: "go" } },
                { type: "service", name: "Auth" },
              ],
              relations: [
                { from: { type: "service", name: "Billing" }, type: "depends_on", to: { type: "service", name: "Auth" } },
              ],
            },
          },
        ],
      },
    ]);
    const g = new KnowledgeGraph();
    const result = await ingestText({ text: "Billing depends on Auth.", source: "readme", llm, graph: g });

    expect(result).toMatchObject({ source: "readme", entities: 2, relations: 1 });
    expect(g.stats()).toEqual({ nodes: 2, edges: 1 });
    expect(g.getNode("service:billing")!.sources).toEqual(["readme"]);
  });
});

describe("answerFromGraph", () => {
  it("grounds the answer on the retrieved subgraph", async () => {
    const g = new KnowledgeGraph();
    g.upsertRelation({ type: "service", name: "Billing" }, "depends_on", { type: "service", name: "Auth" });

    const llm = new MockLLM([{ text: "Billing depends on Auth." }]);
    const ans = await answerFromGraph({ question: "what does billing depend on?", graph: g, llm });

    expect(ans.grounded).toBe(true);
    expect(ans.text).toBe("Billing depends on Auth.");
    expect(ans.citations).toContain("service:billing");
  });

  it("reports when nothing relevant is known", async () => {
    const g = new KnowledgeGraph();
    const llm = new MockLLM([]);
    const ans = await answerFromGraph({ question: "anything about kubernetes?", graph: g, llm });
    expect(ans.grounded).toBe(false);
  });
});
