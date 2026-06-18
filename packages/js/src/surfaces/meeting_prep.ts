import type { KnowledgeLayer, Edge, Entity } from "../knowledge/index.js";
import type { MeetingPacket, SurfaceContext } from "./types.js";
import { permittedTimeline } from "./common.js";
import { listDecisions } from "./decisions.js";

/**
 * Surface 7 — Meeting Prep Packet. For the given attendees and topics, a
 * compact, permission-trimmed briefing: recent activity and open (not yet
 * superseded) decisions touching the topics.
 */
export async function buildPacket(
  layer: KnowledgeLayer,
  ctx: SurfaceContext,
  attendees: string[],
  topics?: string[],
  when?: Date
): Promise<MeetingPacket> {
  const attendeeEntities = attendees
    .map((name) => layer.findEntities(name, "person")[0])
    .filter((e): e is Entity => Boolean(e));
  const topicEntities = (topics ?? [])
    .map((name) => layer.findEntities(name, "topic")[0])
    .filter((e): e is Entity => Boolean(e));

  const edges: Edge[] = [];
  for (const e of [...attendeeEntities, ...topicEntities]) {
    edges.push(...layer.edgesTouching(e.id));
  }
  const recentActivity = (await permittedTimeline(layer, ctx, edges)).slice(0, 10);

  const topicNames = new Set(topicEntities.map((t) => t.name.toLowerCase()));
  const allDecisions = await listDecisions(layer, ctx);
  const openDecisions = allDecisions.filter(
    (d) =>
      !d.supersededBy &&
      (topicNames.size === 0 || d.about.some((t) => topicNames.has(t.name.toLowerCase())))
  );

  const attendeeNames = attendeeEntities.map((a) => a.name).join(", ") || "—";
  const topicLabel = topicEntities.map((t) => t.name).join(", ") || "general";
  const briefing =
    `Meeting on ${topicLabel} with ${attendeeNames}. ` +
    `${recentActivity.length} recent update(s), ${openDecisions.length} open decision(s).`;

  return {
    title: `Meeting prep — ${topicLabel}`,
    when,
    attendees: attendeeEntities,
    topics: topicEntities,
    recentActivity,
    openDecisions,
    briefing,
  };
}
