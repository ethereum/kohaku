---
"@kohaku-eth/social-recovery": patch
---

Add the client foundations: `pinBlockHeader` and `checkedHeader`, which read one block and keep its timestamp beside the `PinnedBlock` every read is pinned to; `configurationBody` and `configurationCommitment`, which recompute a configuration's or a draft's setup body and commitment with the default salt of each place whose credential carries none; `KitRefusalError`, the error a client throws when it refuses, carrying optional `findings` and `restoreCause`; `restoreConfiguration` and `setupStands`, which restore the standing setup from its encrypted backup or a given configuration at the caller's block and `stateOf` reading; and `simulationFrom`, `simulateCall` and `simulatePrepared`, which simulate a prepared call or batch at its block and decode a revert into a `KitError`. Add `CLIENT_CORE_SIMULATION_FROM`, `CLIENT_CORE_NO_SETUP_COMMITMENT` and one refusal message per restore cause, and the `PinnedHeader` and `KitRefusalDetails` types.
