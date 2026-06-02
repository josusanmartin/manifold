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
  '/shop',
  '/shop/:path*',
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
].map((source) => ({
  source,
  destination: '/checkout',
  permanent: false,
}))

/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: path.join(__dirname, '..'),
  productionBrowserSourceMaps: true,
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
        source: '/supporter',
        destination: '/membership',
        permanent: true,
      },
      {
        source: '/politics',
        destination: '/election',
        permanent: true,
      },
      {
        source: '/elections',
        destination: '/election',
        permanent: true,
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
        source: '/analytics',
        destination: '/stats',
        permanent: true,
      },
      {
        source: '/labs',
        destination: '/lab',
        permanent: true,
      },

      {
        source: '/versus',
        destination: '/VersusBot?tab=questions',
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
        destination:
          'https://analytics.umami.is/share/ARwUIC9GWLNyowjq/Manifold%20Markets',
        permanent: false,
      },
      {
        source: '/this-month',
        destination: '/browse?f=closing-this-month&s=most-popular',
        permanent: true,
      },
      {
        source: '/search',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/browse/for-you',
        destination: '/browse?fy=1&f=open',
        permanent: true,
      },
      {
        source: '/find',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/groups',
        destination: '/browse?t=Topics',
        permanent: true,
      },
      {
        source: '/group/:slug*',
        destination: '/topic/:slug*',
        permanent: true,
      },
      {
        source: '/browse/:slug+',
        destination: '/topic/:slug+',
        permanent: false,
      },
      {
        source: '/old-posts/:slug*',
        destination: '/post/:slug*',
        permanent: true,
      },
      {
        source: '/questions',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/dashboard/:slug',
        destination: '/news/:slug',
        permanent: true,
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
        destination: '/news/:tab',
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
        destination: '/news/:tab',
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
        permanent: true,
        destination: '/browse/:topic', // Using the captured value here
      },
      // NOTE: add any external redirects at common/envs/constants.ts and update native apps.
    ]
  },
}
