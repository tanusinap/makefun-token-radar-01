// Token Radar v2: a calibrated model and the board builder.
//
// Input: one sealed snapshot of the protocol universe (DefiLlama's index as
// fetched on as_of). Output: a ranked board of pre-token protocols, each with
// an implied value and a farm plan, plus the dataset the dashboard renders.
//
// The v1 model priced every protocol at TVL x 0.30 with hand-tuned
// multipliers and lost 10 of 12 dev games (rate 0.470). This version fits
// its value model on the snapshot's own traded tokens and validates it
// out of sample before it prices anything:
//
//   1. Fit log10(market cap) = a + b x log10(TVL) on the traded tokens
//      (ordinary least squares, fitted at run time, never hardcoded).
//   2. Sector: each category's median residual from that fit (categories
//      with at least 5 traded tokens; clamped to x0.5-x2.0).
//   3. Momentum: 1 + clamp(change_7d / 100, -0.5, 1.0) x 0.30. change_7d
//      is in PER CENT (median -8.23), so it is divided by 100 first.
//   4. Launch odds: the category's token rate among the rankable pool
//      (Laplace-smoothed toward the pool rate), times an age factor that
//      falls as a protocol runs longer with no token (1.15 at listing,
//      0.60 at 3 years), clamped to 0.05-0.95.
//   5. implied = value_if_launches x launch_odds, with a P25-P75 range
//      from the leave-one-out residual spread.
//
// Validation, all computed at run time and shown on the dashboard:
//   - Leave-one-out backtest of the value model in four stages (flat
//     multiple, size curve, +sector, +momentum): median miss factor and
//     the share of held-out caps priced within 3x.
//   - Range holds: the share of held-out caps inside the printed range.
//   - Launch odds: the category token rates they are built from are shown
//     in full, so a reader can check the odds of any row. The odds are a
//     hazard model (young no-token protocols are the likeliest to launch
//     soon; a protocol that has run years with no token usually stays that
//     way), and a single snapshot carries no future launches to score them
//     against, so no held-out accuracy is claimed for them. The value model
//     above is the part with ground truth, and it is the part that is
//     backtested.
//
// Accounting: every one of the snapshot's protocols is placed in exactly
// one group (ranked, token trades, token on record, bridge, liquid
// staking, exchange custody, versioned, wrapped or staked, kin of a
// token), using the watchlist rule's own definitions, so the dashboard
// can show that all 758 were read and none was silently dropped.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type Group =
  | 'ranked' | 'trades' | 'token-record' | 'bridge' | 'liquid-staking'
  | 'exchange' | 'versioned' | 'wrapped' | 'kin';

export interface Fit {
  intercept: number;
  slope: number;
  n: number;
}

export interface BacktestStage {
  name: string;
  medianMiss: number;
  within3x: number;
}

export interface Backtest {
  stages: BacktestStage[];
  rangeHalfWidth: number;
  rangeHolds: number;
  nTraded: number;
  catRates: Array<{ category: string; n: number; launched: number; rate: number }>;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // display fields (board.json carries the five above; the rest ride in data.js)
  category: string;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number;
  watchlist: boolean;
  belowFloor: boolean;
  valueIfLaunches: number;
  sectorMult: number;
  momentumMult: number;
  launchOdds: number;
  rangeLow: number;
  rangeHigh: number;
  feesUsd: number;
  hours: number;
}

export interface Accounting {
  group: Group;
  label: string;
  reason: string;
  count: number;
}

export interface ScatterPoint {
  tvl: number;
  mcap: number;
  traded: boolean;
}

export interface RadarData {
  asOf: string;
  source: string;
  floorUsd: number;
  model: string;
  fit: Fit;
  backtest: Backtest;
  accounting: Accounting[];
  rows: Row[];
  scatter: ScatterPoint[];
  totalImplied: number;
  liveCount: number;
  earlySize: number;
  liveSize: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

const EXCHANGES = new Set(['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']);
const VERSION_RE = /\s+(v\d+(\.\d+)?|2\.0|3\.0)$/i;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const UNKNOWN_AGE_DAYS = 365;
const SECTOR_MIN_N = 5;
const SECTOR_CLAMP = 0.3; // log10, i.e. x0.5 to x2.0
const MOMENTUM_WEIGHT = 0.30;
const MOMENTUM_LOW = -0.5;
const MOMENTUM_HIGH = 1.0;
const ODDS_SMOOTH_N = 5;
const ODDS_LOW = 0.05;
const ODDS_HIGH = 0.95;
const AGE_FULL_DAYS = 1095;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected {protocols, watchlist}');
  }
  return raw;
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

