import type { KnowledgeLayer } from "../knowledge/index.js";
import type { EntityCard, SurfaceContext } from "./types.js";
import { NotFoundError, permittedTimeline, factLabel } from "./common.js";

/**
 * Surface 8 — Smart Hover Card. A cheap subset of the profile, fast enough to
 * call on hover: a headline, up to four current facts, and ≤3 permitted sources.
 * No LLM on this hot path.
 */
export async function buildCard(
  layer: KnowledgeLayer,
  entityId: string,
  ctx: SurfaceContext
): Promise<EntityCard> {
  const entity = layer.getEntity(entityId);
  if (!entity) throw new NotFoundError(`entity ${entityId}`);

  const at = ctx.asOf;
  const current = layer.neighbors(entityId, { at });
  const top = current[0];
  const headline = top
    ? `${entity.name} · ${entity.type} — ${factLabel(top, layer)}`
    : `${entity.name} · ${entity.type}`;
  const currentFacts = current.slice(0, 4).map((e) => factLabel(e, layer));
  const timeline = await permittedTimeline(layer, ctx, current);

  return { entity, headline, currentFacts, topSources: timeline.slice(0, 3), asOf: at };
}
