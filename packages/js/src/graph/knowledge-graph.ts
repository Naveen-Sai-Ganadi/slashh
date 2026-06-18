import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface EntityRef {
  type: string;
  name: string;
}

export interface GraphNode extends EntityRef {
  id: string;
  props: Record<string, unknown>;
  /** Provenance: which sources contributed to this node. */
  sources: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  props: Record<string, unknown>;
  sources: string[];
}

export interface GraphSubset {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SerializedGraph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9:_-]/g, "");
}

export function entityId(ref: EntityRef): string {
  return `${slug(ref.type)}:${slug(ref.name)}`;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * An entity-relation knowledge graph that merges repeated ingestion of the
 * same entities (by type+name), tracks provenance, and supports keyword
 * retrieval plus neighbourhood expansion for question answering. Serializable
 * to disk so the brain's knowledge persists and grows across runs.
 */
export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  /** Insert or merge an entity; returns its stable id. */
  upsertEntity(ref: EntityRef, props: Record<string, unknown> = {}, source?: string): string {
    const id = entityId(ref);
    const existing = this.nodes.get(id);
    if (existing) {
      Object.assign(existing.props, props);
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
      return id;
    }
    this.nodes.set(id, {
      id,
      type: ref.type,
      name: ref.name,
      props: { ...props },
      sources: source ? [source] : [],
    });
    return id;
  }

  /** Insert or merge a typed relation between two entities (auto-creating endpoints). */
  upsertRelation(
    from: EntityRef,
    type: string,
    to: EntityRef,
    props: Record<string, unknown> = {},
    source?: string
  ): string {
    const fromId = this.upsertEntity(from, {}, source);
    const toId = this.upsertEntity(to, {}, source);
    const id = `${fromId}|${slug(type)}|${toId}`;
    const existing = this.edges.get(id);
    if (existing) {
      Object.assign(existing.props, props);
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
      return id;
    }
    this.edges.set(id, {
      id,
      from: fromId,
      to: toId,
      type,
      props: { ...props },
      sources: source ? [source] : [],
    });
    return id;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): GraphEdge[] {
    return [...this.edges.values()];
  }

  stats(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }

  /** Searchable text for a node: its name, type, and stringified prop values. */
  private nodeText(n: GraphNode): string {
    return [n.name, n.type, ...Object.values(n.props).map((v) => String(v))].join(" ");
  }

  /** Rank nodes by how many query tokens overlap their searchable text. */
  search(query: string, limit = 8): GraphNode[] {
    const qTokens = new Set(tokenize(query));
    if (qTokens.size === 0) return [];
    const scored: Array<{ node: GraphNode; score: number }> = [];
    for (const node of this.nodes.values()) {
      const nodeTokens = new Set(tokenize(this.nodeText(node)));
      let score = 0;
      for (const t of qTokens) if (nodeTokens.has(t)) score++;
      if (score > 0) scored.push({ node, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.node);
  }

  /** Edges directly touching a node id. */
  edgesOf(id: string): GraphEdge[] {
    return [...this.edges.values()].filter((e) => e.from === id || e.to === id);
  }

  /** Expand a set of seed nodes outward `depth` hops, returning the induced subgraph. */
  subgraph(seedIds: string[], depth = 1): GraphSubset {
    const nodeIds = new Set(seedIds.filter((id) => this.nodes.has(id)));
    const edgeIds = new Set<string>();
    let frontier = [...nodeIds];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of this.edgesOf(id)) {
          edgeIds.add(e.id);
          for (const other of [e.from, e.to]) {
            if (!nodeIds.has(other)) {
              nodeIds.add(other);
              next.push(other);
            }
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: [...nodeIds].map((id) => this.nodes.get(id)!).filter(Boolean),
      edges: [...edgeIds].map((id) => this.edges.get(id)!).filter(Boolean),
    };
  }

  /** Fold another graph's nodes and edges into this one. */
  merge(other: KnowledgeGraph): this {
    for (const n of other.allNodes()) this.upsertEntity(n, n.props, undefined), this.mergeSources(n);
    for (const e of other.allEdges()) {
      const from = other.getNode(e.from)!;
      const to = other.getNode(e.to)!;
      this.upsertRelation(from, e.type, to, e.props);
      const mine = this.edges.get(e.id);
      if (mine) for (const s of e.sources) if (!mine.sources.includes(s)) mine.sources.push(s);
    }
    return this;
  }

  private mergeSources(n: GraphNode): void {
    const mine = this.nodes.get(n.id);
    if (mine) for (const s of n.sources) if (!mine.sources.includes(s)) mine.sources.push(s);
  }

  toJSON(): SerializedGraph {
    return { version: 1, nodes: this.allNodes(), edges: this.allEdges() };
  }

  static fromJSON(data: SerializedGraph): KnowledgeGraph {
    const g = new KnowledgeGraph();
    for (const n of data.nodes ?? []) g.nodes.set(n.id, { ...n, props: { ...n.props }, sources: [...n.sources] });
    for (const e of data.edges ?? []) g.edges.set(e.id, { ...e, props: { ...e.props }, sources: [...e.sources] });
    return g;
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2));
  }

  static load(path: string): KnowledgeGraph {
    if (!existsSync(path)) return new KnowledgeGraph();
    return KnowledgeGraph.fromJSON(JSON.parse(readFileSync(path, "utf8")));
  }
}
