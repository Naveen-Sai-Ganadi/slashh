/**
 * The eight knowledge surfaces — pure functions over the KnowledgeLayer.
 * Every surface is permission-aware (fail closed), bi-temporal (honours
 * `ctx.asOf`), and cites its sources.
 */
export * from "./types.js";
export { NotFoundError } from "./common.js";

export { buildProfile } from "./profiles.js"; // 1. Entity Profiles
export { buildGlossary, define } from "./glossary.js"; // 2. Jargon Decoder
export { findExperts } from "./experts.js"; // 3. Who Knows About X
export { findContradictions } from "./contradictions.js"; // 4. Contradiction Inbox
// 5. Org Time Machine — the `asOf` threaded through every surface above/below.
export { listDecisions, getDecision } from "./decisions.js"; // 6. Decision Log
export { buildPacket } from "./meeting_prep.js"; // 7. Meeting Prep Packets
export { buildCard } from "./cards.js"; // 8. Smart Hover Cards
