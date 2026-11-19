import { escapeHtml, fold, foldLike, markRanges, positionsOf, snippet, words } from './text.js';

// A search document: the raw article text plus a length-preserving folded copy, so an
// offset found in `folded` addresses the same code unit in `raw`.
export function makeDoc(meta, raw) {
  return { meta, raw, folded: foldLike(raw), titleFolded: fold(meta.title) };
}

// Positions of every term in the body, plus whether the term appears in the title.
// Returns null as soon as a term is absent everywhere — a doc either matches all
// terms or drops out.
function locate(doc, terms) {
  const occ = [];
  for (const term of terms) {
    const list = positionsOf(doc.folded, term);
    const inTitle = doc.titleFolded.includes(term);
    if (!list.length && !inTitle) return null;
    occ.push({ term, list, inTitle });
  }
  return occ;
}

// Where to open the article: the window that holds as many terms together as possible.
function pickAnchor(occ, window) {
  const rarest = [...occ].filter((o) => o.list.length).sort((a, b) => a.list.length - b.list.length)[0];
  if (!rarest) return { anchor: 0, rarestCount: 0, coLocated: 0 };
  let anchor = rarest.list[0];
  let coLocated = 0;
  for (const candidate of rarest.list) {
    const lo = candidate - window;
    const hi = candidate + window;
    const near = occ.filter((o) => o !== rarest && o.list.some((p) => p >= lo && p <= hi)).length;
    if (near + 1 > coLocated) {
      coLocated = near + 1;
      anchor = candidate;
    }
  }
  return { anchor, rarestCount: rarest.list.length, coLocated };
}

export function search(docs, query, { limit = 40, window = 700 } = {}) {
  const terms = words(query);
  if (!terms.length) return [];

  const hits = [];
  for (const doc of docs) {
    const occ = locate(doc, terms);
    if (!occ) continue;

    const { anchor, rarestCount, coLocated } = pickAnchor(occ, window);
    const inTitle = occ.filter((o) => o.inTitle).length;
    const inBody = occ.filter((o) => o.list.length).length;
    const density = occ.reduce((sum, o) => sum + Math.min(10, o.list.length), 0);

    let score = inTitle * 45 + inBody * 14 + Math.min(14, density);
    if (rarestCount === 1) score += 25;
    if (coLocated === terms.length) score += 20;
    score -= Math.min(8, Math.floor(anchor / 8000));

    hits.push({ doc, score, pos: anchor, section: sectionAt(doc.meta, anchor), inTitle, inBody });
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.meta.order - b.doc.meta.order).slice(0, limit);
}

// Which heading owns a character offset — the outline is sorted by `at`, so bisect.
export function sectionAt(meta, pos) {
  const list = meta.outline || [];
  if (!list.length || !Number.isFinite(list[0].at)) return null;
  if (pos < list[0].at) return list[0];
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].at <= pos) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

// Snippet with every term wrapped in <mark>, matched on the folded copy.
export function markSnippet(raw, pos, query) {
  const text = snippet(raw, pos);
  const terms = words(query);
  if (!terms.length) return escapeHtml(text);
  const folded = foldLike(text);
  const ranges = [];
  for (const term of terms) for (const p of positionsOf(folded, term, 200)) ranges.push([p, p + term.length]);
  return ranges.length ? markRanges(text, ranges) : escapeHtml(text);
}
