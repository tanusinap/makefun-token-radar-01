// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable and sortable table,
// a per-protocol detail drawer with the model's own inputs and the farm plan,
// and the live-token set apart. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function growthClass(n) {
    if (n == null || !isFinite(n)) return '';
    return n >= 0 ? 'pos' : 'neg';
  }

  // The model, recomputed in the page from the snapshot figures, so the page's
  // arithmetic and board.json's numbers are visibly the same function.
  function impliedOf(row, m) {
    var g = row.change_7d == null ? 0 : row.change_7d;
    g = Math.min(m.growthHigh, Math.max(m.growthLow, g));
    var growthMult = 1 + (g / 100) * m.growthWeight;
    var age = row.age_days == null ? m.unknownAgeDays : row.age_days;
    var maturity = m.maturityBase + (Math.min(Math.max(age, 0), m.maturityDays) / m.maturityDays) * m.maturitySpan;
    var breadth = 1 + m.breadthPerChain * Math.min((row.chains || []).length, m.breadthMaxChains);
    return Math.max(1, Math.round(row.tvl_usd * m.baseMultiple * growthMult * maturity * breadth));
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the ticket, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function ticketFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age == null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function coreAction(p, ticket, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return 'Supply $' + ticket + ' of USDC to ' + name + ' on ' + chain + ' and leave the deposit untouched';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0)
      return 'Add $' + ticket + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the LP position';
    if (c.indexOf('yield') >= 0)
      return 'Deposit $' + ticket + " into " + name + "'s highest-TVL vault on " + chain + ' and hold the receipt token';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0)
      return 'Bridge $' + ticket + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds inside its app';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0)
      return 'Stake $' + ticket + ' of the native staking asset through ' + name + ' and hold the liquid receipt token';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0)
      return 'Post $' + ticket + ' of USDC as margin on ' + name + ' and open one small hedged position';
    if (c.indexOf('prediction') >= 0)
      return 'Fund ' + name + ' with $' + ticket + ' and take one position in its most liquid market';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0)
      return 'Deposit $' + ticket + ' into a ' + name + ' vault on ' + chain + ' and hold the shares';
    if (c.indexOf('stablecoin') >= 0)
      return 'Mint or hold $' + ticket + " of " + name + "'s stable asset on " + chain;
    if (c.indexOf('rwa') >= 0)
      return 'Mint $' + ticket + " of " + name + "'s tokenised yield asset on " + chain + ' and hold it';
    if (c.indexOf('insurance') >= 0)
      return 'Buy $' + ticket + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active';
    if (c.indexOf('staking') >= 0)
      return 'Stake $' + ticket + ' through ' + name + ' on ' + chain + ' and keep the staking receipt';
    if (c.indexOf('launchpad') >= 0)
      return 'Stake $' + ticket + " in " + name + "'s launch pool on " + chain + ' and join one sale';
    return 'Deposit $' + ticket + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open';
  }
  function stepText(step) {
    var action = /[.!?]$/.test(step.action) ? step.action : step.action + '.';
    var s = action + ' Cost: ' + step.cost + '. Time: ' + step.duration + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Keep the position open and check the protocol's own page.";
    return s;
  }
  function planFor(p) {
    var chain = chainOf(p);
    var ticket = ticketFor(p);
    var hold = holdFor(p.age_days);
    var gas = ticket >= 150 ? 8 : 4;
    return [
      { action: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline', cost: 'under $3 of gas for the first transaction', duration: '5 minutes' },
      { action: coreAction(p, ticket, chain), cost: '$' + ticket + ' of capital plus about $' + gas + ' of gas', duration: '15 minutes to set up' },
      { action: 'Do one qualifying action every week, a deposit, a borrow, a swap or a governance vote', cost: 'about $2 of gas a week', duration: '10 minutes a week' },
      { action: 'Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot', cost: 'the $' + ticket + ' stays in the position', duration: hold + ' days' },
      { action: "Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes", cost: 'nothing to check, and never pay anyone to claim', duration: '10 minutes' },
      { action: 'Log the wallet, the dates and every transaction so you can repeat the position or unwind it cleanly', cost: 'nothing but the log', duration: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d == null ? -Infinity : a.change_7d; bv = b.change_7d == null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days == null ? Infinity : a.age_days; bv = b.age_days == null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderHero() {
    document.getElementById('top-meta').innerHTML =
      '<span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(DATA.model_version) + ' model</span>';
    document.getElementById('hero-title').textContent =
      DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('hero-lede').textContent =
      'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) +
      'M of TVL and no token on record. The early radar adds ' + DATA.early_size +
      ' pre-token protocols below that floor. Implied value is a model, not a promise.';
    document.getElementById('stats').innerHTML =
      '<div class="stat"><span>Watchlist covered</span><b><em>' + DATA.watchlist_size + '</em> / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token set aside</span><b>' + DATA.live_size + '</b></div>';
    document.getElementById('foot-date').textContent = DATA.as_of;
  }

  function renderCategories() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var sel = document.getElementById('cat');
    sel.innerHTML = '<option value="all">All categories</option>' +
      cats.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
  }

  function boardHtml() {
    var list = sortedRows(filteredRows());
    var max = list.length ? list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1) : 1;
    var head = '<div class="table-scroll"><table><caption>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr><th class="num">Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th><th>Token</th></tr></thead><tbody>';
    var body = list.map(function (r) {
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      var w = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr tabindex="0" data-slug="' + esc(r.slug) + '" aria-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="pname"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td><div class="vbar"><span class="track" aria-hidden="true"><i class="fill" style="width:' + w + '%"></i></span><span class="num">' + money(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="pill pre">no token</span></td></tr>';
    }).join('');
    return head + body + '</tbody></table></div>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (r) {
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      return '<tr><td class="num rank">live</td>' +
        '<td><div class="pname"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td><span class="pill live">already trades</span></td></tr>';
    }).join('');
    return '<div class="table-scroll"><table><caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th class="num">Status</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th>Token</th></tr></thead><tbody>' +
      body + '</tbody></table></div>';
  }

  function emptyHtml() {
    return '<div class="empty"><h2>No protocol matches that filter</h2>' +
      '<p>Clear the search or pick another category to see the board again.</p>' +
      '<button class="btn" type="button" id="clear-filters">Clear filters</button></div>';
  }

  function renderModel() {
    var m = DATA.model;
    document.getElementById('model-panel').innerHTML =
      '<h2>How implied value is computed</h2>' +
      '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd x ' + m.baseMultiple +
      ' x (1 + clamp(change_7d, ' + m.growthLow + ', ' + m.growthHigh + ') / 100 x ' + m.growthWeight +
      ') x (' + m.maturityBase + ' + min(age_days, ' + m.maturityDays + ') / ' + m.maturityDays + ' x ' + m.maturitySpan +
      ') x (1 + ' + m.breadthPerChain + ' x min(chains, ' + m.breadthMaxChains + ')) )</div>' +
      '<dl>' +
      '<dt>TVL</dt><dd>The size of the business. A protocol with more value locked is worth more if it ever issues a token.</dd>' +
      '<dt>Seven-day growth</dt><dd>Direction, clamped so one wild week cannot dominate. Missing growth counts as zero.</dd>' +
      '<dt>Age with no token</dt><dd>Time since first listing: how long the launch has been waited for. Unknown age uses ' + m.unknownAgeDays + ' days.</dd>' +
      '<dt>Chain breadth</dt><dd>How widely the protocol is already distributed. Each chain adds 3%, up to five chains.</dd>' +
      '</dl>';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var drawer = document.getElementById('drawer');
    var scrim = document.getElementById('scrim');
    var recomputed = impliedOf(row, DATA.model);
    var chains = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    var steps = planFor(row);
    drawer.innerHTML =
      '<button class="close-x" type="button" id="drawer-close" aria-label="Close details">Close</button>' +
      '<div class="kick">Rank ' + row.rank + ' of ' + DATA.board_size + '</div>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(chains) + '</p>' +
      '<h3>Implied value</h3>' +
      '<div class="facts-grid">' +
      '<div><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + ageLabel(row.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + (row.chains ? row.chains.length : 0) + '</b></div>' +
      '<div><span>Growth multiplier</span><b>' + row.growth_multiplier + '</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + row.maturity_multiplier + '</b></div>' +
      '<div><span>Breadth multiplier</span><b>' + row.breadth_multiplier + '</b></div>' +
      '<div><span>Implied value</span><b class="big">' + money(row.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<p class="note">Model ' + esc(DATA.model_version) + ': the same function scores every protocol. ' +
      'The page recomputes this row as ' + money(recomputed) +
      (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return '<li><b>' + esc(action) + '</b><span>' + esc(tail) + '</span></li>';
      }).join('') + '</ol>';
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    document.getElementById('drawer-close').addEventListener('click', closeDetail);
    renderBoard();
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    var drawer = document.getElementById('drawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.getElementById('scrim').hidden = true;
    renderBoard();
  }

  function renderBoard() {
    var panel = document.getElementById('board-panel');
    var count = document.getElementById('count');
    if (state.tab === 'live') {
      panel.innerHTML = liveHtml();
      count.textContent = DATA.live.length + ' live-token protocols';
    } else {
      var list = filteredRows();
      panel.innerHTML = list.length ? boardHtml() : emptyHtml();
      count.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
      var clear = document.getElementById('clear-filters');
      if (clear) clear.addEventListener('click', function () {
        state.q = ''; state.category = 'all';
        document.getElementById('q').value = '';
        renderCategories(); writeHash(); renderBoard();
      });
      panel.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
        tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
        tr.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
        });
      });
    }
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function init() {
    readHash();
    renderHero();
    renderCategories();
    renderModel();
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderBoard(); });
    document.getElementById('cat').addEventListener('change', function (e) {
      state.category = e.target.value; writeHash(); renderBoard();
    });
    var sortSel = document.getElementById('sort');
    sortSel.value = state.sort;
    sortSel.addEventListener('change', function () {
      if (state.sort === sortSel.value) state.dir = -state.dir;
      else { state.sort = sortSel.value; state.dir = -1; }
      renderBoard();
    });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); renderBoard(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); renderBoard(); });
    document.getElementById('scrim').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.selected) closeDetail();
    });
    renderBoard();
    if (state.selected) openDetail(state.selected);
  }

  init();
})();
