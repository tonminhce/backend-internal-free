import { detectLang, LANG_LABELS } from './lib/lang.js';
import { canHighlight, highlight } from './lib/syntax.js';
import { escapeHtml, fold, formatNumber } from './lib/text.js';
import { lessonUrl, navigate, parseHash, partUrl } from './lib/router.js';
import { makeDoc, markSnippet, search, sectionAt } from './lib/search.js';

const el = (id) => document.getElementById(id);
const esc = escapeHtml;
const fmt = (n) => formatNumber(n);
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

const store = {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage disabled */ } },
};

const KEY = { theme: 'bi:theme', read: 'bi:read', parts: 'bi:openParts', nav: 'bi:navClosed', pos: 'bi:pos', recent: 'bi:recent' };

const state = {
  manifest: null,
  bySlug: new Map(),
  partsById: new Map(),
  articles: new Map(),
  docs: null,
  docsLoading: null,
  read: new Set(store.get(KEY.read, [])),
  positions: store.get(KEY.pos, {}),
  recents: store.get(KEY.recent, []),
  route: null,
  rail: null,
  hits: [],
  sel: 0,
  frame: 0,
  lastSaved: 0,
  searchTimer: 0,
  searchFocus: null,
  lightboxFocus: null,
};

/* The public edition is the same app with paid lessons reduced to a notice, so the only thing it
   needs to know is which lessons are readable. Progress, prev/next and the counter chips all
   follow from that, and the private build keeps its existing behaviour because edition is absent. */
const freeEdition = () => state.manifest?.edition === 'free';
const locked = (a) => Boolean(a && a.paid && freeEdition());
const tagText = (a) => (a.paid ? (freeEdition() ? 'cần subscription' : 'kho trả phí') : 'công khai');
const readable = () => state.manifest.articles.filter((a) => !locked(a));

