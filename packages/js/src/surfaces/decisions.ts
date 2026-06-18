import type { KnowledgeLayer, Entity } from "../knowledge/index.js";
import type { DecisionRecord, TimelineItem, SurfaceContext } from "./types.js";
import { NotFoundError, permittedTimeline } from "./common.js";

function decidedAtOf(entity: Entity, provenance: TimelineItem[]): Date {
  const attr = entity.attributes.decidedAt;
  if (typeof attr === "string") return new Date(attr);
  // earliest source, else when first seen
  const earliest = provenance.reduce<Date | undefined>(
    (min, p) => (!min || p.eventTime < min ? p.eventTime : min),
    undefined
  );
  return earliest ?? entity.firstSeen;
}

async function buildRecord(
  layer: KnowledgeLayer,
  ctx: SurfaceContext,
  decision: Entity,
  allDecisions: Entity[]
): Promise<DecisionRecord | null> {
  const touching = layer.edgesTouching(decision.id);
  const decidedByIds = touching
    .filter((e) => e.relation === "DECIDED" && e.objectId === decision.id)
    .map((e) => e.subjectId);
  const aboutIds = touching
    .filter((e) => e.relation === "ABOUT" && e.subjectId === decision.id)
    .map((e) => e.objectId!)
    .filter(Boolean);

  const provenance = (await permittedTimeline(layer, ctx, touching)).sort(
    (a, b) => a.eventTime.getTime() - b.eventTime.getTime()
  );
  // Fail closed: if the user can't see any source behind the decision, hide it.
  if (provenance.length === 0) return null;

  const decidedBy = decidedByIds
    .map((id) => layer.getEntity(id))
    .filter((e): e is Entity => Boolean(e));
  const about = aboutIds
    .map((id) => layer.getEntity(id))
    .filter((e): e is Entity => Boolean(e));
  const statement =
    typeof decision.attributes.statement === "string" ? decision.attributes.statement : decision.name;
  const decidedAt = decidedAtOf(decision, provenance);

  // Superseded if a later decision shares an about-topic.
  const aboutSet = new Set(aboutIds);
  let supersededBy: string | undefined;
  for (const other of allDecisions) {
    if (other.id === decision.id) continue;
    const otherAbout = layer
      .edgesTouching(other.id)
      .filter((e) => e.relation === "ABOUT" && e.subjectId === other.id)
      .map((e) => e.objectId!);
    if (!otherAbout.some((t) => aboutSet.has(t))) continue;
    const otherAt =
      typeof other.attributes.decidedAt === "string"
        ? new Date(other.attributes.decidedAt)
        : other.firstSeen;
    if (otherAt > decidedAt) supersededBy = other.id;
  }

  return { decision, statement, decidedBy, about, provenance, decidedAt, supersededBy };
}

/** Surface 6 — Decision Log. Decisions with their cited causal chain (oldest→newest). */
export async function listDecisions(
  layer: KnowledgeLayer,
  ctx: SurfaceContext,
  about?: string
): Promise<DecisionRecord[]> {
  const all = layer.findEntities("", "decision");
  const records: DecisionRecord[] = [];
  for (const d of all) {
    const rec = await buildRecord(layer, ctx, d, all);
    if (!rec) continue;
    if (ctx.asOf && rec.decidedAt > ctx.asOf) continue;
    if (about && !rec.about.some((t) => t.name.toLowerCase() === about.toLowerCase())) continue;
    records.push(rec);
  }
  return records.sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
}

export async function getDecision(
  layer: KnowledgeLayer,
  decisionId: string,
  ctx: SurfaceContext
): Promise<DecisionRecord> {
  const entity = layer.getEntity(decisionId);
  if (!entity || entity.type !== "decision") throw new NotFoundError(`decision ${decisionId}`);
  const rec = await buildRecord(layer, ctx, entity, layer.findEntities("", "decision"));
  if (!rec) throw new NotFoundError(`decision ${decisionId}`);
  return rec;
}
