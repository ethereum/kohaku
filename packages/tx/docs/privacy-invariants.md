# Privacy Invariants

This document outlines the core invariants and design goals for a next-generation privacy-preserving protocol.

### I. Core Functional Invariants

This section defines the fundamental, non-negotiable capabilities of the system from a user's perspective.

1. **Private Withdrawals:** Users **MUST** be able to withdraw their funds from the pool to a public EVM address without creating a public, on-chain link between the withdrawn assets and their original deposit history.
2. **Private Internal Transfers:** The protocol **MUST** support private transfers between participants where funds do not leave the pool. For any internal transfer, the sender, recipient, amount, and asset type **MUST** remain confidential.
3. **Cryptographically Enforced Ownership:** The protocol **MUST** ensure that the rightful ownership of a new note is cryptographically enforced at the moment of its creation. It **MUST** be impossible for a sender to create a "phantom note"—one that is encrypted for a recipient but is secretly only spendable by the sender or another party.
4. **Passive Private Receipt:** A recipient **MUST NOT** be required to perform on-chain actions or generate special keys to receive funds. Ownership is designated passively by the sender. This principle is realized through two essential corollaries:
    - **Direct-to-EVM Addressability:** A sender **MUST** be able to construct and send a private payment to a recipient using only their standard, public EVM address (`0x...`).
    - **Active Spend Authorization:** To enable passive receipt, the protocol **MAY** require a recipient to perform a one-time, on-chain action to authorize a set of SNARK-friendly spending keys before the received funds can be spent.
5. **UTXO Management:** The system **SHOULD** provide standard Unspent Transaction Output (UTXO) functionalities, allowing users to merge multiple notes into one or split a single note into many.
6. **Multi-Asset Support:** The protocol **SHOULD** support multiple different ERC20 tokens within the same privacy set to avoid fragmenting the anonymity set.
7. **Efficient Proof Generation:** The zero-knowledge proof generation **MUST** be performant enough for a seamless user experience on standard consumer hardware. The design **SHOULD** achieve this by minimizing or avoiding expensive in-circuit cryptographic operations.

### II. Security & Cryptographic Invariants

This section defines the fundamental security guarantees the protocol must uphold.

1. **Value Conservation:** The protocol **MUST** enforce a strict and universal value conservation law. For any given transaction and for each asset type, `sum(public_deposits) + sum(private_spent_notes)` **MUST** equal `sum(public_withdrawals) + sum(private_new_notes)`. This **MUST** be enforced within the ZK-SNARK circuit.
2. **Double-Spend Prevention:** It **MUST** be computationally infeasible for any user to spend the same note more than once.
3. **Ownership:** Only the legitimate owner of a note, as defined by their private keys, **MUST** be able to create a valid proof to spend it.
4. **Transaction Integrity:** It **MUST** be cryptographically infeasible for an unauthorized third party to alter the contents of a valid transaction without invalidating its ZK-SNARK proof.
5. **User Key Security:** The system **MUST NOT** require users to export their core EVM private keys from their secure hardware or software enclaves.
6. **Key Rotation and Revocation:** Users **MUST** have a secure mechanism to revoke compromised keys and rotate to new ones without losing access to their funds.
7. **Protocol Immutability and Trustlessness:** The core protocol logic **MUST** be immutable and not subject to arbitrary, centralized changes. Any upgrade mechanism **MUST** either be opt-in by users or subject to a mandatory and sufficiently long time-lock.
8. **State Validity & Re-org Resistance:** The system **MUST** reject the registration of invalid states. It **MUST** maintain a history of recent state roots to ensure that user-generated proofs remain valid across minor blockchain re-organizations.
9. **Automated Note Discovery:** The protocol **SHOULD** enable a user who has pre-registered a viewing key to automatically discover their incoming notes by scanning on-chain data.

### III. Compliance and Risk Management

1. **Illicit Fund Segregation:** The protocol **MUST** provide a mechanism to prevent the mixing of funds from illicit sources with the general user pool.
2. **Optional Selective Disclosure:** The protocol **SHOULD** provide a mechanism for a user to selectively and privately disclose transaction information to a third party. This mechanism **MUST NOT** grant the third party any authority to spend the user's funds. The disclosure **MUST** always be under the user's explicit control. 

### IV. Aspirational Properties (For Discussion)

This section outlines ideal, but potentially complex, properties. We are keen to understand how critical these are for future privacy protocols from the reviewers' perspective.

1. **Flexible Proof of Innocence:** The protocol **SHOULD** enable a user to prove that their funds (both within the pool and after withdrawal) are not linked to an arbitrary, third-party-provided set of "tainted" addresses. This allows users to satisfy the compliance requirements of different entities (exchanges, dApps, etc.) who may maintain different and subjective blocklists, without revealing their full transaction history. This directly addresses the "late discovery" problem in a flexible, user-centric way. How critical is this feature for long-term compliance and ecosystem interoperability?
2. **Private DeFi Composability:** To what extent **SHOULD** the protocol support private interactions with the existing public DeFi ecosystem (e.g., swapping on Uniswap)? Is this a critical feature, or would an alternative model of isolated "private DeFi"—where specific protocols are forked and operate within the privacy set—be a more secure and viable approach? The former risks exposure to the broader, untrusted asset ecosystem, while the latter could lead to fragmented liquidity.
3. **Interoperable Privacy Set (Shared Pool):** To improve user and developer experience, **SHOULD** the protocol's on-chain components be standardized to the point where multiple, independent privacy applications (e.g., different wallets or privacy dApps) can share a single, universal anonymity set? This would prevent liquidity fragmentation and simplify note management for users, who would not need to track balances across different, incompatible privacy pools.