/* -------------------------------------------------------------------- fetch */
async function json(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadArticle(slug) {
  if (!state.articles.has(slug)) state.articles.set(slug, await json(`data/articles/${slug}.json`));
  return state.articles.get(slug);
}

/* --------------------------------------------------------------------- toast */
const shownToasts = new Map();

function toast(message, kind = 'ok', ttl = 4200) {
  const host = el('toastHost');
  if (!host) return;
  if (Date.now() - (shownToasts.get(message) || 0) < ttl) return;
  shownToasts.set(message, Date.now());
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = kind;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${
    kind === 'error' ? '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>' : '<path d="m5 13 4 4L19 7"/>'
  }</svg><span>${esc(message)}</span>`;
  host.append(node);
  setTimeout(() => node.remove(), ttl);
}

/* --------------------------------------------------------------------- theme */
function setTheme(theme, explicit) {
  document.documentElement.dataset.theme = theme;
  el('themeToggle')?.setAttribute('aria-pressed', String(theme === 'dark'));
  if (explicit) store.set(KEY.theme, theme);
}

function initTheme() {
  setTheme(store.get(KEY.theme, null) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
  el('themeToggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!store.get(KEY.theme, null)) setTheme(e.matches ? 'dark' : 'light', false);
  });
}

/* ------------------------------------------------------------------- sidebar */
function sidebarHtml() {
  const { parts, articles } = state.manifest;
  const open = new Set(store.get(KEY.parts, parts.map((p) => p.id)));
  let html = `<div class="side-group"><a class="side-link" href="#/" data-side="home">Tổng quan kho bài</a></div>`;

  for (const part of parts) {
    const lessons = articles.filter((a) => a.partId === part.id);
    const countable = lessons.filter((a) => !locked(a));
    const done = countable.filter((a) => state.read.has(a.slug)).length;
    const expanded = open.has(part.id);
    html += `<div class="side-group">
      <button type="button" class="part-head" data-part="${esc(part.id)}" aria-expanded="${expanded}" aria-controls="part-${esc(part.id)}">
        <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        <span>${esc(part.title)}</span>
        <span class="count${countable.length && done === countable.length ? ' complete' : ''}">${countable.length ? `${done}/${countable.length}` : '—'}</span>
      </button>
      <div class="part-body" id="part-${esc(part.id)}" data-body="${esc(part.id)}"${expanded ? '' : ' hidden'}>`;
    if (!lessons.length) html += `<p class="empty-note">${esc(part.summary)}</p>`;
    for (const g of [...new Set(lessons.map((a) => a.group || ''))]) {
      const meta = part.groups.find((x) => x.id === g);
      if (meta) html += `<p class="group-title">${esc(meta.title)}</p>`;
      for (const a of lessons.filter((x) => (x.group || '') === g)) {
        const isLocked = locked(a);
        html += `<a class="lesson" href="${lessonUrl(a.slug)}" data-lesson="${esc(a.slug)}"${isLocked ? ' data-locked="1"' : ''}>
          <span class="num">${a.order}</span>
          <span class="lbl">${esc(a.title)}</span>
          ${isLocked
            ? `<span class="lockmark" title="Cần subscription"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg></span>`
            : `<span class="mins">${a.minutes}′</span>`}
          ${state.read.has(a.slug) && !isLocked ? '<span class="dot" title="Đã đánh dấu đọc"></span>' : ''}
        </a>`;
      }
    }
    html += `</div></div>`;
  }

  if (state.manifest.redis?.length) {
    html += `<div class="side-group"><p class="side-title">Tra nhanh theo chủ đề</p>`;
    for (const r of state.manifest.redis) {
      html += `<a class="side-link" href="${lessonUrl(r.slug, r.sections[0])}">Redis · ${esc(r.topic)}</a>`;
    }
    html += `</div>`;
  }

  html += `<div class="side-group"><p class="side-title">Phím tắt</p><p class="side-keys">
    <kbd>/</kbd> hoặc <kbd>Ctrl</kbd>+<kbd>K</kbd> tìm · <kbd>[</kbd> <kbd>]</kbd> bài trước/sau ·
    <kbd>Ctrl</kbd>+<kbd>Enter</kbd> đánh dấu đã đọc · <kbd>Esc</kbd> đóng
  </p></div>`;
  return html;
}

function buildSidebar() {
  const nav = el('sidebar');
  const scrollTop = nav.scrollTop;
  nav.innerHTML = sidebarHtml();
  nav.scrollTop = scrollTop;
  nav.querySelectorAll('.part-head').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.part;
    const body = nav.querySelector(`[data-body="${id}"]`);
    const willOpen = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(willOpen));
    body.hidden = !willOpen;
    store.set(KEY.parts, [...nav.querySelectorAll('.part-head[aria-expanded="true"]')].map((b) => b.dataset.part));
  }));
}

function markActive(slug) {
  const nav = el('sidebar');
  nav.querySelectorAll('[aria-current]').forEach((n) => n.removeAttribute('aria-current'));
  if (!slug) {
    nav.querySelector('.side-link[data-side="home"]')?.setAttribute('aria-current', 'page');
    return;
  }
  const link = nav.querySelector(`.lesson[data-lesson="${CSS.escape(slug)}"]`);
  if (!link) return;
  link.setAttribute('aria-current', 'page');
  const body = link.closest('.part-body');
  if (body && body.hidden) {
    body.hidden = false;
    nav.querySelector(`.part-head[data-part="${CSS.escape(body.dataset.body)}"]`)?.setAttribute('aria-expanded', 'true');
  }
  link.scrollIntoView({ block: 'nearest' });
}

function refreshProgress() {
  const list = readable();
  const done = list.filter((a) => state.read.has(a.slug)).length;
  const stat = el('progressStat');
  stat.textContent = `${done} / ${list.length}`;
  stat.title = `Đã đánh dấu đọc ${done}/${list.length} bài`;
  buildSidebar();
  markActive(state.route?.slug || '');
}

/* ----------------------------------------------------------------- dashboard */
function ringMarkup(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="ring">
    <svg viewBox="0 0 120 120" role="img" aria-label="Hoàn thành ${pct}% kho bài">
      <circle class="track" cx="60" cy="60" r="52"></circle>
      <circle class="value" cx="60" cy="60" r="52" data-ring-value="${pct}"></circle>
    </svg>
    <b>${pct}%</b><small>${done}/${total} bài đã đọc</small>
  </div>`;
}

// Percentages travel as data attributes so the document never needs an inline style
// attribute — that is what lets style-src stay strict in the CSP.
function applyDecor(root) {
  for (const n of root.querySelectorAll('[data-fill]')) n.style.width = `${clamp(Number(n.dataset.fill), 0, 100)}%`;
  const circumference = 2 * Math.PI * 52;
  for (const n of root.querySelectorAll('[data-ring-value]')) {
    n.style.strokeDasharray = String(circumference);
    n.style.strokeDashoffset = String(circumference * (1 - clamp(Number(n.dataset.ringValue), 0, 100) / 100));
  }
}

function continueCard() {
  const entry = Object.entries(state.positions)
    .filter(([slug, p]) => state.bySlug.has(slug) && !state.read.has(slug) && p.ratio > 0.05)
    .sort((a, b) => b[1].ts - a[1].ts)[0];
  if (!entry) return '';
  const [slug, p] = entry;
  const a = state.bySlug.get(slug);
  const part = state.partsById.get(a.partId);
  return `<div class="continue">
    <div class="c-body">
      <p class="c-kicker">Đọc dở</p>
      <h3><a href="${lessonUrl(slug)}">${esc(a.title)}</a></h3>
      <p class="c-meta">${Math.round(p.ratio * 100)}% · còn ~${Math.max(1, Math.round(a.minutes * (1 - p.ratio)))}′ · ${esc(part ? part.title : '')}</p>
    </div>
    <a class="btn primary" href="${lessonUrl(slug)}">Đọc tiếp</a>
  </div>`;
}

function renderDashboard() {
  const m = state.manifest;
  const list = readable();
  const done = list.filter((a) => state.read.has(a.slug)).length;
  const paid = m.articles.filter((a) => a.paid).length;
  const chips = freeEdition()
    ? [`${m.articles.length} bài trong kho`, `${list.length} bài toàn văn`, `${fmt(m.counts.words)} từ`,
        `${fmt(m.counts.images)} sơ đồ`, `dựng ngày ${esc(m.generatedAt)}`]
    : [`${m.articles.length} bài`, `${fmt(m.counts.words)} từ`, `${paid} bài kho trả phí`,
        `${m.articles.length - paid} bài công khai`, `${fmt(m.counts.images)} sơ đồ`, `dựng ngày ${esc(m.generatedAt)}`];
  el('main').innerHTML = `<div class="wrap">
    <section class="hero">
      <div>
        <p class="eyebrow">${freeEdition() ? 'ZemIT · bản công khai' : 'ZemIT · bản học offline'}</p>
        <h1>Kho bài Backend Internal</h1>
        <p class="lede">${esc(m.source)}. ${
          freeEdition()
            ? 'Toàn văn các bài công khai, mục lục đầy đủ 28 bài và tìm kiếm xuyên kho.'
            : 'Toàn văn, mục lục, tìm kiếm xuyên kho và thứ tự đọc xếp sẵn — mở không cần mạng.'
        }</p>
        <div class="hero-meta">${chips.map((c) => `<span>${c}</span>`).join('')}</div>
      </div>
      ${ringMarkup(done, list.length)}
    </section>

    ${freeEdition() ? `<div class="notice">
      ${m.articles.length - list.length} bài nữa nằm sau subscription, nên ở đây chúng chỉ còn tiêu đề, mô tả và link về bài gốc.
      Bản công khai này gồm đúng những bài ZemIT mở miễn phí. Toàn văn bài trả phí ở <a href="https://zemitprivate.substack.com/subscribe" target="_blank" rel="noopener noreferrer">zemitprivate.substack.com</a>.
    </div>` : ''}

    ${continueCard()}

    <h2 class="section-title">Lộ trình gợi ý <span class="n">${m.paths.length} lối đi</span></h2>
    <div class="grid">${m.paths.map((p) => `<div class="path">
        <h3>${esc(p.title)}</h3>
        <p class="why">${esc(p.note)}</p>
        <ol>${p.steps.map((s) => {
          const a = state.bySlug.get(s);
          if (!a) return '';
          return `<li${state.read.has(s) ? ' class="done"' : ''}><a href="${lessonUrl(s)}">${esc(a.title)}</a><span class="mins">${a.minutes}′</span></li>`;
        }).join('')}</ol>
      </div>`).join('')}</div>

    <h2 class="section-title">Toàn bộ theo phần <span class="n">${m.parts.length} phần</span></h2>
    <div class="grid">${m.parts.map((p) => {
      const lessons = m.articles.filter((a) => a.partId === p.id);
      const countable = lessons.filter((a) => !locked(a));
      const done = countable.filter((a) => state.read.has(a.slug)).length;
      return `<a class="card" href="${partUrl(p.id)}">
        <h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>
        <div class="foot"><span>${lessons.length} bài</span><span>${countable.reduce((s, a) => s + a.minutes, 0)}′ đọc</span>
          <span class="push-right">${countable.length ? `${done}/${countable.length} đã đọc` : 'chưa có bài toàn văn'}</span></div>
        <div class="progress-line"><i data-fill="${countable.length ? Math.round((done / countable.length) * 100) : 0}"></i></div>
      </a>`;
    }).join('')}</div>
  </div>`;
  applyDecor(el('main'));
}

function renderPart(partId) {
  const part = state.partsById.get(partId);
  if (!part) return renderNotFound(partId);
  const lessons = state.manifest.articles.filter((a) => a.partId === partId);
  const countable = lessons.filter((a) => !locked(a));
  const done = countable.filter((a) => state.read.has(a.slug)).length;
  const card = (a) => `<a class="card" href="${lessonUrl(a.slug)}">
      <h3><span class="order">${a.order}.</span> ${esc(a.title)}</h3>
      <p>${esc(a.dek)}</p>
      <div class="foot"><span class="tag ${a.paid ? 'paid' : 'free'}">${tagText(a)}</span>
        ${locked(a) ? `<span>${a.minutes}′ bài gốc</span>` : `<span>${a.minutes}′</span><span>${fmt(a.words)} từ</span>`}
        ${state.read.has(a.slug) && !locked(a) ? '<span class="done-label">đã đọc</span>' : ''}</div>
    </a>`;
  const body = [...new Set(lessons.map((a) => a.group || ''))].map((g) => {
    const meta = part.groups.find((x) => x.id === g);
    return `${meta ? `<h2 class="group-title">${esc(meta.title)}</h2>` : ''}
      <div class="grid">${lessons.filter((x) => (x.group || '') === g).map(card).join('')}</div>`;
  }).join('');

  el('main').innerHTML = `<div class="wrap">
    <div class="part-banner">
      <h1>${esc(part.title)}</h1>
      <p>${esc(part.summary)}</p>
      <p class="hero-meta"><span>${lessons.length} bài</span><span>${countable.reduce((s, a) => s + a.minutes, 0)}′ đọc</span><span>${countable.length ? `${done}/${countable.length} đã đọc` : 'tất cả cần subscription'}</span></p>
    </div>
    ${body || `<div class="notice">${esc(part.summary)}</div>`}
  </div>`;
}

/* -------------------------------------------------------------------- reader */
function readButton(slug, small) {
  if (locked(state.bySlug.get(slug))) return '';
  const on = state.read.has(slug);
  return `<button type="button" class="btn${small ? ' sm' : ''}${on ? ' done' : ''}" data-read-toggle="${esc(slug)}" aria-pressed="${on}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>
    <span>${on ? 'Đã đánh dấu đọc' : 'Đánh dấu đã đọc'}</span>
  </button>`;
}

/* The footer under a lesson. Wording has to work on the public site too, where there is no
   private copy to point at, so it only ever claims what the reader can see. */
function sourceNote(article) {
  const link = `<a href="${esc(article.sourceUrl)}" target="_blank" rel="noopener noreferrer external">bài gốc trên Substack</a>`;
  return `<p class="source-note">${locked(article)
    ? `Toàn văn bài này thuộc kho subscriber-only. Đọc tại ${link}.`
    : `Toàn văn ở đây trích từ ${link}; chạy lại bản dựng khi bài gốc đổi.`}</p>`;
}

async function renderArticle(route) {
  const { slug, anchor, query } = route;
  const meta = state.bySlug.get(slug);
  if (!meta) return renderNotFound(slug);
  el('main').innerHTML = '<div class="wrap"><div class="loading">Đang mở bài…</div></div>';

  let article;
  try {
    article = await loadArticle(slug);
  } catch {
    el('main').innerHTML = `<div class="wrap"><div class="notice">Không đọc được <code>${esc(slug)}.json</code>. Chạy app qua <code>node tools/serve.mjs</code> rồi tải lại trang.</div></div>`;
    toast('Không tải được bài viết', 'error');
    return;
  }

  const part = state.partsById.get(meta.partId);
  const group = meta.group && part ? part.groups.find((g) => g.id === meta.group) : null;
  const all = readable();
  const i = all.findIndex((a) => a.slug === slug);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i > -1 && i < all.length - 1 ? all[i + 1] : null;
  const saved = state.positions[slug];
  const resumable = saved && !anchor && !state.read.has(slug) && saved.ratio > 0.04 && saved.ratio < 0.9;

  el('main').innerHTML = `<article class="reader">
    <div class="column">
      <div class="minihead" id="minihead">
        <span class="mh-title">${esc(article.title)}</span>
        <span class="mh-sec" data-mini-section></span>
        ${readButton(slug, true)}
      </div>
      <header class="art-head" id="artHead">
        <nav class="crumbs" aria-label="Vị trí trong mục lục">
          <a href="#/">Tổng quan</a><span class="crumb-sep">/</span>
          <a href="${partUrl(meta.partId)}">${esc(part ? part.title : meta.partId)}</a>
          ${group ? `<span class="crumb-sep">/</span><span class="here">${esc(group.title)}</span>` : ''}
        </nav>
        <h1 class="art-title">${esc(article.title)}</h1>
        <p class="dek">${esc(article.dek)}</p>
        <div class="art-meta">
          <span class="tag ${article.paid ? 'paid' : 'free'}">${tagText(article)}</span>
          <span>${esc(article.date)}</span><span class="sep"></span>
          <span>${article.minutes}′ ${locked(article) ? 'bài gốc' : 'đọc'}</span>
          ${locked(article) ? '' : `<span class="sep"></span><span>${fmt(article.words)} từ</span>`}
          <span class="spacer"></span>
          ${readButton(slug)}
        </div>
      </header>
      ${resumable ? `<div class="resume" id="resumeBar">
        <p>Lần đọc trước bạn dừng ở bài này lúc <b>${Math.round(saved.ratio * 100)}%</b>.</p>
        <button type="button" class="btn primary" data-resume="${saved.ratio.toFixed(4)}">Đọc tiếp</button>
        <button type="button" class="btn ghost" data-resume-start>Đọc từ đầu</button>
      </div>` : ''}
      <div class="prose" id="prose">${article.html}</div>
      ${sourceNote(article)}
      <nav class="lesson-nav" aria-label="Bài trước và bài sau">
        ${prev ? `<a href="${lessonUrl(prev.slug)}"><small>← Bài trước</small><span class="t">${esc(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="next" href="${lessonUrl(next.slug)}"><small>Bài sau →</small><span class="t">${esc(next.title)}</span></a>` : '<span></span>'}
      </nav>
    </div>
    <aside class="rail" id="rail" aria-label="Dàn ý bài viết">
      <p class="rail-title">Dàn ý</p>
      ${railList(article.outline)}
    </aside>
  </article>`;

  document.title = `${article.title} · Backend Internal`;
  decorateProse(el('prose'));
  setupRail(article.outline);
  el('resumeBar')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-resume-start]')) { el('resumeBar').remove(); jumpTop(); return; }
    const btn = e.target.closest('[data-resume]');
    if (!btn) return;
    scrollToRatio(Number(btn.dataset.resume));
    el('resumeBar').remove();
  });

  if (query) {
    const found = markProse(el('prose'), query);
    jumpToFirstMark(anchor);
    if (!found) toast(`Không gặp “${query}” trong bài này`, 'error');
  } else if (anchor) {
    requestAnimationFrame(() => scrollToId(anchor));
  } else {
    jumpTop();
  }
  handleScroll();
}

