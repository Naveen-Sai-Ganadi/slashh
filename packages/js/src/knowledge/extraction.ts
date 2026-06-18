import type { Document } from "./model.js";

/** A reference to an entity by identity (resolved to an id at ingest time). */
export interface EntityRef {
  type: string;
  name: string;
}

export interface ExtractedEntity extends EntityRef {
  aliases?: string[];
  attributes?: Record<string, unknown>;
}

export interface ExtractedEdge {
  subject: EntityRef;
  relation: string;
  fact: string;
  object?: EntityRef;
  /** Single-valued facts (e.g. status) supersede; multi-valued ones (discusses) do not. */
  supersede?: boolean;
}

export interface Extraction {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
}

export interface Extractor {
  extract(doc: Document): Extraction;
}

const DECISION_CUES = [
  /\bdecided to\b/i,
  /\bwe (?:will|are going to)\b/i,
  /\bdeprecat\w*/i,
  /\bapproved\b/i,
  /\bgoing with\b/i,
  /\bwe chose\b/i,
];

const STATUS_RE = /\b([A-Z][A-Za-z0-9]+)\s+is\s+(?:a|an|now a|now an)\s+(prospect|customer|partner|vendor|lead)\b/g;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic, offline rule-based extractor. Produces Person/Topic/Decision
 * entities and DISCUSSES/DECIDED/ABOUT/status edges. This is the default; an
 * LLM-backed extractor can be substituted without changing downstream code.
 */
export class RuleBasedExtractor implements Extractor {
  extract(doc: Document): Extraction {
    const entities: ExtractedEntity[] = [];
    const edges: ExtractedEdge[] = [];
    const add = (e: ExtractedEntity) => {
      if (!entities.some((x) => x.type === e.type && x.name === e.name)) entities.push(e);
    };

    const author: EntityRef | undefined = doc.author
      ? { type: "person", name: doc.author }
      : undefined;
    if (author) add({ ...author, attributes: { role: "author" } });

    // Topics from hashtags.
    const topics: EntityRef[] = [];
    for (const m of doc.text.matchAll(/#([a-zA-Z][a-zA-Z0-9_-]{1,30})/g)) {
      const name = m[1].toLowerCase();
      const ref = { type: "topic", name };
      if (!topics.some((t) => t.name === name)) {
        topics.push(ref);
        add(ref);
      }
    }

    // Author discusses each topic (multi-valued, no supersede).
    if (author) {
      for (const t of topics) {
        edges.push({
          subject: author,
          relation: "DISCUSSES",
          fact: `${author.name} discusses ${t.name}`,
          object: t,
          supersede: false,
        });
      }
    }

    // Status facts (single-valued, supersede prior status).
    for (const m of doc.text.matchAll(STATUS_RE)) {
      const subjectName = m[1];
      const status = m[2].toLowerCase();
      const subj = { type: "org", name: subjectName };
      add(subj);
      edges.push({
        subject: subj,
        relation: "status",
        fact: status,
        supersede: true,
      });
    }

    // Decisions.
    const decisionSentence = sentences(doc.text).find((s) => DECISION_CUES.some((c) => c.test(s)));
    if (decisionSentence && author) {
      const statement = decisionSentence.slice(0, 140);
      const decision: ExtractedEntity = {
        type: "decision",
        name: statement,
        attributes: { statement, decidedAt: doc.eventTime.toISOString() },
      };
      add(decision);
      edges.push({
        subject: author,
        relation: "DECIDED",
        fact: `${author.name} decided: ${statement}`,
        object: decision,
        supersede: false,
      });
      for (const t of topics) {
        edges.push({
          subject: decision,
          relation: "ABOUT",
          fact: `decision about ${t.name}`,
          object: t,
          supersede: false,
        });
      }
    }

    return { entities, edges };
  }
}
