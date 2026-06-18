import type { KnowledgeLayer, Entity } from "../knowledge/index.js";
import type { EntityProfile, SurfaceContext } from "./types.js";
import { NotFoundError, permittedTimeline, isCurrentAt } from "./common.js";

/**
 * Surface 1 — Entity Profile. A generated, connected, point-in-time "wiki page":
 * current relations, the history that changed, a permission-trimmed source
 * timeline, and the entities this one connects to — all as of `ctx.asOf`.
 */
export async function buildProfile(
  layer: KnowledgeLayer,
  entityId: string,
  ctx: SurfaceContext
): Promise<EntityProfile> {
  const entity = layer.getEntity(entityId);
  if (!entity) throw new NotFoundError(`entity ${entityId}`);

  const at = ctx.asOf;
  const relationsCurrent = layer.neighbors(entityId, { at });
  const outgoing = layer.edgesTouching(entityId).filter((e) => e.subjectId === entityId);
  const relationsPast = outgoing.filter((e) => !isCurrentAt(e, at));

  // The timeline draws on every edge touching the entity (both directions) so a
  // topic page shows who discusses it, not just its outgoing facts.
  const touching = layer.edgesTouching(entityId);
  const timeline = await permittedTimeline(layer, ctx, touching);

  // Related = the entity at the other end of each currently-valid touching edge.
  const relatedIds = new Set<string>();
  for (const e of touching) {
    if (!isCurrentAt(e, at)) continue;
    const other = e.subjectId === entityId ? e.objectId : e.subjectId;
    if (other && other !== entityId) relatedIds.add(other);
  }
  const relatedEntities = [...relatedIds]
    .map((id) => layer.getEntity(id))
    .filter((e): e is Entity => Boolean(e));

  return { entity, relationsCurrent, relationsPast, timeline, relatedEntities, asOf: at };
}
