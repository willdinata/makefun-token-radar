# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/willdinata/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/willdinata/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/reward?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot and ranks every pre-token protocol by an implied launch value — its TVL priced at the median market-cap/TVL multiple of its category's tokenized peers (winsorized, shrunk toward the global median), adjusted for seven-day growth, tokenless age and chain breadth. Every row carries a concrete six-step farm plan with costs and durations, and the dashboard shows the board, a detail view per protocol, the live-token comparables behind the multiples, and the model itself.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

It writes board.json, data.js, dashboard/, screenshots/ and dossier.json to the output directory.

## The model

Implied value = TVL × category multiple × growth factor × tokenless-age factor × chain-breadth factor. The category multiple is the median mcap/TVL of the category's tokenized peers, winsorized at the peer set's 95th percentile and shrunk toward the global median with a prior of 8 peers; growth is the 7-day TVL change clamped to −50%…+100% at a 0.30 weight; the age factor runs from 0.80 to 1.20 over 1,460 tracked days; each extra chain adds 3%, up to four.

---

<sub>Entered on [make.fun](https://make.fun/?ref=63p7zf8z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
