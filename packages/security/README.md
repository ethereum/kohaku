# SecurityUtils

A collection of security-focused utilities for wallets. Aims to provide a baseline implementation of the walletbeat security standards and to be easily extensible for further additions.

## Utilities
- Blocklist - Fetches and parses blocklists from various sources, currently supporting domains and addresses.
- Address Poisoning - Provides utilities for poisoning addresses to prevent them from being used in transactions.

### Planned Utilities
- [ ] ENS/address label resolution - Resolve ENS names or address labels for known addresses.
- [ ] Fuzzy malicious URL detection - Match against potentially malicious URLs for typosquat / cyrillic character detection.
- [ ] Fuzzy malicious contract detection - Match against potentially malicious code hashes / bytecode patterns.
- [ ] Contract freshness - Check if a contract is recently deployed.
- [ ] EIP-55 Checksum validation (defer to viem probably?).
- [ ] Approval Management - Flag unlimited approvals, approvals to non-verified contracts, unnecessarily large approvals.  Query and display outstanding ERC20/permit2 approvals.  Generate revocation transactions.
- [ ] Human-readable transaction formatter
  - [ ] Display transactions in human-readable format
  - [ ] Generate warnings for malicious or dangerous actions
  - [ ] Display EIP-712 structs
  - [ ] Integrate with blocklist and address poisoning utilities
  - [ ] Decode well-known contract interactions (e.g. Uniswap swaps, OpenSea listings, etc.)
- [ ] Dust transaction filtering
- [ ] Flag blocked, frozen, or blacklisted funds in address balances

## Specs
 - [Walletbeat Security Features](https://github.com/walletbeat/walletbeat/blob/beta/docs/features.md#srcschemafeaturessecurityaccount-recoveryts)
 - [Walletbeat Security Discussion](https://github.com/walletbeat/walletbeat/discussions/407#discussioncomment-15296976)
