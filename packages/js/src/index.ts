export { Brain } from "./brain.js";
export type { BrainRunOptions, BrainRunResult } from "./brain.js";
export type { BrainConfig, AgentConfigT, ConnectionT } from "./types.js";
export type { LLM, LLMRequest, LLMResponse } from "./llm/interface.js";
export { MockLLM } from "./llm/mock.js";
export type { Tool } from "./tool.js";
export { KnowledgeGraph, entityId } from "./graph/knowledge-graph.js";
export type { GraphNode, GraphEdge, GraphSubset, EntityRef } from "./graph/knowledge-graph.js";
export { ingestText, extractKnowledge } from "./graph/ingest.js";
export type { Extraction, IngestResult } from "./graph/ingest.js";
export { answerFromGraph } from "./graph/query.js";
export type { KnowledgeAnswer } from "./graph/query.js";

// Bi-temporal, permission-aware knowledge layer (the foundation for the surfaces).
export * from "./knowledge/index.js";
// The eight read-side knowledge surfaces.
export * as surfaces from "./surfaces/index.js";
export type {
  TimelineItem,
  EntityProfile,
  GlossaryTerm,
  Expert,
  Contradiction,
  DecisionRecord,
  MeetingPacket,
  EntityCard,
  SurfaceContext,
} from "./surfaces/types.js";
