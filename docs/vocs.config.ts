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
          text: "Introduction",
          link: "/privacy-pools/intro",
          disabled: true,
        },
        {
          text: "Accounts",
          link: "/privacy-pools/accounts",
          disabled: true,
        },
        {
          text: "Shielding",
          link: "/privacy-pools/shielding",
          disabled: true,
        },
        {
          text: "Transacting",
          link: "/privacy-pools/txs",
          disabled: true,
        },
        {
          text: "Proof of Innocence",
          link: "/privacy-pools/ppoi",
          disabled: true,
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
