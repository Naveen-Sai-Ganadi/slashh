import { describe, it, expect } from "vitest";
import {
  KnowledgeLayer,
  entityKey,
  makeAcl,
  type Document,
} from "../src/knowledge/index.js";
import {
  buildProfile,
  buildCard,
  listDecisions,
  findContradictions,
  findExperts,
  buildGlossary,
  define,
  buildPacket,
} from "../src/surfaces/index.js";

let seq = 0;
function doc(over: Partial<Document> & { text: string }): Document {
  seq += 1;
  const t = over.eventTime ?? new Date("2026-02-01T00:00:00Z");
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

/** A small mock-Slack dataset shared across the surface tests. */
async function seeded(): Promise<KnowledgeLayer> {
  const layer = new KnowledgeLayer();
  await layer.ingest(doc({ id: "d1", author: "ada", text: "Acme is a prospect. #sales", eventTime: new Date("2026-01-01T00:00:00Z") }));
  await layer.ingest(doc({ id: "d2", author: "ada", text: "Acme is now a customer after the deal. #sales", eventTime: new Date("2026-03-01T00:00:00Z") }));
  await layer.ingest(doc({ id: "d3", author: "ada", text: "We decided to deprecate the old billing flow. #billing", eventTime: new Date("2026-02-01T00:00:00Z") }));
  await layer.ingest(doc({ id: "d4", author: "bob", text: "Looking at #billing reliability this week.", eventTime: new Date("2026-02-15T00:00:00Z") }));
  await layer.ingest(doc({ id: "d5", author: "carol", text: "Confidential leadership plan. #billing", acl: makeAcl({ allowGroups: ["leadership"] }), eventTime: new Date("2026-02-20T00:00:00Z") }));
  await layer.ingest(doc({ id: "d6", author: "ada", text: "Our SSO rollout. SSO means single sign-on. #infra", eventTime: new Date("2026-02-25T00:00:00Z") }));
  return layer;
}

const bob = { user: "bob", groups: [] as string[] };
const leader = { user: "carol", groups: ["leadership"] };

describe("Entity Profiles + Time Machine", () => {
  it("shows status as of a past date, and the superseded relation in history", async () => {
    const layer = await seeded();
    const acme = entityKey("org", "Acme");

    const past = await buildProfile(layer, acme, { ...bob, asOf: new Date("2026-02-01T00:00:00Z") });
    expect(past.relationsCurrent.map((e) => e.fact)).toContain("prospect");

    const now = await buildProfile(layer, acme, bob);
    expect(now.relationsCurrent.map((e) => e.fact)).toContain("customer");
    // The prospect fact is now history, not current.
    expect(now.relationsPast.map((e) => e.fact)).toContain("prospect");
  });

  it("permission-trims the timeline", async () => {
    const layer = await seeded();
    const billing = entityKey("topic", "billing");
    const asBob = await buildProfile(layer, billing, bob);
    const asLeader = await buildProfile(layer, billing, leader);
    expect(asBob.timeline.some((t) => t.documentId === "d5")).toBe(false);
    expect(asLeader.timeline.some((t) => t.documentId === "d5")).toBe(true);
  });
});

describe("Smart Hover Card", () => {
  it("summarises an entity with permitted sources", async () => {
    const layer = await seeded();
    const card = await buildCard(layer, entityKey("person", "ada"), bob);
    expect(card.headline).toContain("ada");
    expect(card.topSources.every((s) => s.documentId !== "d5")).toBe(true);
  });
});

describe("Decision Log", () => {
  it("returns a cited decision with decided_by and about", async () => {
    const layer = await seeded();
    const decisions = await listDecisions(layer, bob);
    const dep = decisions.find((d) => d.statement.toLowerCase().includes("deprecate"));
    expect(dep).toBeTruthy();
    expect(dep!.decidedBy.map((e) => e.name)).toContain("ada");
    expect(dep!.about.map((e) => e.name)).toContain("billing");
    expect(dep!.provenance.length).toBeGreaterThanOrEqual(1);
  });

  it("sets superseded_by when a later decision touches the same topic", async () => {
    const layer = await seeded();
    await layer.ingest(doc({ id: "d7", author: "ada", text: "We decided to rebuild billing from scratch. #billing", eventTime: new Date("2026-04-01T00:00:00Z") }));
    const decisions = await listDecisions(layer, bob);
    const dep = decisions.find((d) => d.statement.toLowerCase().includes("deprecate"))!;
    expect(dep.supersededBy).toBeTruthy();
  });
});

describe("Who Knows About X", () => {
  it("ranks the most active permitted author first; unknown topic → empty", async () => {
    const layer = await seeded();
    await layer.ingest(doc({ id: "d8", author: "ada", text: "More #billing migration notes.", eventTime: new Date("2026-03-10T00:00:00Z") }));
    const experts = await findExperts(layer, "billing", bob);
    expect(experts[0].entity.name).toBe("ada");
    expect(await findExperts(layer, "nonexistent-topic", bob)).toEqual([]);
  });
});

describe("Jargon Decoder", () => {
  it("decodes an acronym with a definition and permitted example", async () => {
    const layer = await seeded();
    const sso = await define(layer, "SSO", bob);
    expect(sso).toBeTruthy();
    expect(sso!.examples.length).toBeGreaterThanOrEqual(1);
    const glossary = await buildGlossary(layer, bob);
    expect(glossary.some((t) => t.term === "SSO")).toBe(true);
  });
});

describe("Meeting Prep", () => {
  it("builds a packet with recent activity and open decisions", async () => {
    const layer = await seeded();
    const packet = await buildPacket(layer, bob, ["ada"], ["billing"]);
    expect(packet.attendees.map((a) => a.name)).toContain("ada");
    expect(packet.recentActivity.length).toBeGreaterThan(0);
    expect(packet.openDecisions.length).toBeGreaterThanOrEqual(1);
    expect(packet.recentActivity.every((s) => s.documentId !== "d5")).toBe(true);
  });
});

describe("Contradiction Inbox", () => {
  async function withConflict(provenanceAcl = makeAcl({ public: true })) {
    const layer = new KnowledgeLayer();
    // Two co-valid, conflicting status facts (supersede:false) — a genuine disagreement.
    await layer.docs.put(doc({ id: "c1", author: "ada", text: "Acme is a customer.", acl: makeAcl({ public: true }) }));
    await layer.docs.put(doc({ id: "c2", author: "bob", text: "Acme is a partner.", acl: provenanceAcl }));
    const acme = layer.graph.addEntity({ type: "org", name: "Acme" }).id;
    const t = new Date("2026-02-01T00:00:00Z");
    layer.graph.addEdge({ subjectId: acme, relation: "status", fact: "customer", provenance: ["c1"], validFrom: t, supersede: false });
    layer.graph.addEdge({ subjectId: acme, relation: "status", fact: "partner", provenance: ["c2"], validFrom: t, supersede: false });
    return layer;
  }

  it("flags exactly one conflicting contradiction with both sources", async () => {
    const layer = await withConflict();
    const found = await findContradictions(layer, bob);
    const conflicts = found.filter((c) => c.kind === "conflicting");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictingEdges).toHaveLength(2);
  });

  it("does not flag normal supersession", async () => {
    const layer = await seeded();
    const found = await findContradictions(layer, leader);
    expect(found.filter((c) => c.kind === "conflicting")).toHaveLength(0);
  });

  it("suppresses a contradiction when a conflicting source is hidden (fail closed)", async () => {
    const layer = await withConflict(makeAcl({ allowGroups: ["leadership"] }));
    const found = await findContradictions(layer, bob);
    expect(found.filter((c) => c.kind === "conflicting")).toHaveLength(0);
  });
});
