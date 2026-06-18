import type { Entity, Edge } from "../knowledge/model.js";

/**
 * Data shapes for the eight knowledge surfaces. These mirror the server DTOs and
 * the Next.js client types. All datetimes are UTC-aware `Date` in memory and
 * ISO-8601 strings on the wire.
 */

/** A dated, cited reference to a source document. */
export interface TimelineItem {
  documentId: string;
  title: string;
  source: string;
  eventTime: Date;
  url?: string;
  /** ≤200-char extractive snippet. */
  snippet: string;
}

/** Surface 1 — Entity Profiles: a generated, connected, point-in-time "wiki page". */
export interface EntityProfile {
  entity: Entity;
  relationsCurrent: Edge[];
  relationsPast: Edge[];
  timeline: TimelineItem[];
  relatedEntities: Entity[];
  asOf?: Date;
}

/** Surface 2 — Jargon Decoder. */
export interface GlossaryTerm {
  term: string;
  expansion?: string;
  kind: "acronym" | "codename" | "jargon";
  definition: string;
  examples: TimelineItem[];
  confidence: number;
}

/** Surface 3 — Who Knows About X. */
export interface Expert {
  entity: Entity;
  score: number;
  evidence: TimelineItem[];
  reason: string;
}

/** Surface 4 — Contradiction Inbox. */
export interface Contradiction {
  subjectId: string;
  relation: string;
  conflictingEdges: Edge[];
  kind: "conflicting" | "stale";
  detectedAt: Date;
  note: string;
}

/** Surface 6 — Decision Log. */
export interface DecisionRecord {
  decision: Entity;
  statement: string;
  decidedBy: Entity[];
  about: Entity[];
  provenance: TimelineItem[];
  decidedAt: Date;
  supersededBy?: string;
}

/** Surface 7 — Meeting Prep Packets. */
export interface MeetingPacket {
  title: string;
  when?: Date;
  attendees: Entity[];
  topics: Entity[];
  recentActivity: TimelineItem[];
  openDecisions: DecisionRecord[];
  briefing: string;
}

/** Surface 8 — Smart Hover Cards. */
export interface EntityCard {
  entity: Entity;
  headline: string;
  currentFacts: string[];
  topSources: TimelineItem[];
  asOf?: Date;
}

/** Common read options threaded through every surface: who is asking and as-of when. */
export interface SurfaceContext {
  user: string;
  groups?: string[];
  asOf?: Date;
}
