import type { LLM, LLMToolSpec } from "../llm/interface.js";
import type { EntityRef, KnowledgeGraph } from "./knowledge-graph.js";

export interface ExtractedEntity extends EntityRef {
  props?: Record<string, unknown>;
}

export interface ExtractedRelation {
  from: EntityRef;
  type: string;
  to: EntityRef;
  props?: Record<string, unknown>;
}

export interface Extraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const RECORD_TOOL: LLMToolSpec = {
  name: "record_knowledge",
  description:
    "Record the entities and relationships found in the source text into the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        description: "Distinct real-world entities (people, teams, services, concepts, etc.)",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Entity category, e.g. person, service, team" },
            name: { type: "string", description: "Canonical name of the entity" },
            props: { type: "object", description: "Optional attributes/facts about the entity" },
          },
          required: ["type", "name"],
        },
      },
      relations: {
        type: "array",
        description: "Directed relationships between two entities",
        items: {
          type: "object",
          properties: {
            from: {
              type: "object",
              properties: { type: { type: "string" }, name: { type: "string" } },
              required: ["type", "name"],
            },
            type: { type: "string", description: "Relationship verb, e.g. owns, depends_on, reports_to" },
            to: {
              type: "object",
              properties: { type: { type: "string" }, name: { type: "string" } },
              required: ["type", "name"],
            },
            props: { type: "object" },
          },
          required: ["from", "type", "to"],
        },
      },
    },
    required: ["entities"],
  },
};

const EXTRACT_SYSTEM =
  "You are a knowledge extraction engine. Read the source text and call record_knowledge " +
  "with every entity and relationship it contains. Use stable, canonical names so the same " +
  "entity mentioned in different sources resolves to one node. Do not invent facts.";

/** Ask the LLM to extract a structured entity/relation graph from raw text. */
export async function extractKnowledge(params: {
  text: string;
  llm: LLM;
}): Promise<Extraction> {
  const res = await params.llm.complete({
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: params.text }],
    tools: [RECORD_TOOL],
  });
  const call = res.toolCalls?.find((c) => c.name === "record_knowledge");
  if (!call) return { entities: [], relations: [] };
  const args = call.arguments as Partial<Extraction>;
  return {
    entities: Array.isArray(args.entities) ? args.entities : [],
    relations: Array.isArray(args.relations) ? args.relations : [],
  };
}

export interface IngestResult {
  source: string;
  entities: number;
  relations: number;
  stats: { nodes: number; edges: number };
}

/** Extract knowledge from text and merge it into the graph, tracking provenance. */
export async function ingestText(params: {
  text: string;
  source: string;
  llm: LLM;
  graph: KnowledgeGraph;
}): Promise<IngestResult> {
  const { text, source, llm, graph } = params;
  const extraction = await extractKnowledge({ text, llm });

  for (const e of extraction.entities) {
    graph.upsertEntity({ type: e.type, name: e.name }, e.props ?? {}, source);
  }
  for (const r of extraction.relations) {
    graph.upsertRelation(r.from, r.type, r.to, r.props ?? {}, source);
  }

  return {
    source,
    entities: extraction.entities.length,
    relations: extraction.relations.length,
    stats: graph.stats(),
  };
}