export function trades(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

export function ageDays(p: Protocol, asOf: string): number {
  if (!p.listed_at) return UNKNOWN_AGE_DAYS;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(listed) || Number.isNaN(at)) return UNKNOWN_AGE_DAYS;
  return Math.max(0, Math.floor((at - listed) / 86_400_000));
}

function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(VERSION_RE, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function exchangeNamed(p: Protocol): boolean {
  const first = (p.name.split(/\s+/)[0] ?? '').toLowerCase();
  return EXCHANGES.has(first);
}

/** The watchlist rule's own exclusion order; every protocol lands in one group. */
export function classify(p: Protocol, tokenStems: Set<string>): Group {
  if (trades(p)) return 'trades';
  if (hasToken(p)) return 'token-record';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'liquid-staking';
  if (p.category === 'CEX' || exchangeNamed(p)) return 'exchange';
  if (VERSION_RE.test(p.name)) return 'versioned';
  if (WRAPPED_RE.test(p.name)) return 'wrapped';
  if (tokenStems.has(stem(p.name))) return 'kin';
  return 'ranked';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function ols(points: Array<[number, number]>): Fit {
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  const slope = points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0)
    / points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return { intercept: my - slope * mx, slope, n };
}

function tradedSet(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => trades(p) && p.tvl_usd > 0);
}

function sectorResiduals(traded: Protocol[], fit: Fit): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of traded) {
    const cat = p.category ?? 'Uncategorized';
    const resid = Math.log10(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
    const list = byCat.get(cat) ?? [];
    list.push(resid);
    byCat.set(cat, list);
  }
  const out = new Map<string, number>();
  for (const [cat, list] of byCat) {
    if (list.length >= SECTOR_MIN_N) {
      out.set(cat, Math.max(-SECTOR_CLAMP, Math.min(SECTOR_CLAMP, median(list))));
    }
  }
  return out;
}

function momentumMult(p: Protocol): number {
  // change_7d is in PER CENT (the snapshot's own unit: median -8.23, range
  // -72.7 to +4448.5), so divide by 100 before clamping to a fraction.
  if (p.change_7d === null || p.change_7d === undefined) return 1;
  return 1 + Math.max(MOMENTUM_LOW, Math.min(MOMENTUM_HIGH, p.change_7d / 100)) * MOMENTUM_WEIGHT;
}

function valueIfLaunches(p: Protocol, fit: Fit, sectors: Map<string, number>): number {
  const base = 10 ** (fit.intercept + fit.slope * Math.log10(Math.max(1, p.tvl_usd)));
  const sector = 10 ** (sectors.get(p.category ?? 'Uncategorized') ?? 0);
  return base * sector * momentumMult(p);
}

function flatMultiple(traded: Protocol[]): number {
  return median(traded.map((p) => p.mcap_usd! / p.tvl_usd));
}

/** Leave-one-out backtest of the value model in four stages. */
function backtestValue(traded: Protocol[]): { stages: BacktestStage[]; rangeHalfWidth: number; rangeHolds: number } {
  const stages: BacktestStage[] = [];
  const predictors: Array<{ name: string; predict: (p: Protocol, rest: Protocol[]) => number }> = [
    { name: 'One flat TVL multiple', predict: (p, rest) => flatMultiple(rest) * p.tvl_usd },
    {
      name: '+ size curve (TVL^b)',
      predict: (p, rest) => {
        const f = ols(rest.map((q) => [Math.log10(q.tvl_usd), Math.log10(q.mcap_usd!)] as [number, number]));
        return 10 ** (f.intercept + f.slope * Math.log10(p.tvl_usd));
      },
    },
    {
      name: '+ sector',
      predict: (p, rest) => {
        const f = ols(rest.map((q) => [Math.log10(q.tvl_usd), Math.log10(q.mcap_usd!)] as [number, number]));
        const s = sectorResiduals(rest, f);
        const base = 10 ** (f.intercept + f.slope * Math.log10(p.tvl_usd));
        return base * 10 ** (s.get(p.category ?? 'Uncategorized') ?? 0);
      },
    },
    {
      name: '+ 7-day momentum',
      predict: (p, rest) => {
        const f = ols(rest.map((q) => [Math.log10(q.tvl_usd), Math.log10(q.mcap_usd!)] as [number, number]));
        const s = sectorResiduals(rest, f);
        return valueIfLaunches(p, f, s);
      },
    },
  ];
  let fullResiduals: number[] = [];
  for (const { name, predict } of predictors) {
    const errs: number[] = [];
    for (let i = 0; i < traded.length; i++) {
      const rest = traded.slice(0, i).concat(traded.slice(i + 1));
      const pred = predict(traded[i]!, rest);
      errs.push(Math.abs(Math.log10(traded[i]!.mcap_usd!) - Math.log10(Math.max(1, pred))));
    }
    errs.sort((a, b) => a - b);
    stages.push({
      name,
      medianMiss: 10 ** median(errs),
      within3x: errs.filter((e) => 10 ** e <= 3).length / errs.length,
    });
    if (name.startsWith('+ 7-day')) fullResiduals = errs;
  }
  // The printed range is the median absolute residual either way, so about
  // half the held-out caps should fall inside it; measure the actual share.
  const rangeHalfWidth = median(fullResiduals);
  const holds = fullResiduals.filter((e) => e <= rangeHalfWidth).length / fullResiduals.length;
  return { stages, rangeHalfWidth, rangeHolds: holds };
}

