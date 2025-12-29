# Post-Quantum Account

Implementation of an ERC4337 account enabling post-quantum security.
The account lets us verify two signatures rather than only one.
The goal is to enable post-quantum signatures while keeping the current ECDSA verification.

## How to run
In order to run the tests, it is required to install the requirements for both Solidity and python (the python signer is used inside the Solidity tests):
```
make install
```
Then, run the tests as follows:
```
make test_opt
```
Note that Falcon key generation in python is a bit slow, and the test file computes it several times.
In order to run tests separately:

- Hybrid verifier:
    ```
    forge test test/ZKNOX_hybrid.t.sol  -vv
    ```
- ERC4337 accounts:
    ```
    forge test test/ZKNOX_ERC4337_account_K1_ETHFALCON.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_K1_FALCON.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_K1_MLDSA.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_K1_MLDSAETH.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_R1_ETHFALCON.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_R1_FALCON.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_R1_MLDSA.t.sol -vv
    forge test test/ZKNOX_ERC4337_account_R1_MLDSAETH.t.sol -vv
    ```

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
- a `post_quantum_pubkey` in `bytes`; the address of a `PKContract` for MLDSA(ETH), the public key bytes for FALCON
- a `pre_quantum_logic_contract_address` referring to one of the two pre-quantum fixed contracts above,
- a `post_quantum_logic_contract_address` referring to one of the two post-quantum fixed contracts above,
- a `hybrid_verifier_logic_contract_address` referring to the hybrid verifier contract above.

Note: for MLDSA, this requires an extra contract `PKContract` storing the MLDSA public key.

## Onchain Sepolia Testnets
Because of the high gas amount, we decided to deploy the contracts on both L1 Sepolia and Arbitrum Sepolia.

### Fixed contracts
The signature verifier contract addresses are fixed and deployed once for all:

|Signature scheme| Address on L1 Sepolia | Address on Arbitrum Sepolia|
|-|-|-|
|MLDSA    | [0xc15278300d4736C10c465E0f73b2D9eCC1c0d94B](https://sepolia.etherscan.io/address/0xc15278300d4736C10c465E0f73b2D9eCC1c0d94B#code) | [0xbfF3cd81fDf061D002A91dE3cD589E814AfdC94a](https://sepolia.arbiscan.io/address/0xbfF3cd81fDf061D002A91dE3cD589E814AfdC94a#code) | 
|MLDSAETH | [0xa3B09eF2A08f5EF5EB1C091d41a47A39eCB87433](https://sepolia.etherscan.io/address/0xa3B09eF2A08f5EF5EB1C091d41a47A39eCB87433#code) | [0x238045D114024576bf75700aa0eCFEfb47EF764F](https://sepolia.arbiscan.io/address/0x238045D114024576bf75700aa0eCFEfb47EF764F#code) | 
|FALCON   | [0x8f44FC27b333F0064f13a8c5e3451d4f65D75E60](https://sepolia.etherscan.io/address/0x8f44FC27b333F0064f13a8c5e3451d4f65D75E60#code) | [0x5Ce696b0F838C70A64be9D3Ee9017f35A4CBb091](https://sepolia.arbiscan.io/address/0x5Ce696b0F838C70A64be9D3Ee9017f35A4CBb091#code) |
|ETHFALCON| [0x544F59a8Adb31818bfcFEA4759DD8495aFF2E30f](https://sepolia.etherscan.io/address/0x544F59a8Adb31818bfcFEA4759DD8495aFF2E30f#code) | [0x8B210Cd6E66a5d6EABD50cefE8Ef66A0e5b3e7a2](https://sepolia.arbiscan.io/address/0x8B210Cd6E66a5d6EABD50cefE8Ef66A0e5b3e7a2#code) | 
|ECDSAK1  | [0x70b7bB1CD374768Af0d2Ad76aB7EBD0Aca4b54d6](https://sepolia.etherscan.io/address/0x70b7bB1CD374768Af0d2Ad76aB7EBD0Aca4b54d6#code) | [0x51dD569c0A1be3Ed093992dc8745cf324d203bb5](https://sepolia.arbiscan.io/address/0x51dD569c0A1be3Ed093992dc8745cf324d203bb5#code) | 

The hybrid verifier contract is provided for both testnets:
- [0x48237092dFe6387B1d7D2AacDA42bc43EdA44aEa](https://sepolia.arbiscan.io/address/0x48237092dFe6387B1d7D2AacDA42bc43EdA44aEa#code) (for Arbitrum Sepolia),
- [0x78E229b83378DF8A9AC1164156b542eBbDE2a1D5](https://sepolia.etherscan.io/address/0x78E229b83378DF8A9AC1164156b542eBbDE2a1D5#code) (for L1 Sepolia).

### Example of user MLDSA PK contracts
MLDSA public keys are large and we decided to write them inside contracts. Thus, each user needs to submit his (20kB) expanded MLDSA public key as an initialization step.

We provide an example of public key contract for both MLDSA and MLDSAETH, on the two testnets:

|Expanded PubKey Example for|Address on L1 Sepolia | Address on Arbitrum Sepolia|
|-|-|-|
|MLDSA   | [0xCc28B19d743F3E139D6D8078B6600bad95CD7B2c](https://sepolia.etherscan.io/address/0x898Fec6390D8297BC0C92F834E4210a821ccD8B8#code) | [0x8e130f25f30c9375971c9469f2adc30b6e91846f](https://sepolia.arbiscan.io/address/0x8e130f25f30c9375971c9469f2adc30b6e91846f#code) |
|MLDSAETH| [0x898Fec6390D8297BC0C92F834E4210a821ccD8B8](https://sepolia.etherscan.io/address/0xCc28B19d743F3E139D6D8078B6600bad95CD7B2c#code) | [0xa854bf182dd854c7b85e35566aa5a46678e2be37](https://sepolia.arbiscan.io/address/0xa854bf182dd854c7b85e35566aa5a46678e2be37#code) |
