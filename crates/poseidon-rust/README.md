Modifications:
1. Add `poseidon_hash` fn
2. Add benchmark

Notes:
- The impls here are ~20-40% faster than those in light_poseidon.  light_poseidon is also ~1MiB, similar to this crate's 1.2MiB. Plus, this one supports t=14.

# Circom Compatible Poseidon Hash

This crate contains a custom rust implementation of the Poseidon hash function, which is compatible with [Circom](https://docs.circom.io/).
Currently, only the parameters for Poseidon with statesizes t=3 (allows hashing two field elements) and t=4 (allows hashing three field elements) for the BN254 curve is present. However, different parameters can be generated with the `src/bn254/parameters.sage` script, which is a modified copy of the original Poseidon instance generation script from [https://extgit.iaik.tugraz.at/krypto/hadeshash/-/blob/master/code/generate_parameters_grain.sage](https://extgit.iaik.tugraz.at/krypto/hadeshash/-/blob/master/code/generate_parameters_grain.sage).

Usage (for the BN254 curve):

```sage
sage parameters.sage 1 0 254 <t> 8 <r> 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
```

Or generate the whole thing with:

```bash
just generate
```

where t is the statesize and r is the number of rounds. Circom uses the following round numbers for different statesizes t:

| t   | r   |
| --- | --- |
| 2   | 56  |
| 3   | 57  |
| 4   | 56  |
| 5   | 60  |
| 6   | 60  |
| 7   | 63  |
| 8   | 64  |
| 9   | 63  |
| 10  | 60  |
| 11  | 66  |
| 12  | 60  |
| 13  | 65  |
| 14  | 70  |
| 15  | 60  |
| 16  | 64  |
| 17  | 68  |

## Verifying commitments for the Guessing game

One can recalculate the commitment for the guessing game by using the commitment.rs binary in this crate. For a guess G with the randomness R (as hex string) and the address A (as hex string), one can calculate the commitment as:

```rust
cargo run --release --bin commitment -- --guess <G> --rand <R> --address <A>
```

Example:

```rust
cargo run --release --bin commitment -- --guess 5 --rand 0xa --address 0x70997970c51812dc3a010c7d01b50e0d17dc79c8
```
