# @kohaku-eth/stealth

ERC-5564 stealth addresses (scheme 1, secp256k1 with view tags) and ERC-6538 registry calldata helpers.

A stealth address hides one thing: that the receiving address belongs to the recipient. The sender, the amount and the timing stay public.

## What is in the box

| Function | Side | What it does |
| --- | --- | --- |
| `parseMetaAddress`, `encodeMetaAddress` | both | `st:<chain>:0x<spend><view>` with two compressed keys |
| `generateStealthAddress` | sender | one-time address, ephemeral public key, view tag |
| `nativeTransferMetadata`, `encodeAnnounce` | sender | calldata for the canonical Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| `decodeAnnouncement` | recipient | parse an Announcer log |
| `checkStealthAddress` | recipient | view key only scan, with the view tag prefilter |
| `computeStealthKey` | recipient | `p_spend + s_h mod n` for a matched address |
| `encodeRegisterKeys`, `encodeStealthMetaAddressOf` | both | ERC-6538 registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` |

Only `@noble/curves` and `@noble/hashes`. No network calls, no key storage: the host wallet supplies keys and logs.

## Not in this package (follow ups)

- Key derivation from the wallet keystore (the CLI paths `m/44'/60'/0'/5564'/1'/0'` and `.../1'/1'` could move here).
- Receive side withdrawal defaults (H1 to H5) proposed in #324, as a separate check module with the conformance vectors.

## Test

```shell
pnpm --filter @kohaku-eth/stealth test
```
