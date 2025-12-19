# Post-Quantum Account

We design a 4337 account that lets us verify two signatures rather than only one.
The goal is to enable post-quantum signatures while keeping the current ECDSA verification.

## Fixed contracts

### Pre-quantum logic contracts
- `ZKNOX_ECDSA.sol`: verifies an ECDSA signature on Ethereum using the precompile `ecrecover`,
- `ERC7913P256Verifier.sol` (from OpenZeppelin):  verifies an ECDSA signature on P256 using the precompile `p256verifiy`.

### Post-quantum logic contracts
- `ZKNOX_dilithium.sol`: verifies a MLDSA signature,
- `ZKNOX_ethdilithium.sol`: verifies a MLDSAETH signature.

### Hybrid verifier contract
- `ZKNOX_hybrid.sol`: verifies two signatures (one is pre-quantum, one is post-quantum).

## User contracts
Each user owns a 4337 account contract which contains:
- a `pre_quantum_pubkey` in `bytes`; it can be an ethereum address (20 bytes) or a P256 point (64 bytes)
- a `post_quantum_pubkey` in `bytes`; for MLDSA(ETH), we rather provide the address of a `PKContract`
- a `pre_quantum_logic_contract_address` referring to one of the two pre-quantum fixed contracts above,
- a `post_quantum_logic_contract_address` referring to one of the two post-quantum fixed contracts above,
- a `hybrid_verifier_logic_contract_address` referring to the hybrid verifier contract above.

Note: for MLDSA, this requires an extra contract `PKContract` storing the MLDSA public key.

### Example
In order to create a Hybrid ERC4337 account with P256 and MLDSAETH, one needs to:
1. Create a `PKContract` storing his MLDSAETH public key,
2. Create a `ZKNOX_ERC4337_account` with inputs:
    - the bytes of the P256 public key (64 bytes)
    - the bytes of the address of the PKContract containing his MLDSAETH public key (20 bytes)
    - the address of the `P256VERIFY` contract
    - the address of the `ethdilithium` contract
    - the address of the `hybrid` contract.


## How to run
In order to run the tests, it is required to install the requirements for both Solidity and python (the python signer is used inside the Solidity tests):
```
make install
```
Then, run the tests as follows:
- Hybrid verifier:
    ```
    forge test test/ZKNOX_hybrid.t.sol  -vv
    ```
- ERC4337 account (ECDSA+MLDSA):
    ```
    forge test test/ZKNOX_ERC4337_account.t.sol -vv
    ```
- ERC4337 account (ECDSA+MLDSAETH):
    ```
    forge test test/ZKNOX_ERC4337_account_with_eth.t.sol -vv
    ```
- ERC4337 account (P256VERIFY+MLDSA):
    ```
    forge test test/ZKNOX_ERC4337_account_with_p256.t.sol -vv
    ```
