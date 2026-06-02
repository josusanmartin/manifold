# MEXAS Privy Wallet Setup Guide

This guide covers the MEXAS wallet rail. It lets a user sign in with Privy,
connect or create a Privy embedded wallet, hold MEX on Arbitrum One, and trade
only against MEX-backed balances.

## Token

MEXAS is configured as:

- Chain: Arbitrum One (`42161`)
- Token: `MEXAS Stablecoin`
- Symbol: `MEX`
- Decimals: `6`
- Contract: `0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303`
- Explorer: `https://arbiscan.io/token/0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303`

There is no purchase conversion. A user's available MEX is derived from their
on-chain wallet balance minus open reserved order amounts and filled exposure.

## Flow

1. User signs in with Privy.
2. User opens `/wallet` or the wallet summary on `/checkout`.
3. The app creates or connects the user's Privy embedded wallet.
4. The user deposits MEX directly to that wallet address on Arbitrum One.
5. The frontend and local APIs read the wallet's MEX balance on-chain.
6. Opening a non-crossing limit order reserves internal available MEX.
7. Cancelling or expiring an open order releases only the remaining reservation.
8. Withdrawals transfer MEX directly from the user's Privy wallet and are capped
   by the lower of the on-chain balance and internal available MEX.

`record-mexas-purchase` is intentionally disabled. It must not be used to
convert treasury transfers into internal credit.

## Required Environment

Web frontend:

```bash
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_ARBITRUM_RPC_URL=https://your-arbitrum-rpc.example
```

API backend:

```bash
ARBITRUM_RPC_URL=https://your-arbitrum-rpc.example
```

`NEXT_PUBLIC_ARBITRUM_RPC_URL` and `ARBITRUM_RPC_URL` are optional. If omitted,
the app uses `https://arb1.arbitrum.io/rpc`.

`MEXAS_TREASURY_WALLET_ADDRESS` and
`NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS` are launch-readiness placeholders
for a future escrow/treasury settlement implementation. They are not used for
wallet deposits.

## Deploy

Deploy the frontend after setting `NEXT_PUBLIC_PRIVY_APP_ID` in your hosting
environment. Deploy backend/API changes only after verifying the local MEXAS API
surface still blocks legacy purchase, checkout, verification, loan, boost,
comment, prize, and Manifold proxy endpoints.

## Operational Notes

- Deposits are plain wallet deposits to the user's Privy address.
- The platform does not mint or sell internal funds from a treasury transfer.
- The backend must keep `record-mexas-purchase` disabled unless a full audited
  escrow/settlement implementation replaces it.
- Users need Privy authentication because market actions are server-side and
  tied to the Privy user id.
- Matching crossed orders and resolving filled positions must stay blocked
  until on-chain escrow settlement is implemented and verified.
