# @kohaku-eth/social-recovery

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Social recovery SDK for the recovery kit's contracts. It holds no signer and sends no transaction: every write comes back as a prepared call the integrator signs and sends, and every read goes through a provider the integrator supplies.

The package ships the clients a wallet builds on: a setup client to commit and clear a holder's recovery setup, a recovery client to gather approvals and start or cancel a recovery, a methods orchestrator for the approving and enrolling side, and four recovery methods (wallet, passkey, zkPassport and Aadhaar). It also ships the byte formats and digests the contracts check, the validation and description helpers a UI shows, and backup encryption for a setup.

The contracts, with their design, scenarios and invariants, are in [`ethereum/kohaku-contracts`](https://github.com/ethereum/kohaku-contracts/tree/master/social-recovery).

## Status

- No public deployment ships yet. The Sepolia and mainnet descriptors carry zero addresses, so building without a `descriptor` refuses with `no public deployment ships for this chain; pass a descriptor`. Pass the descriptor of your own deployment.
- The shipped recovery action is the one for Ambire's `AmbireAccount` (`AmbireRecoveryAction`, `AmbireActionCodec`). Other accounts need their own action part, passed to `withRecoveryAction` and `withCodec`.

## Installation

```sh
pnpm add @kohaku-eth/social-recovery
```

The zkPassport and Aadhaar methods need their optional peer dependencies:

```sh
pnpm add @zkpassport/sdk@0.17.1          # zkPassportMethod
pnpm add @anon-aadhaar/core@2.4.3        # anonAadhaarMethod
```

## Building the kit

`SocialRecoveryBuilder` constructs every part over one provider, one account and one deployment. The holder's side gets the three clients:

```ts
import { SocialRecoveryBuilder } from '@kohaku-eth/social-recovery'
import { zkPassportMethod } from '@kohaku-eth/social-recovery/recovery-methods'

const { setupClient, recoveryClient, methodsOrchestrator } = await SocialRecoveryBuilder
  .from({ provider, account, descriptor })
  .withMethod(zkPassportMethod())
  .build()
```

`provider` is your `IProvider`, `account` the holder's smart account and `descriptor` your deployment. The wallet and passkey methods are registered by default; add the zkPassport and Aadhaar methods with `withMethod`. An approving or enrolling page has no provider and no account, and builds only the orchestrator:

```ts
const orchestrator = SocialRecoveryBuilder
  .from({ descriptor })
  .buildMethodsOrchestrator()
```

`withPolicyManager`, `withEventManager`, `withRecoveryAction` and `withCodec` replace a shipped part with your own. `withSignerRecovery` hands both clients the signer recovery that `inferRemovedKey` reads.

## Recovery methods

| method | entry | device binding | peer dependency |
| --- | --- | --- | --- |
| `walletMethod()` | core | `none` | none. Guardians enrolled by address sign typed data |
| `passkeyMethod()` | core | `browser-authenticator` | none. WebAuthn with a P-256 key |
| `zkPassportMethod(options?)` | `./recovery-methods` | `external-app` | `@zkpassport/sdk` |
| `anonAadhaarMethod(options?)` | `./recovery-methods` | `in-browser-prover` | `@anon-aadhaar/core` |

Pass `deviceBindings` to the builder to name the bindings your runtime meets; a method whose binding is not met answers `device-unavailable`. The zkPassport and Aadhaar methods take a `devMode` or test stack for development; see their option types.

## Entry points

| entry | holds |
| --- | --- |
| `@kohaku-eth/social-recovery` | the core: the builder, the setup and recovery clients, the methods orchestrator, the policy manager, event manager and Ambire action parts, the wallet and passkey methods, the formats, validation, descriptions and backup encryption |
| `@kohaku-eth/social-recovery/recovery-methods` | the zkPassport and Aadhaar methods, which need the optional peer dependencies `@zkpassport/sdk` and `@anon-aadhaar/core`, beside the orchestrator type |

## Parts

| part | what it is |
| --- | --- |
| `SocialRecoveryBuilder` | constructs the kit's classes from the holder's or an approver's inputs |
| `SetupClient` | validates and describes a setup draft, prepares the commit (with the arming write and the backup) and the clear, confirms a commit landed, restores the standing setup |
| `RecoveryClient` | opens a recovery or cancel gathering, cuts approver requests, files replies, assesses the rule, completes the request, prepares the start and cancel calls |
| `MethodsOrchestrator` | the approving and enrolling side: builds each approver's context from a request alone and reads no chain |
| `PolicyManager` | the manager's writes as prepared calls and its views decoded, plus the method module reads |
| `EventManager` | the kit's log filters, a chunked fetch through your provider, and decoding of the kit's events |
| `AmbireRecoveryAction`, `AmbireActionCodec` | the recovery action part and payload codec for Ambire's `AmbireAccount` |

Helpers on the core entry: `validateSetup` and `validateRequest` return every error and warning a draft or request reaches; `describeSetup`, `describeRequest` and `describeStatus` return what a UI shows; `decodeRevert` names a revert of the manager, the action or Solidity; `sealBackup` and `openBackup` encrypt a setup backup (PBKDF2-HMAC-SHA256 at 600,000 iterations, AES-256-GCM); `inferRemovedKey` names the key a handover removes. A client that refuses throws `KitRefusalError` with its `findings`.

## Interfaces

Every part implements one of these, so an integrator can supply their own.

| interface | what it is |
| --- | --- |
| `ISetupClient` | the entry a holder's integrator builds while the holder still holds their key |
| `IRecoveryClient` | the entry built when a key is lost, to gather and submit a recovery or a cancellation |
| `IMethodsOrchestrator` | the approving and enrolling side's entry, which reads no chain |
| `IPolicyManagerInteractor` | the shared part that prepares calls to and reads the policy manager |
| `IMethodModuleReads` | the read seam over the manager part's three method module views |
| `IEventManager` | the shared part that builds the log filters and decodes the kit's events |
| `IRecoveryActionInteractor` | the shared part that reads the recovery action and disarms it |
| `IRecoveryActionArming` | the arming seam the setup client alone receives |
| `IProvider` | the integrator's chain access, six reads: `chainId`, `call`, `logs`, `block`, `code` and `transaction` |
| `IRecoveryMethod` | the client-side half of one method module |
| `IActionCodec` | one action's payload layout |
| `IMethodCodec` | one method's config and proof layouts |

## Development

```sh
pnpm --filter @kohaku-eth/social-recovery build
pnpm --filter @kohaku-eth/social-recovery test
pnpm --filter @kohaku-eth/social-recovery lint
```
