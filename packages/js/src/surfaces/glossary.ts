import type { KnowledgeLayer, Document } from "../knowledge/index.js";
import type { GlossaryTerm, TimelineItem, SurfaceContext } from "./types.js";
import { canSee, toTimelineItem, snippet } from "./common.js";

const ACRONYM_STOPWORDS = new Set([
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "GET", "API", "URL", "FAQ",
  "OK", "PR", "QA", "UI", "UX", "ID",
]);

function acronymsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2,6})\b/g)) {
    if (!ACRONYM_STOPWORDS.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

function sentenceWith(text: string, term: string): string | undefined {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .find((s) => s.includes(term));
}

async function permittedDocs(layer: KnowledgeLayer, ctx: SurfaceContext): Promise<Document[]> {
  return (await layer.allDocuments()).filter((d) => canSee(ctx, d));
}

function buildTerm(term: string, kind: GlossaryTerm["kind"], docs: Document[]): GlossaryTerm | null {
  const mentions = docs.filter((d) => d.text.includes(term));
  if (mentions.length === 0) return null;
  const defSentence = mentions.map((d) => sentenceWith(d.text, term)).find(Boolean);
  const examples: TimelineItem[] = mentions
    .slice()
    .sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime())
    .slice(0, 3)
    .map(toTimelineItem);
  return {
    term,
    kind,
    definition: defSentence ? snippet(defSentence, 180) : `Used in ${mentions.length} source(s).`,
    examples,
    confidence: Math.min(1, mentions.length / 3),
  };
}

/**
 * Surface 2 — Jargon Decoder. Auto-builds a glossary of acronyms and codenames
 * from real usage in the **permitted** documents only. Cached per (user, groups)
 * and invalidated on ingest.
 */
export async function buildGlossary(
  layer: KnowledgeLayer,
  ctx: SurfaceContext
): Promise<GlossaryTerm[]> {
  const cacheKey = `glossary:${ctx.user}:${(ctx.groups ?? []).slice().sort().join(",")}`;
  const cached = await layer.cache.get<GlossaryTerm[]>(cacheKey);
  if (cached) return cached;

  const docs = await permittedDocs(layer, ctx);

  const terms = new Map<string, GlossaryTerm>();
  // Acronyms from text.
  for (const d of docs) {
    for (const ac of acronymsIn(d.text)) {
      if (!terms.has(ac)) {
        const t = buildTerm(ac, "acronym", docs);
        if (t) terms.set(ac, t);
      }
    }
  }
  // Codenames: known Topic/Project entities that read like names.
  for (const e of layer.allEntities()) {
    if (e.type !== "topic" && e.type !== "project") continue;
    const name = e.name;
    if (terms.has(name) || name.length < 3) continue;
    const t = buildTerm(name, "codename", docs);
    if (t) terms.set(name, t);
  }

  const result = [...terms.values()].sort((a, b) => b.confidence - a.confidence);
  await layer.cache.set(cacheKey, result, 5 * 60 * 1000);
  return result;
}

/** Single-term lookup over the permitted documents. */
export async function define(
  layer: KnowledgeLayer,
  term: string,
  ctx: SurfaceContext
): Promise<GlossaryTerm | null> {
  const docs = await permittedDocs(layer, ctx);
  const kind: GlossaryTerm["kind"] = /^[A-Z]{2,6}$/.test(term) ? "acronym" : "codename";
  return buildTerm(term, kind, docs);
}
