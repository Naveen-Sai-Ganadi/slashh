import {
  aclVisibleTo,
  edgeIsCurrent,
  type Document,
  type Edge,
  type Entity,
  type KnowledgeLayer,
} from "../knowledge/index.js";
import type { TimelineItem, SurfaceContext } from "./types.js";

/** Thrown when a requested entity/decision does not exist; server maps to 404. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export function snippet(text: string, n = 200): string {
  const t = text.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Can the asking user see this document? Fail closed. */
export function canSee(ctx: SurfaceContext, doc: Document): boolean {
  return aclVisibleTo(doc.acl, ctx.user, ctx.groups ?? []);
}

export function toTimelineItem(doc: Document): TimelineItem {
  return {
    documentId: doc.id,
    title: doc.title,
    source: doc.source,
    eventTime: doc.eventTime,
    url: doc.url,
    snippet: snippet(doc.text),
  };
}

/**
 * Resolve the provenance of a set of edges into permission-trimmed, deduped,
 * newest-first timeline items. This is the single choke point that guarantees no
 * surface ever leaks a source the asking user cannot see.
 */
export async function permittedTimeline(
  layer: KnowledgeLayer,
  ctx: SurfaceContext,
  edges: Edge[]
): Promise<TimelineItem[]> {
  const ids = new Set<string>();
  for (const e of edges) for (const p of e.provenance) ids.add(p);
  const items: TimelineItem[] = [];
  for (const id of ids) {
    const doc = await layer.getDocument(id);
    if (doc && canSee(ctx, doc)) items.push(toTimelineItem(doc));
  }
  items.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
  return items;
}

/** Human label for an edge: "owns Billing" or "status: customer". */
export function factLabel(edge: Edge, layer: KnowledgeLayer): string {
  if (edge.objectId) {
    const obj = layer.getEntity(edge.objectId);
    return `${edge.relation} ${obj?.name ?? edge.objectId}`;
  }
  return `${edge.relation}: ${edge.fact}`;
}

export function isCurrentAt(edge: Edge, asOf?: Date): boolean {
  return edgeIsCurrent(edge, asOf ?? new Date());
}

export type { Entity };
