// lib/model.ts — the token launch radar's value model.
//
// Everything on the board is derived from the sealed snapshot's own fields.
// No protocol is named or special-cased anywhere in this file: a row's implied
// value is its TVL priced at the rate tokens in its category actually trade at,
// adjusted for its seven-day growth, for how long it has run with no token, and
// for how many chains it spans.
//
// The category rate comes from the tokenized peers in the snapshot: for each
// category, the median market-cap/TVL ratio of the protocols whose token
// already trades, shrunk toward the global median so a category with two peers
// cannot shout louder than one with twenty. Peer ratios are winsorized at the
// peer set's 95th percentile first: one microcap token trading at 400x its
// TVL must not be allowed to price a whole category.

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

export interface Breakdown {
  category_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  watchlist: boolean;
  implied_value_usd: number;
  model: Breakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number | null;
}

export interface CategoryRate {
  category: string;
  peers: number;
  median_multiple: number;
  used_multiple: number;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  watchlist_count: number;
  board_size: number;
  live_size: number;
  formula: string;
  constants: { shrinkage_prior: number; winsorize_percentile: number; growth_weight: number; growth_clamp: [number, number]; age_floor: number; age_span: number; age_cap_days: number; chain_step: number; chain_cap: number };
  categories: CategoryRate[];
  rows: Row[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;
const SHRINKAGE_PRIOR = 8;
const WINSORIZE_PERCENTILE = 95;
const GROWTH_WEIGHT = 0.3;
const GROWTH_MIN = -50;
const GROWTH_MAX = 100;
const AGE_FLOOR = 0.8;
const AGE_SPAN = 0.4;
const AGE_CAP_DAYS = 1460;
const CHAIN_STEP = 0.03;
const CHAIN_CAP = 4;

// Categories whose products are claims on another protocol's token, or an
// exchange's own venue: the house's watchlist rule leaves them out, and the
// radar follows it for the rows it adds beyond the watchlist.
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Whole days from one YYYY-MM-DD day to another, both read as UTC. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

interface RateTable {
  globalMultiple: number;
  byCategory: Map<string, { peers: number; median: number; used: number }>;
}

/** The category rates: median mcap/TVL of each category's tokenized peers, shrunk to the global median. */
function categoryRates(protocols: Protocol[]): RateTable {
  const peers = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  // Winsorize: cap every peer's ratio at the peer set's 95th percentile, so a
  // single outlier cannot price a category. The cap is computed from the data.
  const allRatios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const cap = allRatios[Math.floor((WINSORIZE_PERCENTILE / 100) * (allRatios.length - 1))]!;
  const capped = (p: Protocol) => Math.min(p.mcap_usd! / p.tvl_usd, cap);
  const globalMultiple = median(peers.map(capped));
  const groups = new Map<string, number[]>();
  for (const p of peers) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(capped(p));
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, { peers: number; median: number; used: number }>();
  for (const [category, ratios] of groups) {
    const med = median(ratios);
    const n = ratios.length;
    byCategory.set(category, { peers: n, median: med, used: (n * med + SHRINKAGE_PRIOR * globalMultiple) / (n + SHRINKAGE_PRIOR) });
  }
  return { globalMultiple, byCategory };
}

function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The radar's own additions follow the watchlist's exclusions; watchlist rows are always kept. */
function rankable(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

function tierCapital(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

const CORE_ACTION: Record<string, string> = {
  Lending: 'supply USDC as lending collateral and leave it supplied, borrowing nothing against it',
  Dexs: 'provide USDC liquidity to the deepest stable pool and keep the position in range',
  CDP: 'open a small collateralised debt position: deposit collateral and mint a modest amount of the stablecoin against it',
  Yield: 'deposit USDC into the flagship vault and hold the vault shares it issues',
  Derivatives: 'deposit margin and open one small hedged trade, long and short the same size, so the account stays active without directional risk',
  RWA: 'mint or buy the yield-bearing asset with USDC and hold it in the farm wallet',
  'Risk Curators': 'deposit USDC into one curated vault and leave the allocation untouched',
  'Onchain Capital Allocator': 'deposit USDC into the main allocation vault and hold the shares',
  'Liquidity Manager': 'provide USDC to the managed liquidity vault and keep the position open',
};

/** Six concrete steps per row, generated from the row's category, first chain, TVL tier and age. */
function farmSteps(p: Protocol, ageDays: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = tierCapital(p.tvl_usd);
  const core = (p.category !== null ? CORE_ACTION[p.category] : undefined) ?? 'deposit USDC into the protocol\'s main product and leave the position open';
  const holdDays = ageDays < 180 ? 60 : ageDays < 365 ? 45 : 30;
  const steps = [
    `Set up a dedicated wallet for ${p.name} and fund it on ${chain} with about $${capital + 25} in USDC plus a small amount of the chain's gas token, kept separate from any wallet that holds long-term funds. Cost: about $5 in bridge and gas fees. Time: 30 minutes, once.`,
    `Make the core deposit on ${chain}: ${core}. Size it at about $${capital}, small against the protocol's TVL, so the position counts as a real user without concentrating risk in one venue. Cost: about $${capital} of capital plus roughly $3 of gas. Time: 20 minutes, once.`,
    `Repeat one qualifying action every week: add a small top-up of about $${Math.max(10, Math.round(capital / 10))} or rebalance the existing position, so the wallet shows steady use across many weeks rather than one burst. Cost: about $1 of gas a week. Time: 10 minutes a week.`,
    `Hold the position open for at least ${holdDays} days. A protocol this age (${ageDays} days tracked) rewards wallets that stay through a full points season, and closing early is the most common way farms lose eligibility. Cost: the opportunity cost of $${capital} for ${holdDays} days. Time: ${holdDays} days.`,
    `Check the protocol's own app and announcements once a week for a points or rewards page, and claim only through links the protocol itself publishes. Never pay a third party to claim, and never sign a claim on a site the protocol has not linked. Cost: $0. Time: 5 minutes a week.`,
    `Keep a dated farm log of every deposit, top-up and claim, then unwind in one step at the end: withdraw the position back to USDC on ${chain} and bridge it out. If a token has launched by then, claim it to the same wallet before unwinding. Cost: about $4 in gas. Time: 30 minutes, once.`,
  ];
  return steps;
}

export function buildRadar(snapshot: Snapshot): { rows: Row[]; radar: Radar } {
  const rates = categoryRates(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);

  // The age a protocol with no listed_at is given: the median age of the
  // pre-token protocols whose listing day is known, from the data itself.
  const knownAges = snapshot.protocols
    .filter((p) => recordsNoToken(p) && p.listed_at !== null)
    .map((p) => dayDiff(p.listed_at!, snapshot.as_of));
  const fallbackAge = Math.round(median(knownAges));

  const scored: Omit<Row, 'rank'>[] = [];
  for (const p of snapshot.protocols) {
    const onWatchlist = watchlist.has(p.slug);
    if (!onWatchlist && !(recordsNoToken(p) && rankable(p))) continue;
    const rate = p.category !== null ? rates.byCategory.get(p.category) : undefined;
    const multiple = rate?.used ?? rates.globalMultiple;
    const growthRaw = Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, p.change_7d ?? 0));
    const growthMult = 1 + GROWTH_WEIGHT * (growthRaw / 100);
    const ageDays = p.listed_at !== null ? dayDiff(p.listed_at, snapshot.as_of) : fallbackAge;
    const ageMult = AGE_FLOOR + AGE_SPAN * (Math.min(ageDays, AGE_CAP_DAYS) / AGE_CAP_DAYS);
    const chainMult = 1 + CHAIN_STEP * Math.min(Math.max(p.chains.length - 1, 0), CHAIN_CAP);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * ageMult * chainMult));
    scored.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      watchlist: onWatchlist,
      implied_value_usd: implied,
      model: {
        category_multiple: round4(multiple),
        peer_count: rate?.peers ?? 0,
        growth_multiplier: round4(growthMult),
        age_multiplier: round4(ageMult),
        chain_multiplier: round4(chainMult),
      },
      farm_steps: farmSteps(p, ageDays),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const rows: Row[] = scored.map((row, i) => ({ rank: i + 1, ...row }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));

  const categories: CategoryRate[] = [...rates.byCategory.entries()]
    .map(([category, r]) => ({ category, peers: r.peers, median_multiple: round4(r.median), used_multiple: round4(r.used) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));

  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    formula:
      'Implied value = TVL x category multiple x growth factor x tokenless-age factor x chain-breadth factor. ' +
      'The category multiple is the median market-cap/TVL ratio of the category\'s tokenized peers, shrunk toward the global median by peer count (prior of 8 peers); peer ratios are winsorized at the peer set\'s 95th percentile so one outlier cannot price a category. ' +
      'Growth factor = 1 + 0.30 x (7-day TVL change clamped to -50%..+100%). ' +
      'Age factor = 0.80 + 0.40 x (days tracked with no token, capped at 1460) / 1460. ' +
      'Chain factor = 1 + 0.03 per extra chain, up to 4 extra chains.',
    constants: {
      shrinkage_prior: SHRINKAGE_PRIOR,
      winsorize_percentile: WINSORIZE_PERCENTILE,
      growth_weight: GROWTH_WEIGHT,
      growth_clamp: [GROWTH_MIN, GROWTH_MAX],
      age_floor: AGE_FLOOR,
      age_span: AGE_SPAN,
      age_cap_days: AGE_CAP_DAYS,
      chain_step: CHAIN_STEP,
      chain_cap: CHAIN_CAP,
    },
    categories,
    rows,
    live,
  };
  return { rows, radar };
}

/** The gate's shape, checked before anything is written: an issue string, or null when the board is valid. */
export function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100..4000`;
  const slugs = new Set(rows.map((r) => r.slug));
  if (slugs.size !== rows.length) return 'board holds a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) if (!known.has(r.slug)) return `board names a protocol the snapshot does not: ${r.slug}`;
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug missing from the board: ${slug}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${r.slug} carries rank ${r.rank}, expected ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${r.slug} has a bad implied value`;
    if (i > 0 && rows[i - 1]!.implied_value_usd < r.implied_value_usd) return `implied value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} holds ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${r.slug} has a farm step of ${len} characters`;
    }
  }
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'every implied value is the same';
  return null;
}

/** The dashboard's data file: everything the page renders, in one script. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