function railList(outline) {
  const items = (outline || []).filter((o) => o.level <= 3 && o.id);
  if (!items.length) return '<ol><li><span class="empty">Bài này không có tiêu đề phụ.</span></li></ol>';
  return `<ol>${items.map((o) => `<li><a class="lvl${o.level}" href="#${esc(o.id)}" data-anchor="${esc(o.id)}">${esc(o.text)}</a></li>`).join('')}</ol>`;
}

function decorateProse(prose) {
  for (const h of prose.querySelectorAll('h2[id],h3[id],h4[id],h5[id]')) {
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.textContent = '#';
    a.setAttribute('aria-hidden', 'true');
    a.tabIndex = -1;
    h.prepend(a);
  }
  for (const pre of prose.querySelectorAll('pre')) wrapCode(pre);
  for (const img of prose.querySelectorAll('img')) {
    img.loading = 'lazy';
    img.decoding = 'async';
    if (!img.alt) img.alt = 'Sơ đồ trong bài';
    img.addEventListener('error', () => img.closest('figure')?.classList.add('img-missing'), { once: true });
    if (!img.closest('figure')) continue;
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `Phóng to sơ đồ: ${img.alt}`);
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(img);
      }
    });
  }
  for (const table of prose.querySelectorAll('table')) {
    if (table.parentElement.classList.contains('table-scroll')) continue;
    const box = document.createElement('div');
    box.className = 'table-scroll';
    table.replaceWith(box);
    box.append(table);
  }
  // the scraper stamped every cross-post link with target="_blank"; inside the reader they are local
  for (const a of prose.querySelectorAll('a[href^="#/"]')) {
    a.removeAttribute('target');
    a.removeAttribute('rel');
  }
}

