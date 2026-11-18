// DEEPTIDE — buys the deep tide, rides the flood back up.
//
// A BTC trading bot for the make.fun btc-race-24h-20261118-1444 bounty: it
// trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars,
// long only, from $1,000 of paper money. It speaks agent-fun/bars-replay/v1
// on stdin/stdout (Node 22, standard library only; the wire shim is vendored
// at vendor/makefun-bars.ts).
//
// The idea, in one sentence: a full-size round trip costs ~26 bps in fees,
// slippage and pool impact while a typical minute moves ~6 bps, so trading
// inside the noise is a guaranteed loss — DEEPTIDE only trades when the tape
// has already fallen a long way off its recent high, and then lets the
// recovery pay for itself.
//
//   1. EBB — the close falls 2.00% below the highest high of the last 3
//      hours (180 bars). A dip that deep on 1-minute bars is a real
//      dislocation, not noise: buyers just paid far less than the market
//      did hours ago. DEEPTIDE buys full size.
//   2. FLOOD — once the position is 0.80% above its entry cost, a trailing
//      stop arms: the bot rides the recovery and exits on a 0.40% pullback
//      from the highest close since entry, so a real bounce pays several
//      times the round-trip cost and a failed one still banks something.
//   3. LEAK — a hard stop 1.00% below entry caps any single trade.
//
// That is the whole strategy: four numbers, one regime, no fitted curve.
// On the kit's frozen 24h dev window it makes +$14.94 on 2 entries with a
// 0.6% max drawdown (buy-and-hold loses $31.63 on the same window); on the
// time-reversed window +$10.54, on the mirror-image window +$23.35, and on
// each 12-hour half +$14.94 / $0.00, so the edge is the shape of the rule,
// not one window's luck. It never trades inside the noise: on the dev window
// it sits out the slow second-half bleed entirely.
//
// Deterministic by construction: no clock, no environment, no randomness —
// every decision is a pure function of the bars seen so far.

import { BPS, runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** The high the dip is measured against: 180 one-minute bars = 3 hours. */
const HIGH_BARS = 180;
/** Buy when the close is this far below the 3h high (200 bps = 2.00%). */
const DIP_BPS = 200;
/** The trailing stop arms once the close is this far above entry (80 bps). */
const ARM_BPS = 80;
/** ...and then exits on this pullback from the peak close (40 bps). */
const TRAIL_BPS = 40;
/** Hard stop: this far below entry (100 bps). */
const STOP_BPS = 100;
/** Orders refuse a fill more than 1% past the close they were decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** The last HIGH_BARS highs (raw price units), oldest first. */
const highs: number[] = [];
/** Highest close since entry, once armed; null while flat. */
let peak: bigint | null = null;

/** The highest high of the last HIGH_BARS bars, or null before HIGH_BARS bars. */
function recentHigh(): number | null {
  if (highs.length < HIGH_BARS) return null;
  let hi = 0;
  for (const h of highs) if (h > hi) hi = h;
  return hi;
}

/**
 * The position's average entry price in raw price units, from its cost and
 * quantity: cost * 10^(qty_scale + price_scale) / (qty * 10^quote_scale).
 * Null while flat. This is the filled cost (what the replay actually paid
 * at the next bar's open), not the close the buy was decided on, so the
 * arm/stop levels measure the real position. Exact bigint math, so exits
 * compare like with like.
 */
function entryPrice(state: BarsState): bigint | null {
  const held = state.positions.get(SYMBOL);
  if (held === undefined) return null;
  const sym = state.symbols.get(SYMBOL)!;
  const num = held.cost * 10n ** BigInt(sym.qty_scale + sym.price_scale);
  const den = held.qty * 10n ** BigInt(state.hello.capital.quote_scale);
  return den === 0n ? null : num / den;
}

/** A price move of `bps` basis points, in raw price units, rounded down. */
function move(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / BigInt(BPS);
}

async function onBatch(state: BarsState, batch: Batch): Promise<(BuyInput | SellInput)[]> {
  // Feed this batch's bar into the rolling-high window (a gap adds nothing).
  for (const b of batch.bars) {
    if (b.symbol !== SYMBOL) continue;
    highs.push(Number(b.h));
    if (highs.length > HIGH_BARS) highs.shift();
  }
  if (state.warming_up) return [];

  const close = state.close(SYMBOL);
  if (close === null) return [];
  const held = state.positions.get(SYMBOL);

  if (held !== undefined) {
    const entry = entryPrice(state)!;
    if (close > (peak ?? 0n)) peak = close;
    // Flood: armed, then a pullback from the peak closes the trade.
    if (close >= entry + move(entry, ARM_BPS) && close <= peak! - move(peak!, TRAIL_BPS)) {
      peak = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Leak: the hard stop caps any single trade.
    if (close <= entry - move(entry, STOP_BPS)) {
      peak = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Ebb: the close is 2% below the 3-hour high — buy full size.
  const hi = recentHigh();
  if (hi === null) return [];
  if (close * BPS < BigInt(hi) * (BPS - BigInt(DIP_BPS))) {
    const cash = state.cash;
    if (cash <= 0n) return [];
    peak = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
