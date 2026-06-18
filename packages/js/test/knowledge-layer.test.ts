import { describe, it, expect } from "vitest";
import {
  KnowledgeLayer,
  KnowledgeGraph,
  BrainAgent,
  HybridRetriever,
  entityKey,
  makeAcl,
  edgeIsCurrent,
  type Document,
} from "../src/knowledge/index.js";

let seq = 0;
function doc(over: Partial<Document> & { text: string }): Document {
  seq += 1;
  const t = over.eventTime ?? new Date("2026-01-01T00:00:00Z");
  return {
    id: over.id ?? `doc${seq}`,
    source: over.source ?? "slack",
    title: over.title ?? `doc ${seq}`,
    text: over.text,
    url: over.url,
    author: over.author,
    eventTime: t,
    ingestedAt: over.ingestedAt ?? t,
    acl: over.acl ?? makeAcl({ public: true }),
  };
}

describe("KnowledgeGraph — bi-temporal supersession", () => {
  it("supersedes a status fact and keeps history (Time Machine)", () => {
    const g = new KnowledgeGraph();
    const acme = g.addEntity({ type: "org", name: "Acme" }).id;
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-03-01T00:00:00Z");
    g.addEdge({ subjectId: acme, relation: "status", fact: "prospect", provenance: ["d1"], validFrom: t1 });
    g.addEdge({ subjectId: acme, relation: "status", fact: "customer", provenance: ["d2"], validFrom: t2 });

    const before = g.neighbors(acme, { at: new Date("2026-02-01T00:00:00Z") });
    const after = g.neighbors(acme, { at: new Date("2026-04-01T00:00:00Z") });
    expect(before.map((e) => e.fact)).toEqual(["prospect"]);
    expect(after.map((e) => e.fact)).toEqual(["customer"]);
    // Nothing deleted: the prospect edge still exists, just closed out.
    expect(g.allEdges()).toHaveLength(2);
    const prospect = g.allEdges().find((e) => e.fact === "prospect")!;
    expect(prospect.validTo).toEqual(t2);
    expect(edgeIsCurrent(prospect, new Date("2026-04-01T00:00:00Z"))).toBe(false);
  });

  it("merges entities by identity and unions aliases", () => {
    const g = new KnowledgeGraph();
    const a = g.addEntity({ type: "person", name: "Ada", aliases: ["@ada"] });
    const b = g.addEntity({ type: "person", name: "Ada", aliases: ["ada.l"] });
    expect(a.id).toBe(b.id);
    expect(g.getEntity(a.id)!.aliases.sort()).toEqual(["@ada", "ada.l"]);
  });
});

describe("KnowledgeLayer — ingestion", () => {
  it("extracts people, topics and edges from a document", async () => {
    const layer = new KnowledgeLayer();
    const summary = await layer.ingest(
      doc({ text: "Shipped the new #billing flow. Big week.", author: "ada" })
    );
    expect(summary.entities).toBeGreaterThan(0);
    const ada = layer.getEntity(entityKey("person", "ada"));
    const billing = layer.getEntity(entityKey("topic", "billing"));
    expect(ada).toBeTruthy();
    expect(billing).toBeTruthy();
    const discusses = layer.neighbors(ada!.id, { relation: "DISCUSSES" });
    expect(discusses.map((e) => e.objectId)).toContain(billing!.id);
  });
});

describe("HybridRetriever — permission trim (fail closed)", () => {
  async function seeded() {
    const layer = new KnowledgeLayer();
    await layer.ingest(doc({ text: "Billing runs on postgres. #billing", acl: makeAcl({ public: true }) }));
    await layer.ingest(
      doc({ text: "Confidential billing roadmap. #billing", acl: makeAcl({ allowGroups: ["leadership"] }) })
    );
    return new HybridRetriever(layer);
  }

  it("hides chunks the user cannot see", async () => {
    const r = await seeded();
    const outsider = await r.retrieve("billing", { user: "bob", groups: [] }, 10);
    expect(outsider.every((i) => !i.chunk.text.includes("Confidential"))).toBe(true);
  });

  it("shows confidential chunks to permitted groups", async () => {
    const r = await seeded();
    const leader = await r.retrieve("billing", { user: "carol", groups: ["leadership"] }, 10);
    expect(leader.some((i) => i.chunk.text.includes("Confidential"))).toBe(true);
  });
});

describe("BrainAgent — grounded answers", () => {
  it("answers with citations from permitted sources", async () => {
    const layer = new KnowledgeLayer();
    await layer.ingest(doc({ id: "wiki1", title: "Billing", text: "Billing depends on Auth. #billing" }));
    const agent = new BrainAgent(layer);
    const ans = await agent.ask("what does billing depend on?", { user: "bob" });
    expect(ans.grounded).toBe(true);
    expect(ans.citations.map((c) => c.documentId)).toContain("wiki1");
  });

  it("declines when nothing visible matches (fail closed)", async () => {
    const layer = new KnowledgeLayer();
    await layer.ingest(
      doc({ text: "Secret plans. #secret", acl: makeAcl({ allowGroups: ["leadership"] }) })
    );
    const agent = new BrainAgent(layer);
    const ans = await agent.ask("what are the plans?", { user: "bob", groups: [] });
    expect(ans.grounded).toBe(false);
    expect(ans.citations).toHaveLength(0);
  });
});
