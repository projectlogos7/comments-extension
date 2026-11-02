// Mentions are stored as @[Name](userId) tokens, but people should only ever see "@Name"
// while typing. These helpers convert between the editable text and the stored body.

import { mentionToken } from './text';

export interface MentionCandidate {
  id: string;
  name: string;
}

const TOKEN_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g;

/** Stored body -> editable text ("@[Ana](u1) hi" -> "@Ana hi"). */
export function decodeMentions(body: string): string {
  return body.replace(TOKEN_RE, '@$1');
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Editable text -> stored body. Every "@Name" that matches a candidate's name (case-insensitive,
 * longest names first, followed by a non-word character or the end) becomes a mention token.
 */
export function encodeMentions(text: string, candidates: MentionCandidate[]): string {
  const sorted = [...candidates].filter((c) => c.name.trim()).sort((a, b) => b.name.length - a.name.length);
  if (!sorted.length) return text;
  const placeholders: string[] = [];
  let out = text;
  for (const c of sorted) {
    const re = new RegExp(`@${escapeRe(c.name.trim())}(?![\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(re, () => {
      placeholders.push(mentionToken(c.name.trim(), c.id));
      return `\u0001${placeholders.length - 1}\u0001`;
    });
  }
  return out.replace(/\u0001(\d+)\u0001/g, (_, i: string) => placeholders[Number(i)]);
}

/**
 * The "@query" being typed right before the caret, if any. Returns the query (may contain one
 * space so "Ana Lo" still matches "Ana Lopez") and where it starts.
 */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[\s(])@([\p{L}\p{N}_.'-]*(?: [\p{L}\p{N}_.'-]*)?)$/u);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1 };
}

/** Insert "@Name " for a picked member, replacing the "@query" being typed. */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const q = activeMentionQuery(text, caret);
  const start = q ? q.start : caret;
  const insert = `@${name} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

export function filterCandidates<T extends MentionCandidate & { email?: string }>(list: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  const scored = list
    .map((c) => {
      const n = c.name.toLowerCase();
      const e = (c.email ?? '').toLowerCase();
      const score = !q ? 1 : n.startsWith(q) ? 3 : n.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : n.includes(q) || e.startsWith(q) ? 1 : 0;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((x) => x.c);
}
