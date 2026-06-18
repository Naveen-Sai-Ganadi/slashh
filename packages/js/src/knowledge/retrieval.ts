import { aclVisibleTo, type RetrievedItem } from "./model.js";
import type { KnowledgeLayer } from "./layer.js";

export interface RetrieveContext {
  user: string;
  groups?: string[];
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * Hybrid retrieval: vector similarity blended with keyword overlap, then the
 * **permission trim** — chunks the asking user cannot see are dropped (fail
 * closed). `user="*"` is the admin/debug bypass.
 */
export class HybridRetriever {
  constructor(private readonly layer: KnowledgeLayer) {}

  async retrieve(query: string, ctx: RetrieveContext, k = 5): Promise<RetrievedItem[]> {
    const emb = this.layer.embedder.embed(query);
    const candidates = await this.layer.vectors.search(emb, k * 4);
    const qTokens = tokens(query);

    const permitted = candidates.filter((item) =>
      aclVisibleTo(item.chunk.acl, ctx.user, ctx.groups ?? [])
    );

    return permitted
      .map((item) => {
        const cTokens = tokens(item.chunk.text);
        let overlap = 0;
        for (const t of qTokens) if (cTokens.has(t)) overlap++;
        const keyword = qTokens.size ? overlap / qTokens.size : 0;
        return { chunk: item.chunk, score: item.score * 0.7 + keyword * 0.3 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
