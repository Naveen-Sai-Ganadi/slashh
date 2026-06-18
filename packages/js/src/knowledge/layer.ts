import { stableId, type Document, type Chunk, type Entity, type Edge } from "./model.js";
import { KnowledgeGraph, entityKey } from "./graph.js";
import {
  InMemoryDocStore,
  InMemoryVectorStore,
  InMemoryCache,
  type DocStore,
  type VectorStore,
  type Cache,
} from "./stores.js";
import { HashingEmbedder, type Embedder } from "./embeddings.js";
import { RuleBasedExtractor, type Extractor, type EntityRef } from "./extraction.js";

export interface IngestSummary {
  documentId: string;
  entities: number;
  edges: number;
  chunks: number;
}

export interface KnowledgeLayerOptions {
  graph?: KnowledgeGraph;
  docs?: DocStore;
  vectors?: VectorStore;
  cache?: Cache;
  embedder?: Embedder;
  extractor?: Extractor;
}

function chunkText(text: string): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.length ? paras : [text.trim()].filter(Boolean);
}

/**
 * The knowledge layer: ingestion writes documents, chunks/embeddings, and
 * bi-temporal entities/edges; the read facade is what every surface and the
 * agent build on. Storage is pluggable — in-memory here, real DBs in the server.
 */
export class KnowledgeLayer {
  readonly graph: KnowledgeGraph;
  readonly docs: DocStore;
  readonly vectors: VectorStore;
  readonly cache: Cache;
  readonly embedder: Embedder;
  private readonly extractor: Extractor;

  constructor(opts: KnowledgeLayerOptions = {}) {
    this.graph = opts.graph ?? new KnowledgeGraph();
    this.docs = opts.docs ?? new InMemoryDocStore();
    this.vectors = opts.vectors ?? new InMemoryVectorStore();
    this.cache = opts.cache ?? new InMemoryCache();
    this.embedder = opts.embedder ?? new HashingEmbedder();
    this.extractor = opts.extractor ?? new RuleBasedExtractor();
  }

  private refId(ref: EntityRef): string {
    return entityKey(ref.type, ref.name);
  }

  /** Ingest one document: persist it, index its chunks, and grow the graph. */
  async ingest(doc: Document): Promise<IngestSummary> {
    await this.docs.put(doc);

    const chunks: Chunk[] = chunkText(doc.text).map((text, i) => ({
      id: stableId(doc.id, "chunk", i),
      documentId: doc.id,
      text,
      acl: doc.acl,
      embedding: this.embedder.embed(text),
    }));
    await this.vectors.upsert(chunks);

    const { entities, edges } = this.extractor.extract(doc);
    for (const e of entities) {
      this.graph.addEntity({
        type: e.type,
        name: e.name,
        aliases: e.aliases,
        attributes: e.attributes,
        seenAt: doc.eventTime,
      });
    }
    for (const edge of edges) {
      // Ensure both endpoints exist even if the extractor didn't list them.
      this.graph.addEntity({ type: edge.subject.type, name: edge.subject.name, seenAt: doc.eventTime });
      if (edge.object) {
        this.graph.addEntity({ type: edge.object.type, name: edge.object.name, seenAt: doc.eventTime });
      }
      this.graph.addEdge({
        subjectId: this.refId(edge.subject),
        relation: edge.relation,
        fact: edge.fact,
        objectId: edge.object ? this.refId(edge.object) : undefined,
        provenance: [doc.id],
        validFrom: doc.eventTime,
        recordedAt: doc.ingestedAt,
        supersede: edge.supersede,
      });
    }

    // Derived aggregates (e.g. glossary) are now stale.
    await this.cache.clear();

    return { documentId: doc.id, entities: entities.length, edges: edges.length, chunks: chunks.length };
  }

  // ---- read facade (used by surfaces + agent) ----

  getEntity(id: string): Entity | undefined {
    return this.graph.getEntity(id);
  }
  findEntities(query: string, type?: string): Entity[] {
    return this.graph.findEntities(query, type);
  }
  neighbors(entityId: string, opts: { at?: Date; relation?: string } = {}): Edge[] {
    return this.graph.neighbors(entityId, opts);
  }
  edgesTouching(entityId: string): Edge[] {
    return this.graph.edgesTouching(entityId);
  }
  edgesForDocument(documentId: string): Edge[] {
    return this.graph.edgesForDocument(documentId);
  }
  getDocument(id: string): Promise<Document | undefined> {
    return this.docs.get(id);
  }
  allDocuments(): Promise<Document[]> {
    return this.docs.all();
  }
  allEntities(): Entity[] {
    return this.graph.allEntities();
  }
  stats() {
    return this.graph.stats();
  }
}
