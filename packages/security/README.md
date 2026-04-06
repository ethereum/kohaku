# SecurityUtils

A collection of basic security-focused utilities for wallets. Aims to provide a baseline implementation of the walletbeat security standards and to be easily extensible for further additions.

The utilities provided by this package are intended to provide baseline security that can be universally integrated into wallets. They are not intended to be comprehensive or to cover all possible security features.  More advanced or wallet-specific features are out-of-scope and should be implemented by wallets themselves.

## Utilities
- Blocklist - Fetches and parses blocklists from various sources, currently supporting domains and addresses.
- Address Poisoning - Provides utilities for poisoning addresses to prevent them from being used in transactions.

### Planned Utilities
- Phishing
  - [ ] ENS/address label resolution - Resolve ENS names or address labels for known addresses.
  - [ ] Fuzzy malicious URL detection - Match against potentially malicious URLs for typosquat / cyrillic character detection.
  - [ ] Fuzzy malicious contract detection - Match against potentially malicious code hashes / bytecode patterns.
  - [ ] Contract freshness - Check if a contract is recently deployed.

- Tokens
  - [ ] Approval Management - 
    - [ ] Flag unlimited approvals
    - [ ] Flag approvals to non-verified contracts
    - [ ] Flag unnecessarily large approvals
    - [ ] Query and display outstanding ERC20/permit2 approvals
    - [ ] Generate revocation transactions
  - [ ] Flag blocked, frozen, or blacklisted funds in address balances for accounts
  - [ ] Dust transaction filtering

 - Utilities
  - [ ] EIP-55 Checksum validation (defer to viem probably?).
  - [ ] Address formatting - Format addresses in a human-readable and standard way.
  - [ ] Human-readable transaction formatter
    - [ ] Display transactions in human-readable format
    - [ ] Generate warnings for malicious or dangerous actions
    - [ ] Display EIP-712 structs
    - [ ] Integrate with blocklist and address poisoning utilities
    - [ ] Decode well-known contract interactions (e.g. Uniswap swaps, OpenSea listings, etc.)

### Out-of-scope
 - [ ] Key management - highly architecturally-specific, so should be implemented by wallets
 - [ ] Screenshot blocking - os-specific, so should be implemented by wallets
 - [ ] Cryptographic utilities - should be imported from well-known libraries.
 - [ ] User authentication - should be implemented by wallets using standard libraries / practices
 - [ ] Hardware wallets - implemented by hardware wallet vendors
 - [ ] Duress resistance - wallet-specific

## Specs
 - [Walletbeat Security Features](https://github.com/walletbeat/walletbeat/blob/beta/docs/features.md#srcschemafeaturessecurityaccount-recoveryts)
 - [Walletbeat Security Discussion](https://github.com/walletbeat/walletbeat/discussions/407#discussioncomment-15296976)