function wrapCode(pre) {
  const code = pre.querySelector('code') || pre;
  const src = code.textContent.replace(/\n+$/, '');
  const lang = (code.dataset.lang || detectLang(src)).trim() || 'text';

  const bar = document.createElement('div');
  bar.className = 'code-bar';
  const label = document.createElement('span');
  label.className = 'code-lang';
  label.textContent = LANG_LABELS[lang] || lang;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code-copy';
  copy.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><span>Chép</span>`;
  copy.addEventListener('click', () => copyCode(copy, code.textContent));

  if (canHighlight(lang)) code.innerHTML = highlight(src, lang);
  bar.append(label, copy);
  const box = document.createElement('div');
  box.className = 'code';
  pre.replaceWith(box);
  box.append(bar, pre);
}

async function copyCode(button, text) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ok = fallbackCopy(text);
  }
  const label = button.querySelector('span');
  button.classList.toggle('ok', ok);
  label.textContent = ok ? 'Đã chép' : 'Không chép được';
  setTimeout(() => {
    button.classList.remove('ok');
    label.textContent = 'Chép';
  }, 1800);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.className = 'sr-only';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/* --------------------------------------------------------- scroll behaviour */
function scrollMax() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - doc.clientHeight);
}

function readingRatio() {
  const max = scrollMax();
  return max > 4 ? clamp((window.scrollY || document.documentElement.scrollTop) / max) : 1;
}

function onScroll() {
  if (!state.frame) state.frame = requestAnimationFrame(() => handleScroll());
}

function handleScroll() {
  state.frame = 0;
  if (state.route?.name !== 'read') return;
  const ratio = readingRatio();
  const bar = el('readBar');
  bar.classList.toggle('on', ratio > 0.004);
  bar.style.setProperty('--p', ratio.toFixed(4));

  const head = el('artHead');
  const mini = el('minihead');
  if (head && mini) mini.classList.toggle('on', head.getBoundingClientRect().bottom < el('topbar').offsetHeight + 12);

  if (Date.now() - state.lastSaved > 600) {
    state.lastSaved = Date.now();
    remember(state.route.slug, ratio);
  }
}

function remember(slug, ratio) {
  if (!slug || ratio < 0.02) return;
  state.positions[slug] = { ratio: clamp(ratio, 0, 0.999), ts: Date.now() };
  store.set(KEY.pos, state.positions);
}

function scrollToRatio(ratio) {
  jumpTo(Math.round(clamp(ratio) * scrollMax()));
}

function jumpTo(top) {
  try { window.scrollTo({ top, behavior: 'instant' }); } catch { window.scrollTo(0, top); }
}

const jumpTop = () => jumpTo(0);

function scrollToId(id) {
  const node = document.getElementById(id);
  if (!node) return false;
  node.scrollIntoView({ block: 'start' });
  history.replaceState(null, '', lessonUrl(state.route.slug, id));
  return true;
}

/* ------------------------------------------------------------- outline rail */
function setupRail(outline) {
  const rail = el('rail');
  if (state.rail) state.rail.disconnect();
  state.rail = null;
  if (!rail) return;

  const links = new Map([...rail.querySelectorAll('[data-anchor]')].map((a) => [a.dataset.anchor, a]));
  const order = [...links.keys()];
  const visible = new Set();
  const miniSection = document.querySelector('[data-mini-section]');

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target.id);
      else visible.delete(e.target.id);
    }
    const current = order.find((id) => visible.has(id));
    if (!current) return;
    for (const [id, a] of links) {
      if (id === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    if (miniSection) miniSection.textContent = `§ ${links.get(current).textContent.trim()}`;
  }, { rootMargin: '-25% 0% -65% 0%', threshold: 0 });

  for (const o of outline) {
    const node = document.getElementById(o.id);
    if (node) io.observe(node);
  }
  state.rail = io;
}

/* ------------------------------------------------------ in-article marking */
function markProse(root, query) {
  const terms = fold(query).split(/[\s,;]+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!terms.length) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest('.mark, .anchor, .code-bar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let count = 0;
  for (const node of nodes) {
    if (count > 800) break;
    const raw = node.nodeValue;
    // NFD-strip preserves length, so a folded offset addresses the same code unit as raw
    const folded = fold(raw);
    const ranges = [];
    for (const term of terms) {
      let i = folded.indexOf(term);
      while (i !== -1) {
        ranges.push([i, i + term.length]);
        i = folded.indexOf(term, i + term.length);
      }
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);

    const frag = document.createDocumentFragment();
    let cut = 0;
    for (const [s, e] of ranges) {
      if (s < cut) continue;
      frag.append(document.createTextNode(raw.slice(cut, s)));
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = raw.slice(s, e);
      frag.append(mark);
      cut = e;
      count++;
    }
    frag.append(document.createTextNode(raw.slice(cut)));
    node.replaceWith(frag);
  }
  return count;
}

function jumpToFirstMark(anchor) {
  const marks = [...document.querySelectorAll('.prose .mark')];
  if (!marks.length) return;
  const heading = anchor && document.getElementById(anchor);
  const target = heading
    ? marks.find((m) => heading.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) || marks[0]
    : marks[0];
  target.closest('p, li, h2, h3, h4, h5, pre, td')?.scrollIntoView({ block: 'center' });
}

/* ------------------------------------------------------------------ lightbox */
function openLightbox(img) {
  const box = el('lightbox');
  const target = box.querySelector('img');
  target.src = img.currentSrc || img.src;
  target.alt = img.alt || 'Sơ đồ phóng to';
  box.querySelector('figcaption').textContent =
    img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt || '';
  state.lightboxFocus = img;
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  el('lbClose').focus();
}

function closeLightbox() {
  const box = el('lightbox');
  if (box.hidden) return;
  box.hidden = true;
  document.body.style.overflow = '';
  state.lightboxFocus?.focus?.();
  state.lightboxFocus = null;
}

/* -------------------------------------------------------------------- search */
function ensureDocs() {
  if (state.docs) return state.docs;
  if (!state.docsLoading) {
    state.docsLoading = Promise.all(state.manifest.articles.map(async (a) => {
      try {
        return makeDoc(a, (await json(`data/text/${a.slug}.json`)).text || '');
      } catch {
        return null;
      }
    })).then((list) => { state.docs = list.filter(Boolean); return state.docs; });
  }
  return state.docsLoading;
}

function emptyQueryView() {
  state.hits = [];
  state.sel = 0;
  el('searchHint').textContent = 'Nhập ít nhất 2 ký tự. Bỏ dấu vẫn tìm được.';
  const blocks = [];
  if (state.recents.length) {
    blocks.push(`<p class="search-group">Tìm gần đây</p><div class="chips">${state.recents.map((t) =>
      `<button type="button" class="chip" data-term="${esc(t)}">${esc(t)}<span class="x" data-forget="${esc(t)}" title="Bỏ khỏi lịch sử">×</span></button>`).join('')}</div>`);
  }
  const hot = (state.manifest.redis || []).slice(0, 8).map((r) => r.topic);
  if (hot.length) {
    blocks.push(`<p class="search-group">Chủ đề hay tra</p><div class="chips">${hot.map((t) =>
      `<button type="button" class="chip" data-term="${esc(t)}">${esc(t)}</button>`).join('')}</div>`);
  }
  el('searchResults').innerHTML = `${blocks.join('')}<div class="search-empty">
    Đã lập chỉ mục <b>${state.manifest.counts.articles}</b> bài · <b>${fmt(state.manifest.counts.words)}</b> từ · <b>${fmt(state.manifest.counts.images)}</b> sơ đồ
  </div>`;
}

function drawHits(query) {
  const hits = search(state.docs, query);
  const box = el('searchResults');
  const hint = el('searchHint');

  if (!hits.length) {
    state.hits = [];
    state.sel = 0;
    hint.innerHTML = `Không thấy “${esc(query)}” trong kho. Thử từ ngắn hơn: <code>gap</code>, <code>ack</code>, <code>keyset</code>.`;
    box.innerHTML = '<div class="search-empty"><b>0</b> kết quả. Tìm không phân biệt dấu, nên “chi phí” và “chi phi” như nhau.</div>';
    return;
  }

  const buckets = new Map();
  for (const h of hits) {
    if (!buckets.has(h.doc.meta.partId)) buckets.set(h.doc.meta.partId, []);
    buckets.get(h.doc.meta.partId).push(h);
  }
  state.hits = [...buckets.values()].flat();
  state.sel = 0;
  hint.innerHTML = `<strong>${hits.length}</strong> kết quả cho “${esc(query)}” · bỏ dấu vẫn khớp`;

  let i = 0;
  let html = '';
  for (const [partId, list] of buckets) {
    const part = state.partsById.get(partId);
    html += `<p class="search-group">${esc(part ? part.title : 'Khác')} · ${list.length} bài</p>`;
    for (const h of list) {
      const m = h.doc.meta;
      const section = h.section || sectionAt(m, h.pos);
      html += `<button type="button" class="hit${i === 0 ? ' sel' : ''}" data-i="${i}" data-slug="${esc(m.slug)}" data-anchor="${section ? esc(section.id) : ''}" data-q="${esc(query)}">
        <span class="h-top"><span class="h-title">${esc(m.title)}</span><span class="h-part">bài ${m.order} · ${m.minutes}′</span></span>
        <span class="h-snip">${markSnippet(h.doc.raw, h.pos, query)}</span>
        ${section ? `<span class="h-sec">§ ${esc(section.text)}</span>` : ''}
      </button>`;
      i++;
    }
  }
  box.innerHTML = html;
}

function scheduleSearch(raw) {
  const query = raw.trim();
  clearTimeout(state.searchTimer);
  if (!query) { emptyQueryView(); return; }
  if (state.docs) {
    state.searchTimer = setTimeout(() => drawHits(query), 110);
    return;
  }
  el('searchSpinner').hidden = false;
  el('searchResults').innerHTML = '<div class="search-empty">Đang lập chỉ mục toàn bộ kho bài…</div>';
  state.searchTimer = setTimeout(async () => {
    try {
      await ensureDocs();
      drawHits(el('searchInput').value.trim());
    } catch {
      toast('Không đọc được file chỉ mục', 'error');
    } finally {
      el('searchSpinner').hidden = true;
    }
  }, 110);
}

function rememberQuery(query) {
  const q = (query || '').trim();
  if (q.length < 2) return;
  state.recents = [q, ...state.recents.filter((t) => fold(t) !== fold(q))].slice(0, 8);
  store.set(KEY.recent, state.recents);
}

function openSearch() {
  const overlay = el('searchOverlay');
  if (!overlay.hidden) return;
  state.searchFocus = document.activeElement;
  overlay.hidden = false;
  el('shell').inert = true;
  document.body.style.overflow = 'hidden';
  ensureDocs().catch(() => {});
  const input = el('searchInput');
  if (!input.value.trim()) emptyQueryView();
  input.focus();
  input.select();
}

function closeSearch() {
  const overlay = el('searchOverlay');
  if (overlay.hidden) return;
  overlay.hidden = true;
  el('shell').inert = false;
  if (!el('lightbox').hidden) return;
  document.body.style.overflow = '';
  state.searchFocus?.focus?.();
  state.searchFocus = null;
}

function openHit(node) {
  const { slug, anchor, q } = node.dataset;
  rememberQuery(q);
  closeSearch();
  navigate(lessonUrl(slug, anchor || '', q), render);
}

function moveSelection(delta) {
  const nodes = [...el('searchResults').querySelectorAll('.hit')];
  if (!nodes.length) return;
  state.sel = (state.sel + delta + nodes.length) % nodes.length;
  nodes.forEach((n, i) => n.classList.toggle('sel', i === state.sel));
  nodes[state.sel].scrollIntoView({ block: 'nearest' });
}

/* -------------------------------------------------------------------- router */
function renderNotFound(what) {
  el('main').innerHTML = `<div class="wrap"><div class="notice">
    Không tìm thấy <code>${esc(what)}</code> trong kho. <a href="#/">Về tổng quan</a>.
  </div></div>`;
}

async function render() {
  const route = parseHash(location.hash);
  if (state.route?.name === 'read') remember(state.route.slug, readingRatio());
  if (state.rail) { state.rail.disconnect(); state.rail = null; }
  state.route = route;
  closeSearch();
  closeLightbox();
  el('readBar').classList.remove('on');
  markActive(route.slug);
  document.title = route.name === 'read' ? 'Đang mở bài · Backend Internal' : 'Backend Internal — kho bài đọc để học';
  el('shell').classList.remove('nav-open');
  el('scrim').hidden = true;
  try {
    if (route.name === 'read') await renderArticle(route);
    else if (route.name === 'part') renderPart(route.partId);
    else renderDashboard();
  } catch (err) {
    el('main').innerHTML = `<div class="wrap"><div class="notice">Lỗi dựng trang: <code>${esc(String(err && err.message || err))}</code></div></div>`;
    toast('Trang gặp lỗi', 'error');
  }
  el('main').focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ controls */
function toggleRead(slug) {
  if (state.read.has(slug)) state.read.delete(slug);
  else state.read.add(slug);
  store.set(KEY.read, [...state.read]);

  const on = state.read.has(slug);
  for (const btn of document.querySelectorAll(`[data-read-toggle="${CSS.escape(slug)}"]`)) {
    btn.classList.toggle('done', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span').textContent = on ? 'Đã đánh dấu đọc' : 'Đánh dấu đã đọc';
  }
  if (on) delete state.positions[slug];
  store.set(KEY.pos, state.positions);
  refreshProgress();
  if (state.route?.name === 'part') renderPart(state.route.partId);
}

function stepLesson(delta) {
  const all = readable();
  const i = all.findIndex((a) => a.slug === state.route?.slug);
  const target = all[i + delta];
  if (target) navigate(lessonUrl(target.slug), render);
}

function navOpen() {
  return matchMedia('(max-width: 900px)').matches
    ? el('shell').classList.contains('nav-open')
    : !el('shell').classList.contains('nav-closed');
}

function setNav(open) {
  const shell = el('shell');
  if (matchMedia('(max-width: 900px)').matches) {
    shell.classList.toggle('nav-open', open);
    el('scrim').hidden = !open;
  } else {
    shell.classList.toggle('nav-closed', !open);
    store.set(KEY.nav, !open);
  }
  el('menuToggle').setAttribute('aria-expanded', String(open));
}

function bindListeners() {
  el('menuToggle').addEventListener('click', () => setNav(!navOpen()));
  el('scrim').addEventListener('click', () => setNav(false));
  el('sidebar').addEventListener('click', (e) => {
    if (e.target.closest('a') && matchMedia('(max-width: 900px)').matches) setNav(false);
  });

  el('searchTrigger').addEventListener('click', openSearch);
  el('searchOverlay').addEventListener('mousedown', (e) => { if (e.target === el('searchOverlay')) closeSearch(); });
  el('searchInput').addEventListener('input', (e) => scheduleSearch(e.target.value));
  el('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter') {
      const node = el('searchResults').querySelector('.hit.sel') || el('searchResults').querySelector('.hit');
      if (node) openHit(node);
    } else if (e.key === 'Escape') closeSearch();
  });
  el('searchResults').addEventListener('click', (e) => {
    const forget = e.target.closest('[data-forget]');
    if (forget) {
      state.recents = state.recents.filter((t) => t !== forget.dataset.forget);
      store.set(KEY.recent, state.recents);
      emptyQueryView();
      el('searchInput').focus();
      return;
    }
    const chip = e.target.closest('[data-term]');
    if (chip) {
      const input = el('searchInput');
      input.value = chip.dataset.term;
      input.focus();
      scheduleSearch(chip.dataset.term);
      return;
    }
    const hit = e.target.closest('.hit');
    if (hit) openHit(hit);
  });
  el('searchOverlay').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...el('searchPanel').querySelectorAll('input, button')].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  el('lightbox').addEventListener('click', (e) => { if (!e.target.closest('img')) closeLightbox(); });
  el('lightbox').addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); el('lbClose').focus(); } });
  el('lbClose').addEventListener('click', closeLightbox);

  addEventListener('hashchange', () => render());
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  addEventListener('beforeunload', () => {
    if (state.route?.name === 'read') remember(state.route.slug, readingRatio());
  });

  el('main').addEventListener('click', (e) => {
    const read = e.target.closest('[data-read-toggle]');
    if (read) { toggleRead(read.dataset.readToggle); return; }
    const inPage = e.target.closest('a[href^="#"]:not([href^="#/"])');
    if (inPage) {
      e.preventDefault();
      scrollToId(decodeURIComponent(inPage.getAttribute('href').slice(1)));
      return;
    }
    const img = e.target.closest('.prose figure img');
    if (img) {
      e.preventDefault();
      openLightbox(img);
    }
  });

  document.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (el('searchOverlay').hidden) openSearch(); else closeSearch();
      return;
    }
    if (e.key === 'Escape') {
      if (!el('lightbox').hidden) closeLightbox();
      else if (!el('searchOverlay').hidden) closeSearch();
      else if (el('shell').classList.contains('nav-open')) setNav(false);
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (typing || e.altKey) return;

    if (e.key === '/') { e.preventDefault(); openSearch(); return; }
    if (state.route?.name !== 'read') return;
    if (e.key === '[' || e.key === ']') { e.preventDefault(); stepLesson(e.key === ']' ? 1 : -1); }
    else if (e.key === 'Enter' && meta) { e.preventDefault(); toggleRead(state.route.slug); }
  });

  addEventListener('unhandledrejection', (e) => toast(String(e.reason && e.reason.message || e.reason || 'Lỗi không rõ'), 'error'));
}

/* ---------------------------------------------------------------- bootstrap */
async function boot() {
  initTheme();
  try {
    state.manifest = await json('data/manifest.json');
  } catch (err) {
    el('main').innerHTML = `<div class="wrap"><div class="notice">
      Trang cần chạy qua HTTP thì trình duyệt mới đọc được JSON: <code>node tools/serve.mjs</code> rồi mở <code>http://127.0.0.1:8080</code>.
      Chi tiết: <code>${esc(String(err && err.message || err))}</code></div></div>`;
    return;
  }
  for (const a of state.manifest.articles) state.bySlug.set(a.slug, a);
  for (const p of state.manifest.parts) state.partsById.set(p.id, p);

  buildSidebar();
  refreshProgress();
  if (store.get(KEY.nav, false)) setNav(false);
  bindListeners();

  await render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
