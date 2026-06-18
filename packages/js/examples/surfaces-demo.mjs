// Offline tour of the knowledge surfaces — no API key, no databases, no server.
// Run from the repo root after building core:
//   pnpm --filter @company-brain/core build && node package/packages/js/examples/surfaces-demo.mjs
import {
  KnowledgeLayer,
  KnowledgeGraph,
  entityKey,
  makeAcl,
  surfaces,
} from "@company-brain/core";
const { buildProfile, listDecisions, findContradictions, define } = surfaces;

const layer = new KnowledgeLayer();
const doc = (id, author, text, day, groups) => ({
  id,
  source: "slack",
  title: id,
  text,
  author,
  eventTime: new Date(`${day}T12:00:00Z`),
  ingestedAt: new Date(`${day}T12:00:00Z`),
  acl: groups ? makeAcl({ allowGroups: groups }) : makeAcl({ public: true }),
});

console.log("\n=== Ingesting a few documents ===");
await layer.ingest(doc("d1", "ada", "Acme is a prospect we met at the conference. #sales", "2026-01-05"));
await layer.ingest(doc("d2", "ada", "Acme is now a customer after signing. #sales", "2026-03-02"));
await layer.ingest(doc("d3", "ada", "We decided to deprecate the old billing flow. #billing", "2026-02-01"));
await layer.ingest(doc("d4", "carol", "Confidential leadership note. #billing", "2026-02-20", ["leadership"]));
console.log("stats:", layer.stats());

const bob = { user: "bob", groups: [] };
const acme = entityKey("org", "Acme");

console.log("\n=== Entity Profile — Acme (now) ===");
const now = await buildProfile(layer, acme, bob);
console.log("current:", now.relationsCurrent.map((e) => e.fact), "| past:", now.relationsPast.map((e) => e.fact));

console.log("\n=== Time Machine — Acme as of 2026-02-01 ===");
const past = await buildProfile(layer, acme, { ...bob, asOf: new Date("2026-02-01T00:00:00Z") });
console.log("current:", past.relationsCurrent.map((e) => e.fact));

console.log("\n=== Decision Log (as bob) ===");
for (const d of await listDecisions(layer, bob)) {
  console.log(`• ${d.statement} — by ${d.decidedBy.map((e) => e.name)} about ${d.about.map((e) => e.name)} [${d.provenance.length} source(s)]`);
}

console.log("\n=== Contradiction Inbox (constructed conflict) ===");
const g = new KnowledgeGraph();
await layer.docs.put(doc("c1", "ada", "Acme is a customer.", "2026-02-01"));
await layer.docs.put(doc("c2", "bob", "Acme is a partner.", "2026-02-01"));
const oid = layer.graph.addEntity({ type: "org", name: "Beta" }).id;
layer.graph.addEdge({ subjectId: oid, relation: "status", fact: "customer", provenance: ["c1"], validFrom: new Date("2026-02-01"), supersede: false });
layer.graph.addEdge({ subjectId: oid, relation: "status", fact: "partner", provenance: ["c2"], validFrom: new Date("2026-02-01"), supersede: false });
for (const c of await findContradictions(layer, bob)) console.log(`• [${c.kind}] ${c.note}`);

console.log("\n=== Jargon Decoder (permission-aware) ===");
await layer.ingest(doc("d5", "ada", "Our SSO rollout. SSO means single sign-on. #infra", "2026-02-25"));
console.log("SSO:", (await define(layer, "SSO", bob))?.definition);

console.log("\nDone. The confidential #billing note (d4) never leaked into bob's views.\n");
