// Token Radar: the model and the board builder.
//
// Input: one sealed snapshot of the protocol universe (DefiLlama's index as
// fetched on as_of). Output: a ranked board of pre-token protocols, each with
// an implied value and a farm plan, plus the compact dataset the dashboard
// renders and the live-token set kept apart from the ranking.
//
// A protocol is pre-token when its snapshot record carries no token at all:
// no market cap, no CoinGecko id, no symbol. The board ranks every watchlist
// slug (the floor) and adds the strongest pre-token protocols below the floor
// by TVL (the early radar). Live-token protocols are never ranked: their
// market cap is a fact, and the board shows it as one.
//
// Implied value follows only from the snapshot's own figures. No protocol
// name is ever special-cased; one function scores every row:
//
//   base     = tvl_usd x 0.30
//   growth   = clamp(change_7d, -50, +100) per cent
//   growth   = 1 + (growth / 100) x 0.60
//   maturity = 0.55 + min(age_days, 1095) / 1095 x 0.45   (unknown age: 365)
//   breadth  = 1 + 0.03 x min(chains, 5)
//   implied  = max(1, round(base x growth x maturity x breadth))
//
// TVL is the size of the business, seven-day growth is its direction, age
// with no token is how long the launch has been waited for, and the number of
// chains is how widely the protocol is already distributed. The constants are
// stated on the dashboard so a reader can check every number.

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

export interface ModelParams {
  baseMultiple: number;
  growthWeight: number;
  growthLow: number;
  growthHigh: number;
  maturityBase: number;
  maturitySpan: number;
  maturityDays: number;
  unknownAgeDays: number;
  breadthPerChain: number;
  breadthMaxChains: number;
}

export const MODEL: ModelParams = {
  baseMultiple: 0.3,
  growthWeight: 0.6,
  growthLow: -50,
  growthHigh: 100,
  maturityBase: 0.55,
  maturitySpan: 0.45,
  maturityDays: 1095,
  unknownAgeDays: 365,
  breadthPerChain: 0.03,
  breadthMaxChains: 5,
};

export const MODEL_VERSION = 'radar-tusinap-1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  action: string;
  cost: string;
  duration: string;
}

export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface DashboardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface DashboardData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: DashboardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when unknown. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Valuation {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** One protocol's implied value under the model, with every multiplier shown. */
export function valueProtocol(p: Protocol, asOf: string, m: ModelParams): Valuation {
  const age = ageInDays(asOf, p.listed_at);
  const growthPct = Math.min(m.growthHigh, Math.max(m.growthLow, finiteOr(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * m.growthWeight;
  const ageForModel = age ?? m.unknownAgeDays;
  const maturityMult =
    m.maturityBase + (Math.min(Math.max(ageForModel, 0), m.maturityDays) / m.maturityDays) * m.maturitySpan;
  const breadthMult = 1 + m.breadthPerChain * Math.min(p.chains.length, m.breadthMaxChains);
  const implied = Math.max(1, Math.round(p.tvl_usd * m.baseMultiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** True when the record carries no token at all. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank the protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

/** The board: every watchlist slug plus the strongest early rows, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, m: ModelParams = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, m) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: m.baseMultiple,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: planFor(s.p, s.v.age).map(renderStep),
  }));
}

/** One farm step as a single string: action, then cost and time, within 20..600 chars. */
export function renderStep(step: FarmStep): string {
  const action = /[.!?]$/.test(step.action) ? step.action : `${step.action}.`;
  let s = `${action} Cost: ${step.cost}. Time: ${step.duration}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Position size from the protocol's own TVL: bigger protocols get a bigger ticket. */
function ticketFor(p: Protocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Minimum hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: Protocol, ticket: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${ticket} of USDC to ${name} on ${chain} and leave the deposit untouched`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Add $${ticket} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position`;
  if (c.includes('yield') || c.includes('yield aggregator'))
    return `Deposit $${ticket} into ${name}'s highest-TVL vault on ${chain} and hold the receipt token`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${ticket} of USDC through ${name} to ${chain} and use the bridged funds inside its app`;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak'))
    return `Stake $${ticket} of the native staking asset through ${name} and hold the liquid receipt token`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Post $${ticket} of USDC as margin on ${name} and open one small hedged position`;
  if (c.includes('prediction'))
    return `Fund ${name} with $${ticket} and take one position in its most liquid market`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Deposit $${ticket} into a ${name} vault on ${chain} and hold the shares`;
  if (c.includes('stablecoin'))
    return `Mint or hold $${ticket} of ${name}'s stable asset on ${chain}`;
  if (c.includes('rwa'))
    return `Mint $${ticket} of ${name}'s tokenised yield asset on ${chain} and hold it`;
  if (c.includes('insurance'))
    return `Buy $${ticket} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('staking'))
    return `Stake $${ticket} through ${name} on ${chain} and keep the staking receipt`;
  if (c.includes('launchpad'))
    return `Stake $${ticket} in ${name}'s launch pool on ${chain} and join one sale`;
  return `Deposit $${ticket} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's six-step farm plan, derived from its own record (category,
 * chains, TVL, age). No name is ever special-cased.
 */
export function planFor(p: Protocol, age: number | null): FarmStep[] {
  const chain = mainChain(p);
  const ticket = ticketFor(p);
  const hold = holdFor(age);
  const gas = ticket >= 150 ? 8 : 4;
  return [
    {
      action: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline',
      cost: 'under $3 of gas for the first transaction',
      duration: '5 minutes',
    },
    {
      action: coreAction(p, ticket, chain),
      cost: `$${ticket} of capital plus about $${gas} of gas`,
      duration: '15 minutes to set up',
    },
    {
      action: 'Do one qualifying action every week, a deposit, a borrow, a swap or a governance vote',
      cost: 'about $2 of gas a week',
      duration: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot`,
      cost: `the $${ticket} stays in the position`,
      duration: `${hold} days`,
    },
    {
      action: "Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes",
      cost: 'nothing to check, and never pay anyone to claim',
      duration: '10 minutes',
    },
    {
      action: 'Log the wallet, the dates and every transaction so you can repeat the position or unwind it cleanly',
      cost: 'nothing but the log',
      duration: '5 minutes',
    },
  ];
}

/** The live-token set, by market cap: the market's own values, never the model's. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function toDashboardRow(row: BoardRow): DashboardRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot, m: ModelParams = MODEL): { board: BoardRow[]; data: DashboardData } {
  const board = buildBoard(snapshot, m);
  const live = liveSet(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  return {
    board,
    data: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: m,
      model_version: MODEL_VERSION,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: early,
      live_size: live.length,
      rows: board.map(toDashboardRow),
      live,
    },
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it is sound. */
export function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) {
        return `${r.slug} has a farm step of ${s.trim().length} characters`;
      }
    }
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(data: DashboardData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
