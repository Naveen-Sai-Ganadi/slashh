import type { LLM } from "../llm/interface.js";
import type { GraphSubset, KnowledgeGraph } from "./knowledge-graph.js";

export interface KnowledgeAnswer {
  text: string;
  /** Node ids whose facts were offered to the model as grounding context. */
  citations: string[];
  /** Whether any relevant knowledge was found at all. */
  grounded: boolean;
}

/** Render a subgraph as compact, model-readable fact lines. */
export function renderContext(sub: GraphSubset): string {
  const lines: string[] = [];
  for (const n of sub.nodes) {
    const props = Object.entries(n.props)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    lines.push(`(${n.type}) ${n.name}${props ? ` { ${props} }` : ""}`);
  }
  const nameOf = new Map(sub.nodes.map((n) => [n.id, n.name]));
  for (const e of sub.edges) {
    lines.push(`${nameOf.get(e.from) ?? e.from} --${e.type}--> ${nameOf.get(e.to) ?? e.to}`);
  }
  return lines.join("\n");
}

const ANSWER_SYSTEM =
  "You answer questions strictly from the knowledge-graph facts provided. " +
  "If the facts do not contain the answer, say you don't have that information. " +
  "Be concise and cite entity names you relied on.";

/**
 * Answer a question from the knowledge graph: retrieve the most relevant
 * entities, expand their neighbourhood, and ground the LLM on those facts.
 */
export async function answerFromGraph(params: {
  question: string;
  graph: KnowledgeGraph;
  llm: LLM;
  depth?: number;
  limit?: number;
}): Promise<KnowledgeAnswer> {
  const { question, graph, llm, depth = 1, limit = 8 } = params;
  const seeds = graph.search(question, limit);
  if (seeds.length === 0) {
    return {
      text: "I don't have any information about that in my knowledge graph yet.",
      citations: [],
      grounded: false,
    };
  }

  const sub = graph.subgraph(seeds.map((n) => n.id), depth);
  const context = renderContext(sub);

  const res = await llm.complete({
    system: ANSWER_SYSTEM,
    messages: [
      { role: "user", content: `Knowledge graph facts:\n${context}\n\nQuestion: ${question}` },
    ],
    tools: [],
  });

  return {
    text: res.text ?? "",
    citations: sub.nodes.map((n) => n.id),
    grounded: true,
  };
}
