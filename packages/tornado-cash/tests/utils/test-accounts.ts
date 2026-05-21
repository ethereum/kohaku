/**
 * Test accounts with known private keys for testing
 * These are standard anvil default accounts
 */
export const TEST_ACCOUNTS = {
  // Anvil account #0
  alice: {
    address: '0x6a1bC0045a10d8d245951EAF0771598245316530',
    privateKey: '0x85099c3bf25db5efa49ba23e4210b2ff8c5fdadfd937c0ea2d36bca91538d00a',
  },
  // Anvil account #1
  bob: {
    address: '0x8E6e86cb5e1220b80EB548D86FF5358cDDbcb083',
    privateKey: '0xf3f580a85b83567cf17abf6e225fcaed35ccad9d24e57a91804441f1daefb3ea',
  },
  // Anvil account #2
  charlie: {
    address: '0x45f7A3b43B1d1abA3FbA9269D4ead8beDc081f9e',
    privateKey: '0x299241e4b73e84532af6b0f3fb0dd85ebb7c456bee8778ae6eae3ee99922dedf',
  },
} as const;

