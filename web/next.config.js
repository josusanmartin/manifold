const path = require('path')

const MEXAS_WALLET_REDIRECTS = [
  '/payments',
  '/add-funds',
  '/link/:path*',
  '/links',
].map((source) => ({
  source,
  destination: '/wallet',
  permanent: false,
}))

const MEXAS_ONLY_REDIRECTS = [
  '/',
  '/activity',
  '/admin',
  '/admin/:path*',
  '/ai',
  '/ai/:path*',
  '/home',
  '/browse',
  '/browse/:path*',
  '/calibration',
  '/:username/calibration',
  '/charity',
  '/charity/:path*',
  '/calculator',
  '/comments',
  '/complexsystems',
  '/cowp',
  '/create',
  '/create-post',
  '/dashboard',
  '/dashboard/:path*',
  '/discord-bot',
  '/explore',
  '/feed',
  '/lab',
  '/leaderboards',
  '/leaderboards/:path*',
  '/predictle',
  '/prize',
  '/prize/:path*',
  '/election',
  '/election/:path*',
  '/leagues',
  '/leagues/:path*',
  '/live',
  '/mana-auction',
  '/manachan',
  '/membership',
  '/messages',
  '/messages/:path*',
  '/my-calibration',
  '/news',
  '/news/:path*',
  '/old-charity',
  '/old-charity/:path*',
  '/og-test/:path*',
  '/pakman',
  '/post/:path*',
  '/posts',
  '/press',
  '/public-messages',
  '/public-messages/:path*',
  '/redeem',
  '/referrals',
  '/register-on-discord',
  '/reports',
  '/reports/:path*',
  '/server-sitemap.xml',
  '/shop',
  '/shop/:path*',
  '/sign-in-waiting',
  '/sitemap',
  '/sports',
  '/stats',
  '/styles',
  '/todo',
  '/topic/:path*',
  '/twitch',
  '/tv',
  '/tv/:path*',
  '/websocket-live',
  '/welcomeoffer',
  '/wrapped',
  '/yc-s23',
  '/embed/:path*',
  '/notifications',
].map((source) => ({
  source,
  destination: '/checkout',
  permanent: false,
}))

/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: path.join(__dirname, '..'),
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // eslint config moved - run `next lint` separately in CI
  modularizeImports: {
    '@heroicons/react/solid/?(((\\w*)?/?)*)': {
      transform: '@heroicons/react/solid/{{ matches.[1] }}/{{member}}',
    },
    '@heroicons/react/outline/?(((\\w*)?/?)*)': {
      transform: '@heroicons/react/outline/{{ matches.[1] }}/{{member}}',
    },

    lodash: {
      transform: 'lodash/{{member}}',
    },
  },
  transpilePackages: ['common'],
  experimental: {
    scrollRestoration: true,
  },
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      { hostname: 'manifold.markets' },
      { hostname: 'dev.manifold.markets' },
      { hostname: 'oaidalleapiprodscus.blob.core.windows.net' },
      { hostname: 'lh3.googleusercontent.com' },
      { hostname: 'i.imgur.com' },
      { hostname: 'firebasestorage.googleapis.com' },
      { hostname: 'storage.googleapis.com' },
      { hostname: 'picsum.photos' },
      { hostname: '*.giphy.com' },
    ],
  },
  turbopack: {
    root: path.join(__dirname, '..'),
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  webpack: (config) => {
    // Find and remove the default SVG rule
    const fileLoaderRule = config.module.rules.find(
      (rule) => rule.test instanceof RegExp && rule.test.test('.svg')
    )

    if (fileLoaderRule) {
      fileLoaderRule.exclude = /\.svg$/
    }

    // Add SVGR loader for SVG files
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    })

    return config
  },
  async redirects() {
    return [
      ...MEXAS_WALLET_REDIRECTS,
      ...MEXAS_ONLY_REDIRECTS,
      {
        source:
          '/mexas-test/will-the-russia-ukraine-war-end-by-december-31-2026',
        destination:
          '/mexas-test/terminara-la-guerra-entre-rusia-y-ucrania-antes-del-31-de-diciembre-de-2026',
        permanent: false,
      },
      {
        source: '/:username',
        has: [
          {
            type: 'query',
            key: 'tab',
            value: 'comments|achievements',
          },
        ],
        destination: '/:username?tab=summary',
        permanent: false,
      },
      {
        source: '/supporter',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/politics',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/elections',
        destination: '/checkout',
        permanent: false,
      },

      {
        source: '/api',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/api/v0',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/docs',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/docs/:path*',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/faq',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/api-docs',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/data',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/data/:path*',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/privacy-policy',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/prize-faq',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/prize-rules',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/analytics',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/labs',
        destination: '/checkout',
        permanent: false,
      },

      {
        source: '/versus',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/privacy',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/terms',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/mana-only-terms',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/sweepstakes-rules',
        destination: '/about',
        permanent: false,
      },
      {
        source: '/umami',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/this-month',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/search',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/browse/for-you',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/find',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/groups',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/group/:slug*',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/browse/:slug+',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/old-posts/:slug*',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/questions',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/dashboard/:slug',
        destination: '/checkout',
        permanent: false,
      },
      {
        source: '/home/:newsSlug*',
        has: [
          {
            type: 'query',
            key: 'tab',
            value: '(?<tab>.*)',
          },
        ],
        permanent: false,
        destination: '/checkout',
      },
      {
        source: '/news/:newsSlug*',
        has: [
          {
            type: 'query',
            key: 'tab',
            value: '(?<tab>.*)',
          },
        ],
        permanent: false,
        destination: '/checkout',
      },
      {
        source: '/:username/portfolio',
        destination: '/:username',
        permanent: false,
      },
      {
        source: '/browse',
        has: [
          {
            type: 'query',
            key: 'topic',
            // Using a named capture group to capture the value of 'topic'
            value: '(?<topic>.*)',
          },
        ],
        permanent: false,
        destination: '/checkout',
      },
      // NOTE: add any external redirects at common/envs/constants.ts and update native apps.
    ]
  },
}
