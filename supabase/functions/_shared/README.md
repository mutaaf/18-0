# Shared scoring module

`domain.ts` is a build artifact, not source. It is the bundled contents of
`packages/domain` so the Edge Function scores a roster with byte-identical
logic to the client — the whole point of §36 is that both sides run the *same*
code, not two implementations that agree today.

Regenerate before deploying:

```bash
pnpm --filter @18-0/domain build:edge
```
