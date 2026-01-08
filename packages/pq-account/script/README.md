# Deployment code

In order to deploy contracts:
```
./deploy_fixed_contracts.sh <private_key> <abi_key> <contract_name>
./deploy_factories.sh <private_key> <abi_key> <contract_name>
```

- The private key is the wallet private key,
- The ABI key lets you deploy the code on-chain,
- The contract name can be obtained in `DeployFixedContracts.s.sol` or `DeployFactories.s.sol`.

## Deployments
Deployments of the verifiers (pre- and post-quantum) are provided in `deployments/deployments.json`. The ERC4337 account factories are also provided so that a user can create an ERC4337 account using only:
- the address of a deployed factory (provided in the above file),
- a pre-quantum public key,
- a post-quantum public key.

