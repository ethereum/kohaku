# @kohaku-eth/social-recovery

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Social recovery SDK for the recovery kit's contracts. It holds no signer and sends no transaction: every write comes back as a prepared call the integrator signs and sends, and every read goes through a provider the integrator supplies.

This release declares the SDK's interfaces only. The value records they take and return are placeholders until a later release replaces them, and no implementation ships yet.

## Installation

```sh
pnpm add @kohaku-eth/social-recovery
```

## Entry points

| entry | holds |
| --- | --- |
| `@kohaku-eth/social-recovery` | the core: the interfaces, and later the clients, the orchestrator, the builder and the wallet and passkey methods |
| `@kohaku-eth/social-recovery/recovery-methods` | the zkPassport and Aadhaar methods, which need the optional peer dependencies `@zkpassport/sdk` and `@anon-aadhaar/core`, beside the orchestrator |

## Interfaces

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
| `IProvider` | the integrator's chain access, four reads |
| `IRecoveryMethod` | the client-side half of one method module |
| `IActionCodec` | one action's payload layout |
| `IMethodCodec` | one method's config and proof layouts |

## Development

```sh
pnpm --filter @kohaku-eth/social-recovery build
pnpm --filter @kohaku-eth/social-recovery test
pnpm --filter @kohaku-eth/social-recovery lint
```
