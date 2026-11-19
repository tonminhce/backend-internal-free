const DIACRITIC_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export const fold = (s) => s.normalize('NFD').replace(DIACRITIC_MARKS, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// fold preserves length: one code unit in, one out, so an offset found in a folded
// string addresses the same code unit in the original.
export function foldLike(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let base = ch.charCodeAt(0) < 0x80 ? ch : ch.normalize('NFD').charAt(0);
    if (base === 'đ' || base === 'Đ') base = 'd';
    out += base.toLowerCase();
  }
  return out;
}

export const words = (q, min = 2) => fold(q).split(/[\s,;]+/).filter((w) => w.length >= min);

export function positionsOf(hay, needle, cap = 40) {
  const list = [];
  let i = hay.indexOf(needle);
  while (i !== -1 && list.length < cap) {
    list.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return list;
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function markRanges(raw, ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let html = '';
  let cut = 0;
  for (const [s, e] of sorted) {
    if (s < cut) continue;
    html += escapeHtml(raw.slice(cut, s)) + '<mark>' + escapeHtml(raw.slice(s, e)) + '</mark>';
    cut = e;
  }
  return html + escapeHtml(raw.slice(cut));
}

export function snippet(raw, pos, before = 110, after = 210) {
  const start = Math.max(0, pos - before);
  const end = Math.min(raw.length, pos + after);
  return (start > 0 ? '… ' : '') + raw.slice(start, end).trim() + (end < raw.length ? ' …' : '');
}

export const formatNumber = (n, locale = 'vi-VN') => n.toLocaleString(locale);

export const readingMinutes = (wordCount) => Math.max(1, Math.round(wordCount / 200));

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}′`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${m ? ' ' + m + '′' : ''}` : `${h}h`;
}
