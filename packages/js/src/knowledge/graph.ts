import {
  stableId,
  edgeIsCurrent,
  type Entity,
  type Edge,
} from "./model.js";

/** Canonical id for an entity — same type+name always collapses to one node. */
export function entityKey(type: string, name: string): string {
  return stableId(type.toLowerCase().trim(), name.toLowerCase().trim());
}

export interface AddEntityInput {
  type: string;
  name: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  seenAt?: Date;
}

export interface AddEdgeInput {
  subjectId: string;
  relation: string;
  fact: string;
  objectId?: string;
  provenance: string[];
  validFrom?: Date;
  recordedAt?: Date;
  /** When true (default), invalidate prior current edges on the same (subject, relation, object) slot. */
  supersede?: boolean;
}

/**
 * In-memory bi-temporal knowledge graph.
 *
 * Facts are invalidated, never deleted: superseding a fact sets the prior
 * edge's `validTo`, so the full history remains queryable for the Time Machine.
 */
export class KnowledgeGraph {
  private entities = new Map<string, Entity>();
  private edges: Edge[] = [];

  /** Merge an entity by identity (type+name): unions aliases/attributes, widens first/last seen. */
  addEntity(input: AddEntityInput): Entity {
    const id = entityKey(input.type, input.name);
    const at = input.seenAt ?? new Date();
    const existing = this.entities.get(id);
    if (existing) {
      for (const a of input.aliases ?? []) {
        if (!existing.aliases.includes(a)) existing.aliases.push(a);
      }
      Object.assign(existing.attributes, input.attributes ?? {});
      if (at < existing.firstSeen) existing.firstSeen = at;
      if (at > existing.lastSeen) existing.lastSeen = at;
      return existing;
    }
    const entity: Entity = {
      id,
      type: input.type,
      name: input.name,
      aliases: [...(input.aliases ?? [])],
      attributes: { ...(input.attributes ?? {}) },
      firstSeen: at,
      lastSeen: at,
    };
    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Substring match over name + aliases. */
  findEntities(query: string, type?: string): Entity[] {
    const q = query.toLowerCase().trim();
    return [...this.entities.values()].filter((e) => {
      if (type && e.type !== type) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }

  private slot(subjectId: string, relation: string, objectId?: string): string {
    return `${subjectId}|${relation}|${objectId ?? ""}`;
  }

  /**
   * Add a fact. With `supersede` (default true), prior edges current at the new
   * fact's `validFrom` on the same (subject, relation, object) slot are closed
   * out (`validTo = validFrom`). An identical existing edge just gains provenance.
   */
  addEdge(input: AddEdgeInput): Edge {
    const validFrom = input.validFrom ?? new Date();
    const recordedAt = input.recordedAt ?? new Date();
    const supersede = input.supersede ?? true;
    const slot = this.slot(input.subjectId, input.relation, input.objectId);

    // Same fact already recorded → merge provenance, don't duplicate.
    const dup = this.edges.find(
      (e) =>
        this.slot(e.subjectId, e.relation, e.objectId) === slot &&
        e.fact === input.fact &&
        e.expiredAt === null
    );
    if (dup) {
      for (const p of input.provenance) if (!dup.provenance.includes(p)) dup.provenance.push(p);
      return dup;
    }

    if (supersede) {
      for (const e of this.edges) {
        if (
          this.slot(e.subjectId, e.relation, e.objectId) === slot &&
          e.fact !== input.fact &&
          edgeIsCurrent(e, validFrom)
        ) {
          e.validTo = validFrom;
        }
      }
    }

    const edge: Edge = {
      id: stableId(slot, input.fact, validFrom.toISOString()),
      subjectId: input.subjectId,
      relation: input.relation,
      fact: input.fact,
      objectId: input.objectId,
      provenance: [...input.provenance],
      validFrom,
      validTo: null,
      recordedAt,
      expiredAt: null,
    };
    this.edges.push(edge);
    return edge;
  }

  /** Outgoing edges from an entity that are current at `at` (default now). */
  neighbors(entityId: string, opts: { at?: Date; relation?: string } = {}): Edge[] {
    const at = opts.at ?? new Date();
    return this.edges.filter(
      (e) =>
        e.subjectId === entityId &&
        (!opts.relation || e.relation === opts.relation) &&
        edgeIsCurrent(e, at)
    );
  }

  /** Every edge touching an entity (either end), regardless of time. */
  edgesTouching(entityId: string): Edge[] {
    return this.edges.filter((e) => e.subjectId === entityId || e.objectId === entityId);
  }

  /** Edges whose provenance includes a given document. */
  edgesForDocument(documentId: string): Edge[] {
    return this.edges.filter((e) => e.provenance.includes(documentId));
  }

  allEntities(): Entity[] {
    return [...this.entities.values()];
  }

  allEdges(): Edge[] {
    return [...this.edges];
  }

  stats(): { entities: number; edges: number; currentEdges: number } {
    const now = new Date();
    return {
      entities: this.entities.size,
      edges: this.edges.length,
      currentEdges: this.edges.filter((e) => edgeIsCurrent(e, now)).length,
    };
  }
}
