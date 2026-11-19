// Token Radar's dashboard v2. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, the model's own
// validation, the full accounting of the snapshot, a filterable and
// sortable table, and a per-protocol detail drawer with the model's
// breakdown and the farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', chain: 'all', tab: 'all', sort: 'implied_value_usd', dir: -1, selected: null, plan: 1000, drop: 0.07 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function money2(n) {
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  }
  function pct(x, digits) {
    return (x * 100).toFixed(digits == null ? 0 : digits) + '%';
  }
  function ageText(days) {
    if (days < 30) return days + ' d';
    if (days < 365) return (days / 30).toFixed(0) + ' mo';
    return (days / 365).toFixed(1) + ' y';
  }
  function econ(r) {
    var slice = r.implied_value_usd * state.drop * (state.plan / r.tvl);
    var net = slice - r.feesUsd;
    var perHour = r.hours > 0 ? net / r.hours : 0;
    var verdict = (net >= 10 && perHour >= 2) ? 'FARM' : (net > 0 ? 'MARGINAL' : 'SKIP');
    return { slice: slice, net: net, perHour: perHour, verdict: verdict };
  }

  var rows = DATA.rows;
  var econCache = {};
  function getEcon(r) {
    var key = r.slug + '|' + state.plan + '|' + state.drop;
    if (!econCache[key]) econCache[key] = econ(r);
    return econCache[key];
  }

  function verdictCounts() {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    rows.forEach(function (r) { c[getEcon(r).verdict]++; });
    return c;
  }

  function renderStats() {
    var vc = verdictCounts();
    var best = null;
    rows.forEach(function (r) {
      var e = getEcon(r);
      if (!best || e.perHour > best.e.perHour) best = { r: r, e: e };
    });
    var bt = DATA.backtest;
    var last = bt.stages[bt.stages.length - 1];
    var total = DATA.totalImplied;
    document.getElementById('stats').innerHTML = [
      stat('Ranked', rows.length, 'protocols that record no token &middot; 40 of 40 watchlist'),
      stat('Implied value', money(total), 'summed over the board &middot; rank 1 ' + money(rows[0].implied_value_usd), 'amber'),
      stat('Value miss, held out', '&times;' + last.medianMiss.toFixed(2), 'leave-one-out on ' + bt.nTraded + ' traded tokens &middot; ' + pct(last.within3x) + ' priced within 3&times;'),
      stat('Range holds', pct(bt.rangeHolds), 'of held-out caps inside the printed P25&ndash;P75 range (50% if exact)'),
      stat('Worth farming', vc.FARM + ' FARM', vc.MARGINAL + ' marginal &middot; ' + vc.SKIP + ' skip on $' + state.plan.toLocaleString(), 'teal'),
      stat('Best per hour', '+' + money2(best.e.perHour).slice(1) + '/h', esc(best.r.name) + ' &middot; net ' + money2(best.e.net)),
    ].join('');
  }
  function stat(k, v, s, cls) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="s">' + s + '</div></div>';
  }

  var GROUP_COLORS = { ranked: '#2dd4bf', trades: '#64748b', 'token-record': '#475569', bridge: '#f5b942', 'liquid-staking': '#38bdf8', exchange: '#f87171', versioned: '#c084fc', wrapped: '#fb923c', kin: '#94a3b8' };
  function renderLedger() {
    var total = DATA.accounting.reduce(function (s, a) { return s + a.count; }, 0);
    var bar = DATA.accounting.map(function (a) {
      return '<div style="width:' + (a.count / total * 100) + '%;background:' + (GROUP_COLORS[a.group] || '#888') + '" title="' + esc(a.label) + ' ' + a.count + '"></div>';
    }).join('');
    var keys = DATA.accounting.map(function (a) {
      return '<span><span class="sw" style="background:' + (GROUP_COLORS[a.group] || '#888') + '"></span><b>' + a.count + '</b> ' + esc(a.label.toLowerCase()) + ' &middot; ' + esc(a.reason) + '</span>';
    }).join('');
    document.getElementById('ledger').innerHTML =
      '<div><b>' + total + ' protocols read</b> &middot; ' + rows.length + ' ranked and ' + (total - rows.length) + ' set aside, each group for one reason</div>' +
      '<div class="bar">' + bar + '</div><div class="keys">' + keys + '</div>';
  }

  function renderMethod() {
    var f = DATA.fit, bt = DATA.backtest;
    var rowsHtml = bt.stages.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td class="num">&times;' + s.medianMiss.toFixed(2) + '</td><td class="num">' + pct(s.within3x) + '</td></tr>';
    }).join('');
    document.getElementById('how-priced').innerHTML =
      '<h2>How a launch is priced</h2>' +
      '<div class="formula">implied = 10^' + f.intercept.toFixed(2) + ' &times; TVL^' + f.slope.toFixed(3) + ' &times; sector &times; momentum &times; launch odds</div>' +
      '<table class="mini"><tr><th>Backtest, leave-one-out on ' + bt.nTraded + ' traded tokens</th><th class="num">Median miss</th><th class="num">Within 3&times;</th></tr>' + rowsHtml + '</table>' +
      '<p class="note">Each traded token is priced from the other ' + (bt.nTraded - 1) + ', never from itself. The range on every row is the median miss either way (&times;' + Math.pow(10, bt.rangeHalfWidth).toFixed(2) + '), and <b>' + pct(bt.rangeHolds) + '</b> of held-out caps fall inside it. Launch odds come from the category\'s token rate among the rankable pool, falling with age: a protocol that has run years with no token usually stays that way.</p>';
    document.getElementById('scatter-note').innerHTML =
      'Each dot is one of the ' + bt.nTraded + ' traded tokens: market cap against TVL, log scales. The line is the fitted size curve. Board rows sit below it, at their implied value times their launch odds.';
    renderScatter();
  }

  function renderScatter() {
    var W = 520, H = 290, padL = 46, padB = 30, padT = 10, padR = 10;
    var x0 = 6, x1 = 11, y0 = 5, y1 = 12; // log10 ranges: TVL 1e6-1e11, mcap 1e5-1e12
    function X(v) { return padL + (Math.log10(v) - x0) / (x1 - x0) * (W - padL - padR); }
    function Y(v) { return H - padB - (Math.log10(v) - y0) / (y1 - y0) * (H - padB - padT); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of market cap against TVL">';
    for (var gx = 6; gx <= 11; gx++) {
      s += '<line x1="' + X(Math.pow(10, gx)) + '" y1="' + (H - padB) + '" x2="' + X(Math.pow(10, gx)) + '" y2="' + padT + '" stroke="#24365a" stroke-width="1"/>';
      var anchor = gx === 11 ? 'end' : 'middle';
      s += '<text x="' + X(Math.pow(10, gx)) + '" y="' + (H - 8) + '" fill="#6b7d99" font-size="10" text-anchor="' + anchor + '">$1e' + gx + '</text>';
    }
    for (var gy = 5; gy <= 12; gy += 2) {
      s += '<line x1="' + padL + '" y1="' + Y(Math.pow(10, gy)) + '" x2="' + (W - padR) + '" y2="' + Y(Math.pow(10, gy)) + '" stroke="#24365a" stroke-width="1"/>';
      s += '<text x="' + (padL - 6) + '" y="' + (Y(Math.pow(10, gy)) + 3) + '" fill="#6b7d99" font-size="10" text-anchor="end">$1e' + gy + '</text>';
    }
    var f = DATA.fit;
    var xA = Math.pow(10, 6), xB = Math.pow(10, 11);
    s += '<line x1="' + X(xA) + '" y1="' + Y(Math.pow(10, f.intercept + f.slope * 6)) + '" x2="' + X(xB) + '" y2="' + Y(Math.pow(10, f.intercept + f.slope * 11)) + '" stroke="#f5b942" stroke-width="2"/>';
    DATA.scatter.forEach(function (p) {
      s += '<circle cx="' + X(p.tvl).toFixed(1) + '" cy="' + Y(p.mcap).toFixed(1) + '" r="2.6" fill="#2dd4bf" opacity="0.85"/>';
    });
    rows.forEach(function (r) {
      s += '<circle cx="' + X(r.tvl).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="1.8" fill="#94a3b8" opacity="0.45"/>';
    });
    s += '<text x="' + (W - padR) + '" y="' + (padT + 10) + '" fill="#f5b942" font-size="11" text-anchor="end">fitted curve</text>';
    s += '<text x="' + (W - padR) + '" y="' + (padT + 26) + '" fill="#2dd4bf" font-size="11" text-anchor="end">traded tokens</text>';
    s += '<text x="' + (W - padR) + '" y="' + (padT + 42) + '" fill="#94a3b8" font-size="11" text-anchor="end">board rows</text>';
    s += '</svg>';
    document.getElementById('scatter').innerHTML = s;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.tab === 'watchlist' && !r.watchlist) return false;
      if (state.tab === 'offlist' && (r.watchlist || r.belowFloor)) return false;
      if (state.tab === 'below' && !r.belowFloor) return false;
      if (state.tab === 'farm' && getEcon(r).verdict !== 'FARM') return false;
      if (state.tab === 'marginal' && getEcon(r).verdict !== 'MARGINAL') return false;
      if (state.tab === 'skip' && getEcon(r).verdict !== 'SKIP') return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort, d = state.dir, va, vb;
      if (k === 'slice' || k === 'net') { va = getEcon(a)[k]; vb = getEcon(b)[k]; }
      else if (k === 'verdict') { va = getEcon(a).verdict; vb = getEcon(b).verdict; }
      else if (k === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else { va = a[k]; vb = b[k]; }
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * d;
    });
  }

  function renderTabs() {
    var vc = verdictCounts();
    var wl = rows.filter(function (r) { return r.watchlist; }).length;
    var off = rows.filter(function (r) { return !r.watchlist && !r.belowFloor; }).length;
    var below = rows.filter(function (r) { return r.belowFloor; }).length;
    var tabs = [
      ['all', 'All', rows.length], ['watchlist', 'Watchlist', wl], ['offlist', 'Off list', off],
      ['below', 'Below floor', below], ['farm', 'Farm', vc.FARM], ['marginal', 'Marginal', vc.MARGINAL], ['skip', 'Skip', vc.SKIP],
    ];
    document.getElementById('tabs').innerHTML = tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '">' + t[1] + ' <b>' + t[2] + '</b></button>';
    }).join('');
  }

  var SORT_LABELS = { rank: 'rank', name: 'name', tvl: 'TVL', change7d: '7-day change', ageDays: 'time with no token', launchOdds: 'launch odds', implied_value_usd: 'implied value', slice: 'airdrop slice', net: 'net of fees', verdict: 'verdict' };
  function renderTable() {
    var list = filtered();
    var total = list.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    document.getElementById('board-summary').innerHTML =
      '<b>' + list.length + ' of ' + rows.length + ' protocols</b> &middot; ' + money(total) + ' implied in view &middot; sorted by ' + (SORT_LABELS[state.sort] || state.sort) + ', ' + (state.dir < 0 ? 'high to low' : 'low to high');
    document.getElementById('rows').innerHTML = list.map(function (r) {
      var e = getEcon(r);
      var ch = r.change7d == null ? '<span style="color:var(--faint)">n/a</span>'
        : '<span class="' + (r.change7d >= 0 ? 'up' : 'down') + '">' + (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '%</span>';
      var vcls = e.verdict.toLowerCase();
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
        '<div class="sub">' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td class="num">' + money(r.tvl) + '</td><td class="num">' + ch + '</td>' +
        '<td class="num">' + ageText(r.ageDays) + '</td>' +
        '<td class="num"><span class="oddsbar"><i style="width:' + Math.round(r.launchOdds * 100) + '%"></i></span>' + pct(r.launchOdds) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b><div class="range">' + money(r.rangeLow) + ' &ndash; ' + money(r.rangeHigh) + '</div></td>' +
        '<td class="num">' + money2(e.slice) + '</td>' +
        '<td class="num"><span class="' + (e.net >= 0 ? 'up' : 'down') + '">' + money2(e.net) + '</span><div class="range">' + money2(e.perHour) + '/h</div></td>' +
        '<td><span class="verdict ' + vcls + '">' + e.verdict + '</span></td>' +
        '<td><span class="plan">6 steps &middot; $' + r.feesUsd + ' &middot; ' + r.hours + ' h</span><span class="plan-first">' + esc(r.farm_steps[0].slice(0, 48)) + '&hellip;</span></td></tr>';
    }).join('');
  }

  function openDrawer(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.selected = slug;
    var e = getEcon(r);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    document.getElementById('drawer-in').innerHTML =
      '<button class="close" id="drawer-close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub" style="color:var(--muted)">' + esc(r.category) + ' &middot; ' + esc(r.chains.join(', ')) + ' &middot; rank #' + r.rank + (r.watchlist ? ' &middot; watchlist' : '') + '</div>' +
      '<h3>How this row is priced</h3><table class="kv">' +
      kv('TVL', money(r.tvl)) +
      kv('7-day change', r.change7d == null ? 'not reported' : ((r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '%')) +
      kv('No token for', ageText(r.ageDays) + ' (' + r.ageDays + ' days)') +
      kv('Fitted value (size curve)', money(r.valueIfLaunches / r.sectorMult / r.momentumMult)) +
      kv('Sector multiplier', '&times;' + r.sectorMult.toFixed(2) + ' (' + esc(r.category) + ')') +
      kv('Momentum multiplier', '&times;' + r.momentumMult.toFixed(2)) +
      kv('Value if it launches', money(r.valueIfLaunches)) +
      kv('Launch odds', pct(r.launchOdds)) +
      kv('Implied value', '<b>' + money(r.implied_value_usd) + '</b>') +
      kv('Range (P25&ndash;P75)', money(r.rangeLow) + ' &ndash; ' + money(r.rangeHigh)) +
      '</table>' +
      '<h3>Farm plan &middot; $' + r.feesUsd + ' fees &middot; ' + r.hours + ' h</h3><ol class="steps">' + steps + '</ol>' +
      '<h3>Economics at $' + state.plan.toLocaleString() + ' and ' + pct(state.drop) + ' drop share</h3>' +
      '<div class="econ">Airdrop slice <b>' + money2(e.slice) + '</b><br>Fees <b>' + money2(r.feesUsd) + '</b> &middot; ' + r.hours + ' h<br>Net <b>' + money2(e.net) + '</b> (' + money2(e.perHour) + '/h)<br>Verdict <span class="verdict ' + e.verdict.toLowerCase() + '">' + e.verdict + '</span></div>';
    var d = document.getElementById('drawer');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  }
  function kv(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
  function closeDrawer() {
    state.selected = null;
    var d = document.getElementById('drawer');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  }

  function renderAll() {
    econCache = {};
    renderStats();
    renderTabs();
    renderTable();
  }

  // top meta
  var totalRead = DATA.accounting.reduce(function (s, a) { return s + a.count; }, 0);
  document.getElementById('top-meta').innerHTML =
    'snapshot ' + esc(DATA.asOf) + ' &middot; ' + esc(DATA.source) + ' &middot; model ' + esc(DATA.model) + ' &middot; ' + totalRead + ' protocols read &middot; no network, no hand-picked names';

  // selects
  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  document.getElementById('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  var chains = [];
  rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  chains.sort();
  document.getElementById('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  renderLedger();
  renderMethod();
  renderAll();

  document.getElementById('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.getAttribute('data-tab');
    renderTabs();
    renderTable();
  });
  document.getElementById('plan-size').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-v]');
    if (!b) return;
    state.plan = Number(b.getAttribute('data-v'));
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderAll();
    if (state.selected) openDrawer(state.selected);
  });
  document.getElementById('drop-share').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-v]');
    if (!b) return;
    state.drop = Number(b.getAttribute('data-v'));
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderAll();
    if (state.selected) openDrawer(state.selected);
  });
  document.getElementById('q').addEventListener('input', function () { state.q = this.value; renderTable(); });
  document.getElementById('cat').addEventListener('change', function () { state.category = this.value; renderTable(); });
  document.getElementById('chain').addEventListener('change', function () { state.chain = this.value; renderTable(); });
  document.getElementById('reset').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'all';
    document.getElementById('q').value = '';
    document.getElementById('cat').value = 'all';
    document.getElementById('chain').value = 'all';
    renderTabs();
    renderTable();
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = (k === 'name' || k === 'verdict') ? 1 : -1; }
      renderTable();
    });
  });
  document.getElementById('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDrawer(tr.getAttribute('data-slug'));
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDrawer(); });
})();