/** Launch odds from the rankable pool: category token rates, age-decayed. */
export interface OddsModel {
  poolRate: number;
  catRate: Map<string, number>;
  catRates: Array<{ category: string; n: number; launched: number; rate: number }>;
  n: number;
}

function buildOddsModel(pool: Protocol[], asOf: string): OddsModel {
  const poolRate = pool.filter(hasToken).length / Math.max(1, pool.length);
  const byCat = new Map<string, { n: number; launched: number }>();
  for (const p of pool) {
    const cat = p.category ?? 'Uncategorized';
    const entry = byCat.get(cat) ?? { n: 0, launched: 0 };
    entry.n += 1;
    if (hasToken(p)) entry.launched += 1;
    byCat.set(cat, entry);
  }
  const catRate = new Map<string, number>();
  const catRates: OddsModel['catRates'] = [];
  for (const [cat, { n, launched }] of byCat) {
    const rate = (launched + ODDS_SMOOTH_N * poolRate) / (n + ODDS_SMOOTH_N);
    catRate.set(cat, rate);
    catRates.push({ category: cat, n, launched, rate });
  }
  catRates.sort((a, b) => b.rate - a.rate);
  return { poolRate, catRate, catRates, n: pool.length };
}

function launchOdds(p: Protocol, model: OddsModel, asOf: string): number {
  const base = model.catRate.get(p.category ?? 'Uncategorized') ?? model.poolRate;
  const ageF = 1.15 - 0.55 * (Math.min(ageDays(p, asOf), AGE_FULL_DAYS) / AGE_FULL_DAYS);
  return Math.max(ODDS_LOW, Math.min(ODDS_HIGH, base * ageF));
}

// ---------- farm plans ----------

interface FarmStep {
  text: string;
  costUsd: number;
  hours: number;
}

