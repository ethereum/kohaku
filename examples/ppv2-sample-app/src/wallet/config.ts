/**
 * WALLET SIDE — assembling `PPv2PluginParameters`.
 *
 * Everything deployment-specific comes in through these parameters so the
 * plugin hardcodes no environment (FR-002). All fields are plain JSON-able
 * data — no SDK value imports are needed to build them.
 */
import type { PPv2Factories, PPv2PluginParameters } from "@kohaku-eth/privacy-pools";
import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111n;

/**
 * Pinned circuit-artifact manifest: CID + SHA-256 per circuit, for every
 * circuit of the CURRENT V2 SEPOLIA DEPLOYMENT (temporary — replace when the
 * deployment or circuits change; values mirror the SDK's default manifest).
 * The wallet ships this and the plugin fetches + integrity-checks the
 * artifacts from the IPFS gateways (FR-040, DEP-3).
 */
export const CIRCUIT_MANIFEST = {
    deposit: {
        wasm: "QmbFwUiZywpkCd9AYr3xiVJN2K99ma7raz5FvAS8A8j8DD",
        wasmSha256: "0x833e7b3c44a900a95496009a36284e11f57ba0385fab6b63f92075750817550a",
        provingKey: "QmapgvDJc2ZSA3FLi9YwA7vd7QNThD2LKa17Zyn4pnDQ6S",
        provingKeySha256: "0x0e64b6d15ea540b3ab04d5596ab45d1ed6df0872e0261a850039372104837b30",
        verificationKey: "QmPiRu7icgKrxer7DRHwiWHwpyT2UxCfm475FSA5z8APuM",
        verificationKeySha256: "0xcc0c1647983f2ca75b192e5c671b9b2932fd690709922bf32443a4053cd0912a",
    },
    ragequit: {
        wasm: "QmfJSLSutPLJgRbtmothHAn3jFpKmXUwFnAdjecCEmJFQz",
        wasmSha256: "0x95108046f922d9cb08a1d4e42c88708af03233551a5e13a7118d7a6eff5d31c4",
        provingKey: "Qmeqe43QyQcASay6pkAw66N3ceSWNipVYShbd2hLvHxfZD",
        provingKeySha256: "0x3b0d2c3fdf26363be409dc4f01f5beb1c3cbc3b07a0c1ddb9e825e22e46d9bf4",
        verificationKey: "QmP46yuoVXH2KyqMBkkCviTzDqUELiRmAPJDic6P4oUeEn",
        verificationKeySha256: "0xd285bf7a8f2e38d206c5513771d80816969c75b87558df194c1804ed1ec484d7",
    },
    transact_1x1: {
        wasm: "QmYLFBpsJzeKXDfxcKdwz4rrhZTDoWiYyHNkDyreFrFrau",
        wasmSha256: "0xbd13ab4130320f095cdee83b42e27877fc6c17f18be3fbdfc55436d33689d262",
        provingKey: "QmTwJqccgYF7bVvVDVHFGnB96tXQLyhRLohaFm3drKs1hr",
        provingKeySha256: "0xba00dc63d1ef0b09a49dbf9348430362ef18dca5309ad5b6f06a896349c4c80a",
        verificationKey: "QmfN4QBhkz5NAoo9yd4L8gKjNkap2R4LSKE6yVNS26m4Rh",
        verificationKeySha256: "0xe429d3e895de5cc9d2839a3fd8303fadd30be3759bac06ce7fb063ceda198308",
    },
    transact_1x2: {
        wasm: "QmYmzdZR25VGfXnfsKY3tjm4ymjbCt67pgnhdqDBDwvxPR",
        wasmSha256: "0x71ffcdc53e5808c89ebf735ef45d0ffabfce9e6f640d565adc4f02e36ad1a72e",
        provingKey: "QmUrciJbUu12kwTPxJEwPHmBT9pgeLkxeG1y4agCuMpFFu",
        provingKeySha256: "0xf107598438dee56e053d76724500a58f91457fec14df0f4ee057042a1025bf07",
        verificationKey: "QmRyrzFTq7gGcTcBtAnvA6WLBpX1Csi6SZSSJDgDQLjXFi",
        verificationKeySha256: "0x3bb6f18aa4fec0961151fdc21a74ad9ca7326356cd4a4151b3e808dc12e30ad4",
    },
    transact_1x3: {
        wasm: "QmWQb92RQwmycPnfF1zGREU5Ss6N1wEx1e3nm47vioNcqB",
        wasmSha256: "0x730ae4756ba37489137ac82e117e1169f6cc8137a17f4733c779dddc69de1158",
        provingKey: "QmZbWNwb34sv8a3cZ6fjCNHqbCoDoHgPRep7En11ocbqqF",
        provingKeySha256: "0x55341d648bbf61e896f9a5b80bfd3c873a271eb515b77575a78a079c5b772e35",
        verificationKey: "QmRzofJFYKQWLrRzRwi3gfygVDSFqS5QrW8Vnurtm75MAq",
        verificationKeySha256: "0x08f505c4899958c9f0a4b7b131d20223f5e4da0cac0fdb0da22b51e84d1515c9",
    },
    transact_1x4: {
        wasm: "QmS3DpwFrttLtbHzW995ifAgeXiuL2QHzABE9v8DZ7FG1v",
        wasmSha256: "0x9da4a23f8fdf1bd22db6f2a06ee3b26d6058451eecf0fba99707df14bd7d5d4f",
        provingKey: "Qmaqv6cKbtbV7Y9a55mx9cAzXqQ1dBALVMXbzaLpxftMWU",
        provingKeySha256: "0x866d2aad434ff2dff38774a6d82afeb71046eb73be87ea3ffb35401d94080d02",
        verificationKey: "QmSxB8KzLiY78xQjhKp5XTLwSwAzVdraG5q7pKYJ2znCXr",
        verificationKeySha256: "0x68418087e3ecdc7d43d3db0c8684e689d5e2f4f16d12047c7403baffffa054f7",
    },
    transact_1x5: {
        wasm: "QmNwpbM9sX62pTLRrZnvBvRmjos57dm6ZGqkVLdXdqQW9v",
        wasmSha256: "0xd18ce1511bc8a3e80229381e7b3b2f226106fc044579b2460a3bf2d4dcfe415e",
        provingKey: "QmdPdM8t6muNkrALfQjhW5ctpGTLjiYY7fhwebnwuTa4zS",
        provingKeySha256: "0xde372dce472d9794dfd1ceac28bd3252dfe6b4eb233074d5d9f9ac1e42c45bfe",
        verificationKey: "QmRt6cSCwDQ7kVJEJ1Tr2yyFxWQSiji3kt3GkH22qmqdut",
        verificationKeySha256: "0x009e6668a8063a8ffcad41fd3baff9ee7296de0f234522b41f4490ab11986c57",
    },
    transact_2x1: {
        wasm: "QmUYpWth4Mu9LTziML5sqFpVixkWAYbricd6o5Xid1ksrW",
        wasmSha256: "0xa1fa16ad0824fe40df716e8bfd0716effad68dcb1ce81f108db596e6a752f15c",
        provingKey: "QmS2fG8MQhFQVKiRt29dBCSyGNipNspn5kz4T6D6689E8N",
        provingKeySha256: "0xadd0ae7441be69dc7d25cc76fe8afb43c47511c134834ecbf76eff4451e6e1b2",
        verificationKey: "QmZn6fcEYdLtzWGr94B3WjdFfwhR9JcafRib7kzeM1sgoG",
        verificationKeySha256: "0x4c5e51b308829a549b54d6d898556a3bf8e40656173919597564cd674997c333",
    },
    transact_2x2: {
        wasm: "QmZCCa4bMxB4XesiRQ8Nnxz3PHCdqR9wB14NYz1aaoGmGt",
        wasmSha256: "0x578a1241233edffba81ca58c2fd0af48aa6434bd5a667caf02a5e3393a1b3664",
        provingKey: "QmYu1XoUzMAjH4JdUiXdSiRTfgpEDVRceHohhLGigMK8b4",
        provingKeySha256: "0xf7c133fd906dae36c88e1052777f03747288c9d4bec2023bf5cd37d315f83355",
        verificationKey: "QmTTH1rkq5TVa4z1KQVL3RqvDJhF7xcbbYHARKrCHidGE3",
        verificationKeySha256: "0x73bc886a46bf4b27e84955960964bc6b622c751504baeb49825de4f6eda8b0ca",
    },
    transact_2x3: {
        wasm: "QmcoUX2PMzpjE5DEWhMcnfvAZ9tyJVH7RYMkZC6Sf1cSib",
        wasmSha256: "0x54b9f706c15eb91ea8b2012c6ebac1eb6b4e1a4ff8ce299d039aaeda57e52ff5",
        provingKey: "QmXUmyag1w7iwGu44tWe1LBeLBirAwPVQReUL6LpfUm4rE",
        provingKeySha256: "0xc713b515a2caaa10129aaf32862eaf1f791531d2f0ededcdf8532cc5aae5ce71",
        verificationKey: "Qmb9K98pEGjW9F8utif3p55jzDrpg3Uzt1k8BxnuSfGrAP",
        verificationKeySha256: "0xa1ea01f4164790f6073f93d0f7875b8fba536373ad441fa7db08d6539dc09a0d",
    },
    transact_2x4: {
        wasm: "QmWmTFCKyTNKkZB9FJBUBsysQkpwWzYFpXZrbLu2takMFG",
        wasmSha256: "0xfe2ae55994b8cca10f27d821ca9551507351cac6960c435e6cca9d643df6a749",
        provingKey: "QmeYshTAGnkcNd7dLcvSy1VxfwNNnWQw6PFmnfX24P5jQZ",
        provingKeySha256: "0xa7ca0b0fbe6fb057d288d504aefdf58efae82dddfcb9c53055f7c1016c8455db",
        verificationKey: "QmZ1VRBgPF9tcYiKWwrCBndYEYi9ADH6uQ738yuTkEzRxQ",
        verificationKeySha256: "0x39da36ea93eadc618934f63028e44f2f7d2ce0019d5e123e46351ccf0abe74bb",
    },
    transact_2x5: {
        wasm: "QmQJdT6WVZjGopELtWZKXNSEzSBgNizPjMh9dG4FysN3CJ",
        wasmSha256: "0xc3e4aab1bc435fd6a4dbbd18c4f26a38efba01412e1f8e675aa2d6ba82fc62ce",
        provingKey: "QmYqAUJ3sjtbbKtmXuQuiVCBwsfg2x9yuDDH7qJR9AzDMT",
        provingKeySha256: "0xc26d09d6c257998d9a71c254ebb2081557e12047db40bc7bd1352bb8177aa588",
        verificationKey: "QmY8qxktGku4rZDKMyaUNJgksWTyJGRhxAxB9yVQjgvDz3",
        verificationKeySha256: "0xd8c7afa6e39bfdedcb3cad4dcc525f1b8aa9e31058c3810df6d17e7dc209b922",
    },
    transact_3x1: {
        wasm: "QmNvWa2CbCwETuCn8nJhGTYuV23X5P6D1HjHKvZsNH6c1c",
        wasmSha256: "0xeac116e10e378f20d5e21d2bba6cd202e0a74706be3a21582b7681b9d197bc63",
        provingKey: "QmNQSgwBV9dvqX4a61auUNENwabrvzi8jH1Zq9ekyRqztG",
        provingKeySha256: "0xfb8088772dc632cae1fe10e5eb91138364c7769641684efa75491cfc68c9c940",
        verificationKey: "QmS6AErmyaXRoXw8E5XzWBBGQRi4wwXbr97kwgRDRzctEX",
        verificationKeySha256: "0xeec06c6c929c97db7ad7824d0ed6c52bb786a760362e063b8375810c0389236d",
    },
    transact_3x2: {
        wasm: "QmQc3n5zGPHZGq3nCqPd94QChQFam86GcfEj7ojWmH8p1X",
        wasmSha256: "0x6b195b1419c9ff97e66958d694c0441aa4a9d44afa09bccb43ed1a6a5addcbfa",
        provingKey: "QmTpuhSmXSovjXc7i8sgc5K6ygQife8hZNxJnXUKHHJT28",
        provingKeySha256: "0x8e7e260ee5fd54eb8a7de7836a2747487078096d5acd65bdccd806468521bc64",
        verificationKey: "QmVdCWHT1ybdA4pMSMLtjBHnzUdWLZ9FKi12zVB7hKqbwn",
        verificationKeySha256: "0xd1232a8bf31390df81f9a65df4f524c40b19430f3b703842f76b76bce0f403a0",
    },
    transact_3x3: {
        wasm: "Qmcw59WSBfL3spdia8cyX5QhFJCjW8rPpHPkNQryCSuVhz",
        wasmSha256: "0x2d4fb8533f62944433ebb58063172ee112580f419291b222037ec7c4e8542552",
        provingKey: "QmS93hHQnpAsYPQG7Jiw2zWJBS5HwzzVHn3JE4KS29cge8",
        provingKeySha256: "0xaa6d8ba5aa947a773c68c93ba575007c5b4f6dce3c6dbafca4284a365a013159",
        verificationKey: "QmPZM7fgpTds5xocL9pcKy2zKtG5MopstXJcpUe2V14mPJ",
        verificationKeySha256: "0xd1a0bcc9c52e92d13aa84d4bee51a02e4808779015a5e45ddcdab97c2e9d2fd6",
    },
    transact_3x4: {
        wasm: "QmboCMo6BrSDWcpAPWnZCW2aj25y4eKRwQbM3h7zf4CZi9",
        wasmSha256: "0x66e48b0228c1c54ce720b9b2cf8ec0ac0c8ce877fc4806323e58c7b6bfff23fd",
        provingKey: "QmTfzhkm2vQWFMSvHbRScfCNDbZa1v5p6NNqCYsaHPTMTJ",
        provingKeySha256: "0xf01bf123b98e827efda24ca17f620904ad31b79bd1730b9d2e60c119a425a406",
        verificationKey: "QmfXbSExDAzCej8PREQEo5c5Dea4to7T5cQVGwzbnDQXnF",
        verificationKeySha256: "0x9be6797e352e4e2b0f7a5ea3f4419555aca61abbc157dddd21c1ab8fa1eaa27a",
    },
    transact_3x5: {
        wasm: "QmQZiYCCNEBD7KfHdChDt8ynMEsppi3SiM5ARiZqdca6aM",
        wasmSha256: "0x6f9dad7ebae38dec783bea9a9bd30059739a9cbce0591a3699d4415f2b723927",
        provingKey: "QmcodnexWuqmPhTjWTEVZuBkgQzCdvtG44BTHYXj3XELxY",
        provingKeySha256: "0xf64f99b2f7e4cdc5069f6b3dd9ebd9b903b14dc53fcf197a53317998312a3345",
        verificationKey: "QmPc9UvfyYRv4UcM5xvJgMb5z5qyQpmMt7EwVAXmdnJ1jW",
        verificationKeySha256: "0x76ce8edf07ec6ada81ebb14f0c2a37c7d2af1ca076c432274433b83dde6971c6",
    },
    transact_4x1: {
        wasm: "QmPUqbuZfj23dDNH8PEF5kT3Fkr4yrzEhF7vZf6Jt5ryj3",
        wasmSha256: "0x750789200ed6a56222cf99c80af9ddccaa76081745375a008b0daa7f93345ac1",
        provingKey: "QmWtXsV6WCAHgME8ebxaeoV2Rd9HHFTcHD7beVXZT7tnpg",
        provingKeySha256: "0x848392fb4a9f17b40f26ef03a166e4e8bf47b9fe0ca6abf28c9fc75130324f9e",
        verificationKey: "Qme4sqejTEH8dP7u6XJ9rPVuAey2XaXC6A4qHeJi8DY76M",
        verificationKeySha256: "0x23df18b1458bce6c3d0548a19b2b190b1a189e18404f3eb5948208d07646a7ef",
    },
    transact_4x2: {
        wasm: "Qme6URSD5ndGEN7ApHyPzqAk9sh2Xn1DLq67aarVjmTACN",
        wasmSha256: "0x04aa1d270a361fbc7dc97d67204ec661599a70b9306739ae4b242a2b7e1cf086",
        provingKey: "QmZLyCwrMcfRwBkVEJasKjVxmLXJPuDsfxZUPJrnBLQygc",
        provingKeySha256: "0x46fdf80212238d9c29bf4b1d07c9388eef5acdf1d7fa9a39facb52fa13709870",
        verificationKey: "QmeRVAqhopEjhQoJ7PTRDtnR1DUViGmUaskzSxrSBLMkhj",
        verificationKeySha256: "0x7b0812c2eb2c06762f2c87bb2da39567274c300db13cf23f53f6e67e8b8f0d37",
    },
    transact_4x3: {
        wasm: "QmP3QzYZL1sWeZdPz8xSkSTvEhBF9mNZL1qs5jAXM3pjD4",
        wasmSha256: "0x34e52ec95243118e558985eb6e671f0c03cac2feac517125f7a12eb3c85f5b37",
        provingKey: "QmT951angX69LcajUQvjfyv4sDmmwfHTLEztgTUezi7UCa",
        provingKeySha256: "0xeea45acc23672f44c772a82801fad75f534f78e89af5530db6077bb1eb486998",
        verificationKey: "QmeyWrDGPNqTKSxJxcAtGVrAaPsFLaM6yXBHBniGbqW7V6",
        verificationKeySha256: "0xcf41e31009b034ec296220e7ea08f8f9b4d3c2b78d4bb11434a2f41c62c59913",
    },
    transact_4x4: {
        wasm: "QmSQzARopjufLCiJJm7UwoQesBykfAPp3hgggoNexvT9Xj",
        wasmSha256: "0x9d300515c9d1eb894ba14de0d336602c5abfcf8dc3aba058fb80e94be63e8278",
        provingKey: "QmZ9aRCDKVXhbyXqnnkwhc81tCXZjEcjGgvwCeTRDt7YYj",
        provingKeySha256: "0x6eac71fe752e456a6796499608174bd4a43e103a4e6236f1d4cf00d1581fd114",
        verificationKey: "QmarUMB5vVxeFarf3bn4vNx4e7voP9YvuiMzVuF7fq2DS1",
        verificationKeySha256: "0x31e31961239ae864e6c2f9a36d8aa8b719fb6e6dee28f0b916e071f7d255c476",
    },
    transact_4x5: {
        wasm: "QmdvSCBYp8KmQn1fXoXVCoSNnRK48YW3tPugwbu4cmqtst",
        wasmSha256: "0x6b0fa46c5281c542cdd03967a61e35be33b5b26368d1e0c0758c8e760a4f336d",
        provingKey: "QmevaJ6MBUbAKgRu5aeRquPfURE8iCH3MTLnZh5o3TGQVm",
        provingKeySha256: "0x11a537dd541eb978ec62a000c0603fecc5a977d68b23714dd0f5c0b280dc0320",
        verificationKey: "QmcZqn1otFFLsHhYYc3B6U7HH1Kg4vrSUPd2w3yqtfpYLe",
        verificationKeySha256: "0xc914523b571766f6e9b2476e6f2ec626f09cffcdcf1f67736f80b83b1e5c227a",
    },
    transact_5x1: {
        wasm: "QmSLhAjbPvZnmsKw6rdFKLkxSRRybQ7qC9ad4tJc71sCZD",
        wasmSha256: "0x97bcc3a093377fb05284c1fa4f4bf767cd31ff65b37a9939e3bf11490c2f3ea5",
        provingKey: "QmR3hcRgSAVDoLMd4S9653HFAHk1MhnwBGWPY9J2Qs8kEj",
        provingKeySha256: "0xce4d5c3262e75cd62a13981ec296d20cd02c636f05b708041add8662e1b4ff4f",
        verificationKey: "QmZo9os8UUB4Q4qjDUh1U47w6gSEDNfPWWim8DrLaypiwk",
        verificationKeySha256: "0x257bcbe7d6f2d7b34e6b85b588bd735a644d3692239f90709ec473dd7e5b91d6",
    },
    transact_5x2: {
        wasm: "QmafBCp4q6JBi32nf3mh9vRQweawDUinsnbE22LucwNdpX",
        wasmSha256: "0x0f17ff4ef508e5270445d8e31ba02a62e2f3a2641315de1fa3fc867d0204d3f3",
        provingKey: "QmSKkMCAQtocRa7fPALqjZZQV3LasANWmXijHedkyvq5Ry",
        provingKeySha256: "0x6ecc00526cbd5853f2d3403235260e60c4c01912c4d06a9b857a39ab14ca37a0",
        verificationKey: "QmbEvCLzYCBkSGeyKHWrB7NubZhNcPcq3uSjiTu6KZNVRH",
        verificationKeySha256: "0x1e20af3646579b56fae94a5f392eec5191ceb70cd4743759fa7d0fa0763d8e38",
    },
    transact_5x3: {
        wasm: "Qmef2WUpyDhR5D7zKfuL1E5B74j6aULwy8LMjPoTqG7T8s",
        wasmSha256: "0xd81f31dbdf4fc280b0ef623aa59f7f9de654d5c823ddbf42a2887a48e867edfe",
        provingKey: "QmT2U9WHbbQEYTngAG3gMzwvrapQLQkFA9tewLUpB4bpfi",
        provingKeySha256: "0xceb8bec785c9fef33ce420f104ae81edf838880eff9eca879ece98abef028bea",
        verificationKey: "QmcU2FE2x5eCriztMbJk1N7GaA3TN8Xru4FJiNHEGudzyJ",
        verificationKeySha256: "0x280fd06395ef063acef95fd1d65c82a9be5bb07242873a80c37678dd48626c35",
    },
    transact_5x4: {
        wasm: "QmVCaAbfa2X3kKwSdspdWsbxaymk9KGnR3CqD7M3sP5ysm",
        wasmSha256: "0x919b0f67f716b3ea8ad0ea193d99a780a9d0fea1f4061eab9a2a19002970ea73",
        provingKey: "QmcqjypfSkMjwwgAGEBhg6vv8jZBWfMwDKJs1sSg5syjSU",
        provingKeySha256: "0x887189fd878d023ed1d4af3ef4fb375224a81a890adc42283bdba6f2efb3aeb4",
        verificationKey: "QmSHCy7CEUsGJzbz51M1PDUQbK95DKAMPu78BXAUedEFBr",
        verificationKeySha256: "0xd39e30582223d89efb4811e95e79584061e7b4a8ab3ce9f6665162d6cacedfc0",
    },
    transact_5x5: {
        wasm: "QmT75hGWy2nHwzKytai279ZjAATiry6azbh2zra8dH7rva",
        wasmSha256: "0xb6c7632afb0624f09f1bd1c0a75e345a105a00e48ad4b545c03085292e37a188",
        provingKey: "QmcBjkr4V7cr1mygwcQHS2cE7LM1joTQ1UV5WsvEuH5GWQ",
        provingKeySha256: "0xb9bd7851765a209ed74456492b94e5b9f8d57b0899aa0f52113035761ee752ba",
        verificationKey: "QmbqqapZKBeQgCFuLUMwTLSTp5qQenRuTwyxZdrCMqWi61",
        verificationKeySha256: "0x3f3dde610b5ade3ffb10b2fb0b716c717ddc1f90b1811dc1aaada9437f869cfe",
    },
};

export type PluginConfig = {
    ownerAddress: Address;
    /**
     * Demo seam: the devnet's in-process ASP/relayer/prover/entrypoint. A
     * production wallet NEVER sets `factories` — it instead supplies real
     * `asp.baseUrl` (+ pinned `publicKey`, DEP-4) and a non-empty `relayers`
     * list (DEP-5), and the plugin builds the real HTTP/proving services.
     */
    factories?: PPv2Factories;
};

export function buildPluginParameters(config: PluginConfig): PPv2PluginParameters {
    return {
        chainId: SEPOLIA_CHAIN_ID,
        // The wallet account that signs public operations; also the instance id.
        ownerAddress: config.ownerAddress,
        // Contract addresses default from the SDK's DEPLOYMENTS map for this
        // chain; pass `deployment: {...}` to point at a custom deployment.
        asp: { baseUrl: "https://asp.demo.invalid" },
        relayers: [],
        artifacts: {
            gatewayUrls: ["https://ipfs.demo.invalid/ipfs"],
            manifest: CIRCUIT_MANIFEST,
        },
        ...(config.factories ? { factories: config.factories } : {}),
    };
}
