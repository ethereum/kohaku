---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Paymaster withdrawal preparation no longer sends an executable UserOperation to the bundler. Before, `eth_estimateUserOperationGas` received the signed operation with real proofs, so a bundler could submit it before `broadcast()`, even for a dry run or a declined confirmation.

Gas estimation now uses a simulation payload: a dummy account signature, a dummy EIP-7702 authorization, and dummy Groth16 proofs with random nullifier (and, for Privacy Pools, commitment) hashes. This applies to the sponsoring note and to batched `withdraw` calls. State overrides make each pool's verifier run its real code at a shadow address and return `true`, so the estimate includes real verification gas plus about 3k. After the limits converge, the SDK proves each note and signs once, locally.

- The configured bundler must support `eth_estimateUserOperationGas` state overrides (Pimlico and Alto do). Preparation reads each pool's verifier address and code from the host provider.
- External and smart-account signers get one signature prompt, after estimation. Before, each refinement round needed a signature. An invalid or rejected signature now stops preparation after estimation instead of before.
