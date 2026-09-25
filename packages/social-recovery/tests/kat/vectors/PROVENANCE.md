# Provenance of the blessed vector copies

- Source repository: `defi-wonderland/mast-social-recovery-2` (private)
- Source path: `design/kats/*.json`
- Source commit: `2a12948d47881f43bbe32f3c4b3b82dbdc89efdd` (`origin/dev` at copy time)
- Copied: 2026-09-25, byte for byte with `git show <commit>:design/kats/<name> > <name>`
- Not copied: `design/kats/README.md` and `design/kats/reference-contract-kats.mjs`

The owner blesses each vector file by hand in the MAST repo. These copies are
test fixtures: they are never edited, never reformatted and never regenerated
by any implementation or script in this repository. A change to a vector
enters as a design delta in the MAST repo first; only after that delta lands
are the affected files copied again, and this table and the source commit are
updated in the same change. `../provenance.test.ts` fails if a listed file is
missing, if its sha256 differs from this table, or if an unlisted `.json` file
sits in this folder.

| File | sha256 |
| --- | --- |
| `ambire-handover.json` | `a572f456e55dc76697cba2bea9dcb301abe488a9d80529edf54637f361fdc548` |
| `ambire-kit-slot.json` | `229695028bd9c9145ad5210428b72a761542976e0d66f0db16b2290024ac5900` |
| `approval-digest.json` | `ea328d6135d43029b4e1944d85b7ecfdc270f3c95c78d8ab04f4efc6b3825576` |
| `attempt-request.json` | `d26faf1ae62899cb299acb6bdcc39d7d4d3fb26008824f5a0f456dd09ebab1b3` |
| `cancel-request.json` | `450c9e40ca7e4effe7becbc90066c5588f91c194efc586083d7dd801c567527b` |
| `cancellation-digest.json` | `15120e36b369acf2e7aeeb074b89ebf16d345c7a04a6e04022ae52ff31c3b174` |
| `credential-commitment.json` | `98d9aab9ef4378f1d66a9ad25fa8b271ab9692cf2df06f620c45595a1541333b` |
| `manager-events.json` | `84fcf9a6173d59ef8b4d17f931406df0bb4ee1f91ea45100010cf233277ff4cb` |
| `method-aadhaar-config.json` | `922c66b44b2af11d40c1b27148d999394cea27eb0ab543373b0b9082f9add5f0` |
| `method-aadhaar-proof.json` | `fcdd49e2329819b78726ecf0a8c8b54382c6f48e91c708a9894fcdc11e5b26a6` |
| `method-ecdsa-config.json` | `2d8f59f4d69bba67f0cfa9c015873e7bd614febaccd71b5b8013c0d511d1b8d5` |
| `method-ecdsa-proof.json` | `7e563cba814b27dc9eb9fc203d7d2296b601f324454d5dcfa310c5ee78cc06b7` |
| `method-events.json` | `cab59a0f393e493102982f07ecf77b52cac6d7a8c01a3f8c3d15a6712dd2de91` |
| `method-passkey-config.json` | `d9a213be385afe8c37c65937b328f1f19f3a8769b80995bf9fa3ec4699324438` |
| `method-passkey-proof.json` | `f4b2e7845c89008fdf1ee78835c551852f257aa46e558bf0ddce2b0ba6e09954` |
| `method-verdict.json` | `6bf4e6e6a21a0164be134854ab61b24280a234fb9ee1ff15dc1a4cbce3e0f4b9` |
| `method-zkpassport-config.json` | `e966a56cc37d8fcd43453ea1c98188819eec5e2a7a9cb4676568d175c0f1be71` |
| `method-zkpassport-proof.json` | `e54392c199d596ccc634cfc49c3e317f0e98135bfe4ca47f7199b29e62cd77cd` |
| `payment-order.json` | `860bbc77572714a908a9de0481bb240cdfa9282446a5c9cb14247b89dfde9c91` |
| `proof-place.json` | `bcaa1f63f466680be31109e4db4a7e63e4bf7cbfaf228e0cee3377ec3d76be55` |
| `setup-body.json` | `600110033752e0ebb298673c46db0eb670afc7b000166927293c2fa3976b7ce0` |
| `setup-commitment.json` | `17d43ac17898e8e21ff4de3b3e056fd85aa94b07ba2424569307bad52641415e` |
