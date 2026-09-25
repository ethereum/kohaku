# Known-answer test vectors

`vectors/` holds byte-for-byte copies of the owner-blessed vector files of the
MAST repo's `design/kats/`. `vectors/PROVENANCE.md` names the source commit and
the sha256 of each copy; `provenance.test.ts` fails if a copy is missing,
changed, or unlisted. Never edit or regenerate a copy: a vector change is a
design delta in the MAST repo first, then a fresh copy with an updated
PROVENANCE.md.

A replay test loads a vector either way:

```ts
import setupBody from '../kat/vectors/setup-body.json';
// or
import { readFileSync } from 'node:fs';
const setupBodyRaw = JSON.parse(readFileSync(new URL('./vectors/setup-body.json', import.meta.url), 'utf8'));
```

Each file has `format`, `source`, `derivation` and a `vectors` array (two also
carry `role`). The replays themselves belong to PT-033, not to this folder.
