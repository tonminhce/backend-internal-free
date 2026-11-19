export const homeUrl = () => '#/';
export const partUrl = (partId) => `#/part/${encodeURIComponent(partId)}`;
export const lessonUrl = (slug, anchor, query) =>
  `#/read/${encodeURIComponent(slug)}${anchor ? '/' + encodeURIComponent(anchor) : ''}${query ? '?q=' + encodeURIComponent(query) : ''}`;

// #/ · #/part/<id> · #/read/<slug>[/<heading>][?q=<terms>]
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [pathOnly, qs] = raw.split('?');
  const seg = pathOnly.split('/').filter(Boolean);
  if (seg[0] === 'read' && seg[1]) {
    return {
      name: 'read',
      slug: decodeURIComponent(seg[1]),
      anchor: seg[2] ? decodeURIComponent(seg[2]) : '',
      query: new URLSearchParams(qs || '').get('q') || '',
    };
  }
  if (seg[0] === 'part' && seg[1]) return { name: 'part', partId: decodeURIComponent(seg[1]) };
  return { name: 'home', slug: '', anchor: '', query: '' };
}

// Writing an identical hash fires no event, so re-render by hand when that happens.
export function navigate(url, onSame) {
  if (location.hash === url) onSame();
  else location.hash = url;
}
