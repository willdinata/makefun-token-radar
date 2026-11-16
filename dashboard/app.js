// Token Radar — board, live comparables and the model, rendered from
// window.RADAR (data.js, written by main.ts from the sealed snapshot).
// No network, no libraries: everything below is the page's own code.
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function fmtUSD(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v;
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtAge(days) {
  if (days >= 730) return days + ' d (' + (days / 365).toFixed(1) + ' y)';
  return days + ' d';
}
function fmtAgeShort(days) {
  return days + ' d';
}
function fmtMult(x) {
  return x === null || x === undefined ? '—' : x.toFixed(4);
}

/* ---------- header ---------- */
$('meta').textContent =
  'Snapshot ' + R.as_of + ' · ' + R.source + ' · watchlist floor ' + fmtUSD(R.floor_usd);
for (const [n, label] of [
  [R.scanned, 'protocols scanned'],
  [R.board_size, 'pre-token ranked'],
  [R.watchlist_count + '/' + R.watchlist_count, 'watchlist covered'],
  [R.live_size, 'live tokens set aside'],
]) {
  const chip = el('span', null, 'chip');
  chip.append(el('b', String(n)), document.createTextNode(label));
  $('chips').append(chip);
}

/* ---------- tabs ---------- */
const views = { board: $('view-board'), live: $('view-live'), model: $('view-model') };
$('tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-view]');
  if (!btn) return;
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b === btn);
  for (const [name, section] of Object.entries(views)) section.hidden = name !== btn.dataset.view;
});

/* ---------- board ---------- */
const state = { sort: 'rank', dir: 1, q: '', cat: '', chain: '', watch: false, selected: null };

const catSel = $('f-cat');
for (const c of [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort()) {
  catSel.append(el('option', c));
}
const chainSel = $('f-chain');
for (const c of [...new Set(R.rows.flatMap((r) => r.chains))].sort()) {
  chainSel.append(el('option', c));
}
catSel.addEventListener('change', () => { state.cat = catSel.value; renderBoard(); });
chainSel.addEventListener('change', () => { state.chain = chainSel.value; renderBoard(); });
$('q').addEventListener('input', () => { state.q = $('q').value.trim().toLowerCase(); renderBoard(); });
$('f-watch').addEventListener('change', () => { state.watch = $('f-watch').checked; renderBoard(); });

document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
    if (key === 'rank') state.dir = 1;
    renderBoard();
  });
});

function sortValue(row, key) {
  if (key === 'ratio') return row.implied_value_usd / row.tvl_usd;
  if (key === 'name') return row.name.toLowerCase();
  if (key === 'category') return (row.category || '').toLowerCase();
  return row[key];
}

function visibleRows() {
  let rows = R.rows.filter((r) =>
    (!state.q || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    (!state.watch || r.watchlist));
  rows = [...rows].sort((a, b) => {
    const va = sortValue(a, state.sort);
    const vb = sortValue(b, state.sort);
    if (va === vb) return a.rank - b.rank;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va < vb ? -1 : 1) * state.dir;
  });
  return rows;
}

function renderBoard() {
  const rows = visibleRows();
  $('count').textContent = rows.length + ' of ' + R.rows.length + ' protocols';
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    const base = th.textContent.replace(/ [▲▼]$/, '');
    th.textContent = base;
    if (th.dataset.sort === state.sort) {
      const span = el('span', state.dir === 1 ? ' ▲' : ' ▼', 'dir');
      th.append(span);
    }
  });
  const body = $('board-body');
  body.replaceChildren();
  for (const r of rows) {
    const tr = el('tr');
    tr.tabIndex = 0;
    if (state.selected === r.slug) tr.className = 'sel';
    tr.append(el('td', String(r.rank), 'num'));
    const nameTd = el('td');
    nameTd.append(document.createTextNode(r.name));
    if (r.watchlist) nameTd.append(el('span', 'WL', 'wl'));
    nameTd.append(el('span', r.slug, 'slug'));
    tr.append(nameTd);
    tr.append(el('td', r.category || '—'));
    tr.append(el('td', r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '')));
    tr.append(el('td', fmtUSD(r.tvl_usd), 'num'));
    const pct = el('td', fmtPct(r.change_7d), 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''));
    tr.append(pct);
    tr.append(el('td', fmtAgeShort(r.age_days), 'num'));
    tr.append(el('td', fmtUSD(r.implied_value_usd), 'num'));
    tr.addEventListener('click', () => selectRow(r.slug));
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') selectRow(r.slug); });
    body.append(tr);
  }
}

