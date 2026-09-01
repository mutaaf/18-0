# 18-0

**Spin history. Build seven. Chase perfection.**

An NFL historical roster game. Spin for a franchise and an era, pick one
eligible player, fill seven slots, and receive a deterministic rating mapped to
an 18-game record from 0-18 to 18-0. No possession simulation, no random
losses — the same roster always earns the same result.

See [`PRFAQ.md`](./PRFAQ.md) for the full product specification.

## Status

Phase 0 complete: the scoring domain and the calibration harness.

- `packages/domain` — the entire scoring model as pure, versioned,
  config-driven TypeScript. 98 tests covering every record boundary, every
  perfection gate, and the eight seed fixtures from PRFAQ §38.
- `packages/domain/src/sim` — a synthetic-league Monte Carlo used to fit the
  calibration curve and to answer whether 18-0 is actually attainable.

Read [`docs/FINDINGS.md`](./docs/FINDINGS.md) first — it is the reason this
phase came before any UI. [`docs/scoring-model.md`](./docs/scoring-model.md)
documents the model itself.

Not yet built: the Expo client, the data ingest pipeline, and Supabase.

## Commands

```bash
pnpm install
pnpm test          # domain test suite
pnpm typecheck
pnpm sim           # reachability + ending distribution
pnpm calibrate     # refit the calibration curve (add --write to save)
```
