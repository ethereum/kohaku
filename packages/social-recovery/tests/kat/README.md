# Known-answer test vectors

`vectors/` holds byte-for-byte copies of the vector files of the
MAST repo's `design/kats/`. `vectors/PROVENANCE.md` names the source commit and
the sha256 of each copy; `provenance.test.ts` fails if a copy is missing,
changed, or unlisted. Never edit or regenerate a copy: a vector changes in
the MAST repo first, then arrives here as a fresh copy with an updated
PROVENANCE.md.

A replay test loads a vector with a JSON import:

```ts
import setupBody from '../kat/vectors/setup-body.json';
```

or by reading the file:

```ts
import { readFileSync } from 'node:fs';
const setupBodyRaw = JSON.parse(readFileSync(new URL('./vectors/setup-body.json', import.meta.url), 'utf8'));
```

Each file has `format`, `source`, `derivation` and a `vectors` array (two also
carry `role`). Replay tests do not belong in this folder.
