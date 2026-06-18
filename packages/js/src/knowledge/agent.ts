import type { Answer, Citation } from "./model.js";
import type { KnowledgeLayer } from "./layer.js";
import { HybridRetriever, type RetrieveContext } from "./retrieval.js";

/** Optional prose generator. With none, the agent answers extractively. */
export type LlmText = (prompt: string) => Promise<string>;

/**
 * Grounded question answering over the permitted knowledge. Every answer cites
 * the source documents it drew from; when nothing visible matches, it says so
 * rather than guessing.
 */
export class BrainAgent {
  private readonly retriever: HybridRetriever;
  constructor(
    private readonly layer: KnowledgeLayer,
    private readonly llm?: LlmText
  ) {
    this.retriever = new HybridRetriever(layer);
  }

  async ask(question: string, ctx: RetrieveContext, k = 5): Promise<Answer> {
    const items = await this.retriever.retrieve(question, ctx, k);
    if (items.length === 0) {
      return {
        text: "I don't have any information about that in the sources I can see.",
        citations: [],
        grounded: false,
      };
    }

    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const doc = await this.layer.getDocument(item.chunk.documentId);
      if (doc && !seen.has(doc.id)) {
        seen.add(doc.id);
        citations.push({ documentId: doc.id, title: doc.title, url: doc.url });
      }
    }

    const context = items.map((it, i) => `[${i + 1}] ${it.chunk.text}`).join("\n");
    let text: string;
    if (this.llm) {
      text = await this.llm(
        `Answer the question using only the context. Cite with [n].\n\nContext:\n${context}\n\nQuestion: ${question}`
      );
    } else {
      // Extractive fallback: the most relevant snippets, cited.
      text = items.map((it, i) => `[${i + 1}] ${it.chunk.text}`).join("\n");
    }

    return { text, citations, grounded: true };
  }
}
