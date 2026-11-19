# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tanusinap/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tanusinap/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 pre-token protocols ranked by an implied value
from a model fitted on the snapshot's own traded tokens, with a concrete
farm plan and net-of-fees economics for each one and a sortable, filterable
dashboard that shows the model's out-of-sample validation.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory.

## The model (radar-tusinap-2)

```
value if it launches = 10^a x TVL^b x sector x momentum
  a, b from an OLS fit of log10(market cap) on log10(TVL) over the
  snapshot's traded tokens (fitted at run time: a = 3.03, b = 0.52, n = 128)
  sector = the category's median residual from that fit (n >= 5, clamped x0.5-x2.0)
  momentum = 1 + clamp(change_7d / 100, -0.5, 1.0) x 0.30 (change_7d is in per cent)
launch odds = the category's token rate among the rankable pool
  (Laplace-smoothed), times an age factor falling from 1.15 at listing
  to 0.60 at 3 years, clamped to 0.05-0.95
implied = value if it launches x launch odds, with a P25-P75 range from
  the leave-one-out residual spread
```

One function scores every row; no protocol name is special-cased. The board
covers all 40 watchlist protocols plus the 158 other rankable pre-token
protocols. All 758 snapshot protocols are accounted for: 198 ranked, 128
with a token trading, 288 with a token on record, and the rest set aside as
bridges, liquid staking, exchange custody, versioned listings or wrapped
products, each group for a stated reason.

Validation, computed at run time and shown on the dashboard: a
leave-one-out backtest of the value model (flat multiple x5.09, + size
curve x3.40, + sector x3.55, + momentum x3.49 median miss; 45% of
held-out caps priced within 3x) and a range check (51% of held-out caps
inside the printed range).

---

<sub>Entered on [make.fun](https://make.fun/?ref=x1f93qgn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
