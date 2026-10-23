# Poseidon hash

Library for computing poseidonT3, optimized with respect to `maci-crypto`.

## Optimizations

`maci-crypto` computes Poseidon with `@zk-kit/poseidon-cipher`'s `poseidonPerm`. That function
runs the textbook permutation: every one of the 65 rounds adds the round constants, applies the
S-box, and multiplies the state by the full 3×3 MDS matrix. It also works on field elements in
plain (non-Montgomery) form, with a `% p` after every operation.

- **Montgomery arithmetic.** The inputs and all constants are in Montgomery form (`x·R mod p`,
  `R = 2^256`), so each multiplication is reduced with `redc` (mask, multiply, shift) instead of
  a bigint division.
- **Sparse partial rounds.** The 57 partial rounds use the optimized form from the Poseidon paper
  (the same idea as circomlib's `poseidon_opt`).

## Benchmark

Compares `poseidonT3` against the `maci-crypto` poseidon implementation:

```sh
pnpm benchmark
```
| Hashes | `poseidonT3` | `maci-crypto` | Speedup |
| -----: | -----------: | ------------: | ------: |
|     1k |       171 ms |        399 ms |   2.3×  |
|    10k |     1,676 ms |      3,821 ms |   2.3×  |
|   100k |    16,409 ms |     38,084 ms |   2.3×  |
