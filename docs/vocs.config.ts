import { defineConfig } from 'vocs'

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  title: 'Kohaku',
  titleTemplate: '%s · Kohaku',
  description: 'Privacy-first tooling for the Ethereum ecosystem',
  rootDir: '.',
  editLink: {
    pattern: 'https://github.com/ethereum/kohaku/edit/master/docs/pages/:path',
    text: 'Suggest changes to this page',
  },
  sidebar: [
    {
      text: 'Getting Started',
      link: '/getting-started',
    },
    {
      text: 'Privacy in Ethereum',
      link: '/privacy',
    },
    {
      text: 'Best Practices',
      link: '/practices',
    },
    {
      text: '@kohaku-eth/railgun',
      items: [
        {
          text: 'Introduction',
          link: '/railgun/intro'
        },
        {
          text: 'Accounts',
          link: '/railgun/accounts'
        },
        {
          text: 'Shielding',
          link: '/railgun/shielding'
        },
        {
          text: 'Transacting',
          link: '/railgun/txs'
        },
        {
          text: 'Proof of Innocence',
          link: '/railgun/ppoi'
        }
      ]
    },
    {
      text: '@kohaku-eth/privacy-pools',
      items: [
        {
          text: 'Introduction',
          link: '/privacy-pools/intro'
        },
        {
          text: 'Accounts',
          link: '/privacy-pools/accounts'
        },
        {
          text: 'Shielding',
          link: '/privacy-pools/shielding'
        },
        {
          text: 'Transacting',
          link: '/privacy-pools/txs'
        },
        {
          text: 'Proof of Innocence',
          link: '/privacy-pools/ppoi'
        }
      ]
    },
    {
      text: '@kohaku-eth/tornado',
      items: [
        {
          text: 'Introduction',
          link: '/tornado/intro'
        },
        {
          text: 'Notes',
          link: '/tornado/notes'
        },
        {
          text: 'Transacting',
          link: '/tornado/txs'
        }
      ]
    },
    {
      text: '@kohaku-eth/extension',
      link: 'https://github.com/ethereum/kohaku-extension',
    },
    {
      text: '@a16z/helios',
      link: 'https://github.com/a16z/helios',
    }
  ],
  topNav: [
    {
      text: 'GitHub',
      link: 'https://github.com/ethereum/kohaku',
    }
  ],
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/ethereum/kohaku',
    }
  ],
  theme: {
    accentColor: '#2563eb',
  },
  basePath: '/kohaku',
})
