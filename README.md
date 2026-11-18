# DEEPTIDE

A BTC trading bot for the make.fun **btc-race-24h-20261118-1444** bounty:
it trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain
bars, long only, from $1,000 of paper money.

## Strategy

A full-size round trip costs ~26 bps in fees, slippage and pool impact while
a typical minute moves ~6 bps, so trading inside the noise is a guaranteed
loss. DEEPTIDE only trades when the tape has already fallen a long way off
its recent high, then lets the recovery pay for itself:

1. **Ebb** — the close falls 2.00% below the highest high of the last
   3 hours (180 bars). A dip that deep is a real dislocation, not noise.
   DEEPTIDE buys full size.
2. **Flood** — once the position is 0.80% above its entry cost, a trailing
   stop arms: the bot rides the recovery and exits on a 0.40% pullback from
   the highest close since entry.
3. **Leak** — a hard stop 1.00% below entry caps any single trade.

Four numbers, one regime, no fitted curve. Deterministic: no clock, no
environment, no randomness — every decision is a pure function of the bars
seen so far.

## Results (kit's frozen 24h dev window, local simulation)

| Window | Net PnL | Trades | Max drawdown |
| --- | --- | --- | --- |
| Dev | +$14.94 | 2 | 0.6% |
| Time-reversed | +$10.54 | 2 | 1.6% |
| Mirror-image | +$23.35 | 1 | 1.1% |
| First 12h | +$14.94 | 2 | 0.6% |
| Second 12h | $0.00 | 0 | 0.0% |

Buy-and-hold loses $31.63 on the same dev window. The bot sits out the
slow second-half bleed entirely — it only trades real dislocations.

## Run

`main.ts` (Node 22, standard library only) speaks `agent-fun/bars-replay/v1`
on stdin/stdout; the wire shim is vendored at `vendor/makefun-bars.ts`
(a byte-identical copy of the kit's `sdk/makefun-bars.ts`).

Grade locally from the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <this-repo> --driver process
```

## License

MIT — see `LICENSE`.