function selectRow(slug) {
  state.selected = slug;
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  document.querySelectorAll('#board-body tr').forEach((tr) => tr.classList.remove('sel'));
  renderBoardSelection(slug);
  const d = $('detail');
  d.replaceChildren();
  d.append(el('h2', r.name));
  const sub = el('p', null, 'hint');
  sub.textContent = r.slug + (r.watchlist ? ' · on the house watchlist' : ' · found below the watchlist floor') +
    ' · records no token in the snapshot';
  d.append(sub);

  const dl = el('dl');
  const facts = [
    ['Category', r.category || '—'],
    ['Chains', r.chains.join(', ')],
    ['TVL', fmtUSD(r.tvl_usd)],
    ['TVL change, 7d', fmtPct(r.change_7d)],
    ['Tracked since', r.listed_at || '—'],
    ['Tokenless age', fmtAge(r.age_days)],
    ['Board rank', '#' + r.rank + ' of ' + R.rows.length],
  ];
  for (const [k, v] of facts) { dl.append(el('dt', k), el('dd', v)); }
  d.append(dl);

  d.append(el('h3', 'The model\'s arithmetic'));
  const arith = el('div', null, 'arith');
  const m = r.model;
  const lines = [
    'TVL ' + fmtUSD(r.tvl_usd),
    '× category multiple ' + fmtMult(m.category_multiple) +
      (m.peer_count > 0
        ? ' (' + (r.category || 'uncategorised') + ': median of ' + m.peer_count + ' tokenized ' + (m.peer_count === 1 ? 'peer' : 'peers') + ', shrunk)'
        : ' (global median — no tokenized peers in its category)'),
    '× growth factor ' + fmtMult(m.growth_multiplier) + ' (7d change ' + fmtPct(r.change_7d) + ')',
    '× tokenless-age factor ' + fmtMult(m.age_multiplier) + ' (' + r.age_days + ' days)',
    '× chain factor ' + fmtMult(m.chain_multiplier) + ' (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')',
  ];
  for (const line of lines) arith.append(el('div', line));
  const eq = el('div', '= implied value ' + fmtUSD(r.implied_value_usd), 'eq');
  arith.append(eq);
  const note = el('p', 'Factors shown rounded to 4 dp; the value is computed at full precision.', 'note');
  arith.append(note);
  d.append(arith);

  d.append(el('h3', 'Farm plan'));
  const ol = el('ol');
  for (const step of r.farm_steps) ol.append(el('li', step));
  d.append(ol);
  d.scrollIntoView({ block: 'nearest' });
}

function renderBoardSelection(slug) {
  const rows = [...$('board-body').children];
  const visible = visibleRows();
  rows.forEach((tr, i) => { if (visible[i] && visible[i].slug === slug) tr.classList.add('sel'); });
}

/* ---------- live tokens ---------- */
function renderLive() {
  const body = $('live-body');
  body.replaceChildren();
  for (const p of R.live) {
    const tr = el('tr');
    const nameTd = el('td');
    nameTd.append(document.createTextNode(p.name), el('span', p.slug, 'slug'));
    tr.append(nameTd);
    tr.append(el('td', p.category || '—'));
    tr.append(el('td', p.chains.slice(0, 2).join(', ') + (p.chains.length > 2 ? ' +' + (p.chains.length - 2) : '')));
    tr.append(el('td', fmtUSD(p.mcap_usd), 'num'));
    tr.append(el('td', fmtUSD(p.tvl_usd), 'num'));
    tr.append(el('td', fmtPct(p.change_7d), 'num ' + (p.change_7d > 0 ? 'pos' : p.change_7d < 0 ? 'neg' : '')));
    tr.append(el('td', fmtMult(p.mcap_tvl), 'num'));
    body.append(tr);
  }
}

/* ---------- the model ---------- */
function renderModel() {
  $('formula').textContent = R.formula;
  const c = R.constants;
  const chips = [
    ['shrinkage prior', c.shrinkage_prior + ' peers'],
    ['peer ratios capped', 'p' + c.winsorize_percentile + ' winsorized'],
    ['growth weight', c.growth_weight],
    ['growth clamp', c.growth_clamp[0] + '% … +' + c.growth_clamp[1] + '%'],
    ['age factor', c.age_floor + ' … ' + (c.age_floor + c.age_span) + ' over ' + c.age_cap_days + ' d'],
    ['chain step', '+' + c.chain_step + ' per extra chain (max ' + c.chain_cap + ')'],
  ];
  for (const [k, v] of chips) {
    const chip = el('span', null, 'chip');
    chip.append(el('b', String(v)), document.createTextNode(k));
    $('constants').append(chip);
  }
  const body = $('cat-body');
  body.replaceChildren();
  for (const row of R.categories) {
    const tr = el('tr');
    tr.append(el('td', row.category));
    tr.append(el('td', String(row.peers), 'num'));
    tr.append(el('td', fmtMult(row.median_multiple), 'num'));
    tr.append(el('td', fmtMult(row.used_multiple), 'num'));
    body.append(tr);
  }
}

renderBoard();
renderLive();
renderModel();
