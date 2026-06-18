import { createHash } from "node:crypto";

/** Pluggable text embedder. The default is deterministic and offline. */
export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Deterministic hashing embedder — no model, no network, no downloads. Tokens
 * are hashed into a fixed-width bag-of-words vector and L2-normalized, so cosine
 * similarity approximates term overlap. Good enough to make retrieval real while
 * staying fully offline; swap in a model-backed embedder via config later.
 */
export class HashingEmbedder implements Embedder {
  constructor(public readonly dim = 128) {}

  embed(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const h = parseInt(createHash("sha1").update(tok).digest("hex").slice(0, 8), 16);
      v[h % this.dim] += 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}
