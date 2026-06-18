import { cosine } from "./embeddings.js";
import type { Document, Chunk, RetrievedItem } from "./model.js";

/**
 * Storage interfaces. The core ships in-memory implementations so everything is
 * testable offline; the server provides Postgres/Qdrant/Redis-backed adapters
 * that satisfy these same contracts.
 */

export interface DocStore {
  put(doc: Document): Promise<void>;
  get(id: string): Promise<Document | undefined>;
  all(): Promise<Document[]>;
}

export interface VectorStore {
  upsert(chunks: Chunk[]): Promise<void>;
  /** Nearest chunks to a query embedding, best-first. */
  search(embedding: number[], k: number): Promise<RetrievedItem[]>;
  all(): Promise<Chunk[]>;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryDocStore implements DocStore {
  private docs = new Map<string, Document>();
  async put(doc: Document): Promise<void> {
    this.docs.set(doc.id, doc);
  }
  async get(id: string): Promise<Document | undefined> {
    return this.docs.get(id);
  }
  async all(): Promise<Document[]> {
    return [...this.docs.values()];
  }
}

export class InMemoryVectorStore implements VectorStore {
  private chunks = new Map<string, Chunk>();
  async upsert(chunks: Chunk[]): Promise<void> {
    for (const c of chunks) this.chunks.set(c.id, c);
  }
  async search(embedding: number[], k: number): Promise<RetrievedItem[]> {
    return [...this.chunks.values()]
      .map((chunk) => ({ chunk, score: chunk.embedding ? cosine(embedding, chunk.embedding) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  async all(): Promise<Chunk[]> {
    return [...this.chunks.values()];
  }
}

export class InMemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expires: number }>();
  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires && hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 });
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
}
