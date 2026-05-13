# SecurityUtils

A collection of basic security-focused utilities for wallets. Security utilities should be small, focused, ideally stateless, and easy to integrate. Using these should provide a baseline implementation of the walletbeat security standards and be easily extensible for further additions within the SDK or by wallets.

Utilities in this list should be applicable to all wallets. More advanced or wallet-specific features are out-of-scope and should be implemented by wallets themselves. Specialized utilities already covered by standard libraries and vendor-specific integrations are also out-of-scope for now.

## Utilities
- Phishing
  - [x] Address Poisoning - Provides utilities for poisoning addresses to prevent them from being used in transactions.
  - [x] Blocklist - Fetches and parses blocklists from various sources, currently supporting domains and addresses.
  - [ ] ENS/address label resolution - Resolve ENS names or address labels for known addresses.
  - [ ] Fuzzy malicious URL detection - Match against potentially malicious URLs for typosquat / cyrillic character detection.
  - [ ] Fuzzy malicious contract detection - Match against potentially malicious code hashes / bytecode patterns.
  - [ ] Domain freshness - Check if a domain is recently registered.
  - [ ] Contract freshness - Check if a contract is recently deployed.
  - [ ] Contract source verification - Check if a contract's source code is verified on Etherscan or similar services.

- Drainers
  - [ ] DNS freshess - check if the DNS record was recently changed.
  - [ ] Block sites with obfuscated JS
  - [ ] Check known drainer paths (ie `/assets/secure.php`)
    - Consider reporting potential drainer paths to SEAL phishnet or something?  Opt-in, privacy-preserving.  But could be quite helpful to protect others.

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
    - [ ] Display transactions in human-readable format (IE clearsigning)
    - [ ] Generate warnings for malicious or dangerous actions
    - [ ] Display EIP-712 structs
    - [ ] Integrate with blocklist and address poisoning utilities
    - [ ] Decode well-known contract interactions (e.g. Uniswap swaps, OpenSea listings, etc.)

- Privacy
  - [ ] Address connectivity - list which addresses are publically associated (trivially, possibly include multiple hops) so you can alert users when new addresses become associated.

### Open Questions
 - Transaction formatting might be too complex.  Very wallet-specific, since it's highly UX dependent, and there are existing services (IE tenderly) that provide this functionality.  Clearsigning is also part of [eip-7730](https://eips.ethereum.org/EIPS/eip-7730) so either defer to this standard impl or impl their standard here.

## Out-of-scope
Utilities not universally applicable to all wallets, or are better handled by specialized existing libraries, are out-of-scope for this package. Some examples include:

- Existing standardized libraries - functionality that is already well-covered by existing libraries.
  - RNG
  - Cryptographic utilities (encryption, hashing, signing, etc.)

- OS-specific - functionality that is specific to certain operating systems or platforms.
  - Screenshot blocking
  - Clipboard management
  - Secure storage (keys, private info, etc.)
  - Wipe sensitive data from RAM

- Architecturally-specific - functionality that is highly dependent on the specific architecture of the wallet or application.
  - Key management
  - Wallet locking / unlocking
  - User authentication
  - Duress resistance
  - Spend ratelimits, timelocks, conditional authorization, etc.
  - Account recovery drills - checking that the user has their seed phrase / guardian accounts / etc.

- Devops - functionality related to development and deployment practices that are important for security but not code / sdk-compatible.
  - Licensing
  - Source availability
  - Audit / bug bounty practices
  - Distribution practices
  - Wallet environment hardening (sandboxing, minimal permissions, firewall rules, etc.) - mobile + desktop wallets

- Chain verification - eth_proof verification.  Part of helios, not this package.

## Specs
 - [Walletbeat Security Features](https://github.com/walletbeat/walletbeat/blob/beta/docs/features.md#srcschemafeaturessecurityaccount-recoveryts)
 - [Walletbeat Security Discussion](https://github.com/walletbeat/walletbeat/discussions/407#discussioncomment-15296976)
 - https://www.figma.com/board/52PPPmiYhrihbhbqXqzVEZ/Wallet-Safety-Standards?node-id=0-1&p=f