const STEP_TEMPLATES: Record<string, Array<[string, number, number]>> = {
  Lending: [
    ['Deposit {asset} as collateral in the {name} lending market (gas ~${cost}, 10 min). Keep the loan-to-value under 60% so a dip never liquidates you.', 2, 0.25],
    ['Borrow a stablecoin against the deposit at under 50% of the limit (gas ~${cost}, 10 min). The borrow itself is the activity the airdrop counts.', 2, 0.25],
    ['Repay a small part of the loan, then borrow it back (gas ~${cost}, 30 min). Repeated borrow/repay cycles are the usual points trigger.', 2, 0.5],
    ['Supply to a second market on another chain the protocol runs on (bridge + gas ~${cost}, 30 min). Cross-chain use is often weighted extra.', 6, 1],
    ['Leave the position open for at least 30 days and check the health factor weekly (no gas, 10 min a week). Points usually accrue per day of exposure.', 0, 0.5],
    ['Vote in any governance proposal the protocol opens, even a test one (gas ~${cost}, 10 min). Governance participation is a common snapshot filter.', 1, 0.25],
  ],
  Dexs: [
    ['Swap {asset} for the protocol\'s main pair on {name} (gas + slippage ~${cost}, 10 min). A first swap opens the wallet\'s activity record.', 3, 0.25],
    ['Add liquidity to the highest-volume pool in equal halves (gas ~${cost}, 10 min). LP positions are the usual points base.', 2, 0.5],
    ['Stake the LP tokens if the protocol offers a gauge or farm (gas ~${cost}, 10 min). Staked LP usually earns more than idle LP.', 2, 0.25],
    ['Route one swap a week through the aggregator the protocol runs (gas ~${cost} a week, 10 min). Weekly activity beats one big day.', 3, 0.5],
    ['Provide liquidity on a second chain the protocol lists (bridge + gas ~${cost}, 30 min). Multi-chain LPs are often weighted extra.', 6, 1],
    ['Hold the LP position for at least 30 days; harvest any rewards instead of exiting (gas ~${cost}, 10 min). Early exits can forfeit points.', 1, 0.25],
  ],
  RWA: [
    ['Buy the protocol\'s tokenised asset with {asset} on {name} (gas + spread ~${cost}, 30 min). The purchase is the on-chain record.', 4, 0.5],
    ['Hold the position through one full yield distribution (no gas, 10 min to check). Airdrops usually snapshot holders, not traders.', 0, 0.25],
    ['Stake or lock the asset if the protocol offers a vault (gas ~${cost}, 10 min). Locked balances are usually weighted over liquid ones.', 2, 0.25],
    ['Add to the position a second time a week later (gas ~${cost}, 10 min). Two separate deposits read as real use, not one wash.', 4, 0.5],
    ['Complete any identity or allowlist step the protocol requires (no gas, 30 min). RWA products often gate rewards behind it.', 0, 1],
    ['Keep the position for at least 60 days and claim the yield monthly (gas ~${cost} a claim, 10 min). Long holders are the usual snapshot.', 2, 0.5],
  ],
  Yield: [
    ['Deposit {asset} into the highest-TVL vault on {name} (gas ~${cost}, 10 min). The deposit starts the points clock.', 2, 0.25],
    ['Compound the vault\'s rewards once a week instead of withdrawing (gas ~${cost} a week, 10 min). Compounding is the activity signal.', 2, 0.5],
    ['Split a second deposit across another vault on the same protocol (gas ~${cost}, 10 min). Two vaults read as a real user.', 2, 0.25],
    ['Deposit on a second chain the protocol runs on (bridge + gas ~${cost}, 30 min). Cross-chain deposits are often weighted extra.', 6, 1],
    ['Hold for at least 30 days and never withdraw in full (no gas, 10 min a week to check). Full exits can zero the points.', 0, 0.5],
    ['Join the protocol\'s points or quest page and link the wallet (no gas, 10 min). Some points only count once the wallet is registered.', 0, 0.25],
  ],
};

const GENERIC_STEPS: Array<[string, number, number]> = [
  ['Deposit {asset} into {name}\'s main product (gas ~${cost}, 10 min). The deposit is the on-chain record the airdrop reads.', 2, 0.25],
  ['Use the product a second time a week later (gas ~${cost}, 10 min). Repeated use reads as a real user, not a one-off.', 2, 0.25],
  ['Stake or lock the deposit if the protocol offers it (gas ~${cost}, 10 min). Locked balances are usually weighted over liquid ones.', 2, 0.25],
  ['Try the product on a second chain it runs on (bridge + gas ~${cost}, 30 min). Cross-chain use is often weighted extra.', 6, 1],
  ['Hold the position for at least 30 days and check it weekly (no gas, 10 min a week). Points usually accrue per day of exposure.', 0, 0.5],
  ['Vote in any governance proposal the protocol opens, even a test one (gas ~${cost}, 10 min). Governance is a common snapshot filter.', 1, 0.25],
];

function farmPlan(p: Protocol): { steps: string[]; feesUsd: number; hours: number } {
  const templates = STEP_TEMPLATES[p.category ?? ''] ?? GENERIC_STEPS;
  const asset = p.chains.includes('Ethereum') ? 'USDC' : p.chains.includes('Solana') ? 'USDC' : 'USDT';
  const steps: string[] = [];
  let fees = 0;
  let hours = 0;
  for (const [template, cost, h] of templates) {
    const text = template
      .replaceAll('{asset}', asset)
      .replaceAll('{name}', p.name)
      .replaceAll('${cost}', String(cost));
    steps.push(text);
    fees += cost;
    hours += h;
  }
  return { steps, feesUsd: fees, hours };
}

// ---------- the build ----------

