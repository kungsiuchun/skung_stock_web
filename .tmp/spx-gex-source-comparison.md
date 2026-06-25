# SPX GEX Source Probe

Generated: 2026-06-24T06:11:34.317Z

| Source | Attempts | Success | Avg latency ms | Payload bytes | Expiries | Legs | Strikes | OI present | IV present |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cboe | 3 | 3 | 1567 | 13575800 | 57 | 30574 | 805 | 100 | 100 |
| yahoo | 1 | 1 | 952 | n/a | 5 | 2647 | 634 | 99.85 | 100 |

## Current Decision
- Decision: `Cboe primary + Yahoo fallback` is supported by this probe. Cboe has broader delayed chain coverage and comparable OI completeness.
