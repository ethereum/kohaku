import { createElement } from 'react'
import { defineConfig } from 'vocs'

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  title: 'Kohaku',
  titleTemplate: '%s · Kohaku',
  description: 'Wallet developer guide for the Privacy Pools and Tornado Cash plugins',
  rootDir: '.',
  editLink: {
    pattern: 'https://github.com/ethereum/kohaku/edit/master/docs/pages/:path',
    text: 'Suggest changes to this page',
  },
  head: () => createElement('link', { rel: 'stylesheet', href: '/kohaku/styles.css' }),
  sidebar: [
    {
      text: 'Get started',
      link: '/getting-started',
    },
    {
      text: 'The host',
      link: '/host',
    },
    {
      text: 'Provider',
      link: '/provider',
    },
    {
      text: 'Privacy Pools',
      items: [
        { text: 'Shield and unshield', link: '/privacy-pools' },
        { text: 'Configuration', link: '/privacy-pools/configuration' },
        { text: 'Withdrawals', link: '/privacy-pools/withdrawals' },
        { text: 'Notes and history', link: '/privacy-pools/state' },
      ],
    },
    {
      text: 'Tornado Cash',
      items: [
        { text: 'Shield and unshield', link: '/tornado-cash' },
        { text: 'Configuration', link: '/tornado-cash/configuration' },
        { text: 'Deposits and withdrawals', link: '/tornado-cash/options' },
        { text: 'Notes', link: '/tornado-cash/notes' },
      ],
    },
    {
      text: 'A real integration',
      link: '/examples',
    },
  ],
  topNav: [
    {
      text: 'GitHub',
      link: 'https://github.com/ethereum/kohaku',
    },
  ],
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/ethereum/kohaku',
    },
  ],
  theme: {
    accentColor: '#D01C15',
  },
  iconUrl: '/kohaku_icon.svg',
  logoUrl: '/kohaku_logo.svg',
  basePath: '/kohaku',
})
