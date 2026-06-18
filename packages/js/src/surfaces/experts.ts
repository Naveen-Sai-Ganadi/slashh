import type { KnowledgeLayer, Edge } from "../knowledge/index.js";
import type { Expert, SurfaceContext } from "./types.js";
import { permittedTimeline } from "./common.js";

/**
 * Surface 3 — Who Knows About X. Ranks people by how much permitted, recent
 * activity they have around a topic's neighbourhood. Aggregates are computed
 * from the permitted set only; an unknown topic returns an empty list, not an
 * error.
 */
export async function findExperts(
  layer: KnowledgeLayer,
  topic: string,
  ctx: SurfaceContext,
  k = 5
): Promise<Expert[]> {
  const topicEntity =
    layer.findEntities(topic, "topic")[0] ?? layer.findEntities(topic, "project")[0];
  if (!topicEntity) return [];

  const touching = layer.edgesTouching(topicEntity.id);
  const byPerson = new Map<string, Edge[]>();
  for (const e of touching) {
    if (e.relation === "DISCUSSES" && e.objectId === topicEntity.id) {
      (byPerson.get(e.subjectId) ?? byPerson.set(e.subjectId, []).get(e.subjectId)!).push(e);
    }
  }

  const now = Date.now();
  const experts: Expert[] = [];
  for (const [personId, edges] of byPerson) {
    const person = layer.getEntity(personId);
    if (!person) continue;
    const evidence = await permittedTimeline(layer, ctx, edges);
    if (evidence.length === 0) continue; // fail closed: no permitted evidence → not surfaced

    // Recency-weighted score: each permitted source counts, recent ones count more.
    let score = 0;
    for (const item of evidence) {
      const ageDays = (now - item.eventTime.getTime()) / (24 * 60 * 60 * 1000);
      score += 1 + Math.max(0, 1 - ageDays / 365);
    }
    experts.push({
      entity: person,
      score,
      evidence: evidence.slice(0, 5),
      reason: `authored ${evidence.length} permitted source${evidence.length === 1 ? "" : "s"} about ${topicEntity.name}`,
    });
  }

  return experts.sort((a, b) => b.score - a.score).slice(0, k);
}
