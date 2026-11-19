# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tanusinap/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tanusinap/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 200 pre-token protocols ranked by an implied value
derived from TVL, seven-day growth, age with no token and chain breadth, with
a concrete farm plan for each one and a sortable, filterable dashboard.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory.

## The model

```
implied = round( tvl_usd x 0.30
  x (1 + clamp(change_7d, -50, +100) / 100 x 0.60)
  x (0.55 + min(age_days, 1095) / 1095 x 0.45)
  x (1 + 0.03 x min(chains, 5)) )
```

One function scores every row; no protocol name is special-cased. The board
covers all 40 watchlist protocols plus the 160 strongest pre-token protocols
below the watchlist floor. Live-token protocols are set aside with their
market caps shown.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x1f93qgn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
