import type { KnowledgeLayer, Edge } from "../knowledge/index.js";
import type { Contradiction, SurfaceContext } from "./types.js";
import { canSee, isCurrentAt } from "./common.js";

const STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

async function anyVisibleSource(
  layer: KnowledgeLayer,
  ctx: SurfaceContext,
  edge: Edge
): Promise<boolean> {
  for (const id of edge.provenance) {
    const doc = await layer.getDocument(id);
    if (doc && canSee(ctx, doc)) return true;
  }
  return false;
}

async function newestSourceTime(layer: KnowledgeLayer, edge: Edge): Promise<number> {
  let newest = 0;
  for (const id of edge.provenance) {
    const doc = await layer.getDocument(id);
    if (doc) newest = Math.max(newest, doc.eventTime.getTime());
  }
  return newest;
}

/**
 * Surface 4 — Contradiction Inbox. The headline "not a wiki" surface: it finds
 * genuinely co-valid disagreements (not normal supersession) and rot.
 *
 * - **conflicting**: ≥2 edges on the same (subject, relation) both current at
 *   `asOf` with different facts.
 * - **stale**: a current edge whose newest source is older than the threshold.
 *
 * Fail closed: a contradiction is suppressed entirely unless the user can see
 * every conflicting source.
 */
export async function findContradictions(
  layer: KnowledgeLayer,
  ctx: SurfaceContext
): Promise<Contradiction[]> {
  const at = ctx.asOf ?? new Date();
  const current = layer.allEdges().filter((e) => isCurrentAt(e, at));

  // Group by the full slot (subject, relation, object): two different facts on
  // the SAME slot is a real disagreement; different objects (e.g. discussing
  // several topics) are not.
  const groups = new Map<string, Edge[]>();
  for (const e of current) {
    const key = `${e.subjectId}|${e.relation}|${e.objectId ?? ""}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const out: Contradiction[] = [];

  for (const [key, edges] of groups) {
    const facts = new Set(edges.map((e) => e.fact));
    if (edges.length < 2 || facts.size < 2) continue;

    // Fail closed: every conflicting source must be visible.
    let allVisible = true;
    for (const e of edges) {
      if (!(await anyVisibleSource(layer, ctx, e))) {
        allVisible = false;
        break;
      }
    }
    if (!allVisible) continue;

    const [subjectId, relation] = key.split("|");
    const subject = layer.getEntity(subjectId);
    out.push({
      subjectId,
      relation,
      conflictingEdges: edges,
      kind: "conflicting",
      detectedAt: new Date(),
      note: `${subject?.name ?? subjectId} has ${facts.size} conflicting "${relation}" facts: ${[...facts].join(" vs ")}`,
    });
  }

  // Stale: current edges whose freshest source is older than the threshold.
  for (const e of current) {
    const newest = await newestSourceTime(layer, e);
    if (newest === 0 || at.getTime() - newest < STALE_AFTER_MS) continue;
    if (!(await anyVisibleSource(layer, ctx, e))) continue;
    const subject = layer.getEntity(e.subjectId);
    out.push({
      subjectId: e.subjectId,
      relation: e.relation,
      conflictingEdges: [e],
      kind: "stale",
      detectedAt: new Date(),
      note: `${subject?.name ?? e.subjectId} "${e.relation}: ${e.fact}" hasn't been confirmed since ${new Date(newest).toISOString().slice(0, 10)}`,
    });
  }

  return out;
}