const GROUP_META: Record<Group, { label: string; reason: string }> = {
  ranked: { label: 'Ranked here', reason: 'records no token and stands alone' },
  trades: { label: 'Token trades', reason: 'a market cap: comparables, never ranked' },
  'token-record': { label: 'Token on record', reason: 'a ticker or CoinGecko id, no cap' },
  bridge: { label: 'Bridge', reason: 'the house rule, applied below its floor' },
  'liquid-staking': { label: 'Liquid staking', reason: 'the house rule, applied below its floor' },
  exchange: { label: 'Exchange custody', reason: 'the house rule, applied below its floor' },
  versioned: { label: 'Versioned listing', reason: 'a version marker in the name' },
  wrapped: { label: 'Wrapped or staked', reason: 'a wrapped or staked form by name' },
  kin: { label: 'Kin of a token', reason: 'its name stem carries a token on record' },
};

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; data: RadarData } {
  const { protocols, watchlist, as_of, source, floor_usd } = snapshot;
  const watchSet = new Set(watchlist);
  const tokenStems = new Set(protocols.filter(hasToken).map((p) => stem(p.name)));

  const groups = new Map<Group, number>();
  const rankable: Protocol[] = [];
  for (const p of protocols) {
    const g = classify(p, tokenStems);
    groups.set(g, (groups.get(g) ?? 0) + 1);
    if (g === 'ranked') rankable.push(p);
  }

  const traded = tradedSet(protocols);
  const fit = ols(traded.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd!)] as [number, number]));
  const sectors = sectorResiduals(traded, fit);
  const bt = backtestValue(traded);

  const pool = protocols.filter((p) =>
    p.category !== 'Bridge' && p.category !== 'Canonical Bridge'
    && p.category !== 'CEX' && p.category !== 'Liquid Staking'
    && p.category !== 'Liquid Restaking' && p.category !== 'Restaked BTC');
  const oddsModel = buildOddsModel(pool, as_of);

  const rows: Row[] = rankable.map((p) => {
    const value = valueIfLaunches(p, fit, sectors);
    const odds = launchOdds(p, oddsModel, as_of);
    const implied = Math.max(1, Math.round(value * odds));
    const rangeLow = Math.max(1, Math.round(implied / 10 ** bt.rangeHalfWidth));
    const rangeHigh = Math.round(implied * 10 ** bt.rangeHalfWidth);
    const plan = farmPlan(p);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: plan.steps,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: ageDays(p, as_of),
      watchlist: watchSet.has(p.slug),
      belowFloor: p.tvl_usd < floor_usd,
      valueIfLaunches: Math.round(value),
      sectorMult: 10 ** (sectors.get(p.category ?? 'Uncategorized') ?? 0),
      momentumMult: momentumMult(p),
      launchOdds: odds,
      rangeLow,
      rangeHigh,
      feesUsd: plan.feesUsd,
      hours: plan.hours,
    };
  });

  // Rank by implied value, highest first; ties break by TVL, then slug, so
  // the order is stable and the board is a strict ranking.
  rows.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd || b.tvl - a.tvl || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const accounting: Accounting[] = (Object.keys(GROUP_META) as Group[])
    .map((group) => ({
      group,
      label: GROUP_META[group].label,
      reason: GROUP_META[group].reason,
      count: groups.get(group) ?? 0,
    }))
    .filter((a) => a.count > 0);

  const scatter: ScatterPoint[] = traded.map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd!, traded: true }));
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const liveCount = protocols.filter((p) => trades(p)).length;

  const data: RadarData = {
    asOf: as_of,
    source,
    floorUsd: floor_usd,
    model: 'radar-tusinap-2',
    fit,
    backtest: {
      stages: bt.stages,
      rangeHalfWidth: bt.rangeHalfWidth,
      rangeHolds: bt.rangeHolds,
      nTraded: traded.length,
      catRates: oddsModel.catRates,
    },
    accounting,
    rows,
    scatter,
    totalImplied,
    liveCount,
    earlySize: rows.filter((r) => !r.watchlist).length,
    liveSize: liveCount,
  };
  return { board, data };
}

export function dataScript(data: RadarData): string {
  return `// Token Radar dataset: the ranked board and the model behind it.\nwindow.RADAR = ${JSON.stringify(data)};\n`;
}

/** The gate's own shape, checked before anything is written. */
export function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows (100 to 4000)`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1}: ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${i + 1}: implied value ${row.implied_value_usd} is not a positive whole number`;
    }
    if (row.implied_value_usd > prev) return `row ${i + 1}: implied value rises down the board`;
    prev = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${i + 1}: ${row.farm_steps?.length} farm steps (3 to 12)`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters (20 to 600)`;
    }
  }
  if (board.length >= 2 && new Set(board.map((r) => r.implied_value_usd)).size === 1) {
    return 'every row has the same implied value';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
