import { defineConfig } from "vocs";

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  title: "Kohaku",
  titleTemplate: "%s · Kohaku",
  description: "Privacy-first tooling for the Ethereum ecosystem",
  rootDir: ".",
  editLink: {
    pattern: "https://github.com/ethereum/kohaku/edit/master/docs/pages/:path",
    text: "Suggest changes to this page",
  },
  sidebar: [
    {
      text: "Getting Started",
      link: "/getting-started",
    },
    {
      text: "Privacy in Ethereum",
      link: "/privacy",
    },
    {
      text: "Best Practices",
      link: "/practices",
    },
    {
      text: "@kohaku-eth/railgun",
      items: [
        {
          text: "Introduction",
          link: "/railgun/intro",
        },
        {
          text: "Accounts",
          link: "/railgun/accounts",
        },
        {
          text: "Shielding",
          link: "/railgun/shielding",
          collapsed: true,
          items: [
            {
              text: "Shielding",
              link: "/railgun/shielding",
            },
            {
              text: "Unshielding",
              link: "/railgun/unshielding",
            },
          ],
        },
        {
          text: "Transacting",
          link: "/railgun/txs",
          collapsed: true,
          items: [
            {
              text: "Internal Transfer",
              link: "/railgun/txs#internal-transfer",
            },
            {
              text: "Defi & Other Smart Contracts",
              link: "/railgun/txs#defi--other-smart-contracts",
            },
          ],
        },
        {
          text: "Proof of Innocence",
          link: "/railgun/ppoi",
        },
      ],
    },
    {
      text: "@kohaku-eth/privacy-pools (WIP)",
      disabled: true,
      collapsed: true,
      items: [
        {
          text: "Tech Design",
          link: "/privacy-pools/tech-design",
          disabled: false,
          collapsed: true,
          items: [
            {
              text: "Deterministic secret generation from a Signature",
              link: "/privacy-pools/deterministic-secret",
              disabled: false,
            },
            {
              text: "Signature-Base Derivation Implementation Guide",
              link: "/privacy-pools/signature-base-derivation",
              disabled: false,
            },
            {
              text: "Relayer batch quoting",
              link: "/privacy-pools/relayer-batch-quoting",
              disabled: false,
            },
            {
              text: "Note selection algorithm spec",
              link: "/privacy-pools/note-selection-algorithm-spec",
              disabled: false,
            },
            {
              text: "Detailed user stories",
              link: "/privacy-pools/user-stories",
              disabled: false,
            },
            {
              text: "Privacy methods specification",
              link: "/privacy-pools/privacy-method-specification",
              disabled: false,
            },
          ],
        },
      ],
    },
    {
      text: "@kohaku-eth/tornado (WIP)",
      collapsed: true,
      items: [
        {
          text: "Introduction",
          link: "/tornado/intro",
          disabled: true,
        },
        {
          text: "Notes",
          link: "/tornado/notes",
          disabled: true,
        },
        {
          text: "Transacting",
          link: "/tornado/txs",
          disabled: true,
        },
      ],
    },
    {
      text: "@kohaku-eth/extension",
      link: "https://github.com/ethereum/kohaku-extension",
    },
    {
      text: "@openlv/connector",
      link: "https://v3xlabs.github.io/open-lavatory/",
    },
    {
      text: "@a16z/helios",
      link: "https://github.com/a16z/helios",
    },
  ],
  topNav: [
    {
      text: "GitHub",
      link: "https://github.com/ethereum/kohaku",
    },
  ],
  socials: [
    {
      icon: "github",
      link: "https://github.com/ethereum/kohaku",
    },
  ],
  theme: {
    accentColor: "#D01C15",
  },
  // banner: {
  //   content: 'This project is still under active development.',
  //   dismissable: false,
  // },
  iconUrl: "/kohaku_icon.svg",
  logoUrl: "/kohaku_logo.svg",
  basePath: "/kohaku",
});
