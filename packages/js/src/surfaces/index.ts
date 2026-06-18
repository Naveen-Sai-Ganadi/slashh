/**
 * The eight knowledge surfaces — pure functions over the KnowledgeLayer.
 *
 * Phase 0 ships the signatures and types as stubs so the server/CLI/client can
 * wire against them (returning 501 until implemented). Each surface is filled in
 * during its phase:
 *   Phase 3 — profiles, cards, decisions, contradictions
 *   Phase 4 — experts, glossary, meeting prep
 */
import type {
  EntityProfile,
  EntityCard,
  GlossaryTerm,
  Expert,
  Contradiction,
  DecisionRecord,
  MeetingPacket,
  SurfaceContext,
} from "./types.js";

export * from "./types.js";

/** Marker error thrown by not-yet-implemented surfaces; the server maps it to HTTP 501. */
export class NotImplementedError extends Error {
  constructor(surface: string, phase: number) {
    super(`surface "${surface}" is not implemented yet (lands in phase ${phase})`);
    this.name = "NotImplementedError";
  }
}

// Phase 3 — these accept a KnowledgeLayer once it exists (Phase 1). Typed `unknown`
// for now to keep Phase 0 free of the not-yet-built layer.
export async function buildProfile(
  _layer: unknown,
  _entityId: string,
  _ctx: SurfaceContext
): Promise<EntityProfile> {
  throw new NotImplementedError("profiles", 3);
}

export async function buildCard(
  _layer: unknown,
  _entityId: string,
  _ctx: SurfaceContext
): Promise<EntityCard> {
  throw new NotImplementedError("cards", 3);
}

export async function listDecisions(
  _layer: unknown,
  _ctx: SurfaceContext,
  _about?: string
): Promise<DecisionRecord[]> {
  throw new NotImplementedError("decisions", 3);
}

export async function getDecision(
  _layer: unknown,
  _decisionId: string,
  _ctx: SurfaceContext
): Promise<DecisionRecord> {
  throw new NotImplementedError("decisions", 3);
}

export async function findContradictions(
  _layer: unknown,
  _ctx: SurfaceContext
): Promise<Contradiction[]> {
  throw new NotImplementedError("contradictions", 3);
}

// Phase 4
export async function findExperts(
  _layer: unknown,
  _topic: string,
  _ctx: SurfaceContext,
  _k = 5
): Promise<Expert[]> {
  throw new NotImplementedError("experts", 4);
}

export async function buildGlossary(
  _layer: unknown,
  _ctx: SurfaceContext
): Promise<GlossaryTerm[]> {
  throw new NotImplementedError("glossary", 4);
}

export async function define(
  _layer: unknown,
  _term: string,
  _ctx: SurfaceContext
): Promise<GlossaryTerm | null> {
  throw new NotImplementedError("glossary", 4);
}

export async function buildPacket(
  _layer: unknown,
  _ctx: SurfaceContext,
  _attendees: string[],
  _topics?: string[],
  _when?: Date
): Promise<MeetingPacket> {
  throw new NotImplementedError("meeting-prep", 4);
}
