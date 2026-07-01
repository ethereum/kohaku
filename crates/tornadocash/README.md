# tornadocash-rs

Tornadocash-rs is a Rust Tornado Cash client library, designed to interface with Tornado Cash's smart contracts. It provides support for:
- Merkle tree syncing
- Deposit and withdrawal transactions

## Benchmarks

Benchmarks were run on a Ryzen 5 3600, 32GB RAM.

| Method               | Target           | Time (ms) |
| -------------------- | ---------------- | --------- |
| merkle_insert/10_000 | native           | 316       |
| generate_witness     | native           | 167       |
| generate_proof       | native           | 1,373     |
| merkle_insert/10_000 | native +parallel | 48        |
| generate_witness     | native +parallel | 175       |
| generate_proof       | native +parallel | 335       |
