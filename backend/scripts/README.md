# scripts

Migrations, analytics, or any handy scripts that use our backend or library code.

We do _not_ update scripts to stay in line with changes in their dependencies or with the db schema. Scripts just mean "I ran this about when I checked it into git." This also means you likely can't typescript build the whole project.

## Set up

Follow Setting up Authentication under [/functions/README](../functions/README.md#setting-up-authentication).

## Example script

Simply import `runScript` and pass it a function.

```typescript
import { runScript } from 'run-script'
import { DAY_MS } from 'common/util/time'
import { getRecentContractLikes } from 'shared/supabase/likes'

runScript(async ({ db }) => {
  const weekAgo = Date.now() - 7 * DAY_MS
  console.log(await getRecentContractLikes(db, weekAgo))
})
```

## Running a script

Make sure you are pointing at the Firebase you intend to:

```shell
$ firebase use dev
```

Use [ts-node](https://www.npmjs.com/package/ts-node) to run whatever you want:

```shell
$ cd backend/scripts
$ ts-node script.ts
```

### Environment variables

Secret keys are automatically loaded into `process.env` when you use the `runScript` function.

## MEXAS launch readiness

Before enabling live MEXAS matching or treating the fork as launch-ready, run:

```shell
$ yarn --cwd backend/scripts check:mexas-launch
```

This script loads local `.env` files, checks production Vercel env names, verifies the Supabase matching health RPC, checks required settlement flags, and smoke-tests the main public MEXAS pages. A failing result means production is not ready to launch with live matching.

If the readiness script fails, resolve blockers in this order:

1. Fund the treasury wallet with enough Arbitrum ETH for outgoing ERC-20
   transfers. The readiness script enforces `MEXAS_TREASURY_MIN_GAS_WEI`,
   defaulting to `0.0001 ETH`.

   ```shell
   # Current production treasury address:
   # 0xcdD889cb41E6ae9E03871ad26FfF771d63e57b21
   ```

2. Apply the MEXAS launch SQL in Supabase so `contracts.token` can become
   `MEX`, the matching RPC is installed, escrow capture is guarded, and the
   backend-only treasury ledger exists.

3. Cancel or expire active wallet-reserved test orders before treating treasury
   escrow mode as live. These orders were backed by users' Privy wallets before
   on-chain escrow capture was available, and must not be silently hidden when
   the public book switches to treasury escrow mode.

   ```shell
   $ yarn --cwd backend/scripts audit:mexas-wallet-orders
   $ yarn --cwd backend/scripts apply:mexas-wallet-orders
   ```

   The audit command is read-only. The apply command requires
   `--confirm-wallet-reserved-cancel` through the package script and uses the
   same MEXAS cancellation/release helper as the API.

4. If site checks report `Vercel Firewall challenge active`, disable Attack
   Challenge Mode or adjust the Vercel WAF challenge rule before launch. Vercel
   requires this to be done interactively; run:

   ```shell
   $ vercel firewall attack-mode disable
   ```

   If Attack Mode is already disabled, no custom rules are configured, and only
   the smoke runner's IP is still challenged, Vercel automatic system
   mitigations may have flagged the QA probe burst. First retry with a lower
   request rate, for example:

   ```shell
   $ MEXAS_SMOKE_REQUEST_DELAY_MS=1000 yarn --cwd backend/scripts check:mexas-smoke
   $ MEXAS_BROWSER_REQUEST_DELAY_MS=2000 yarn --cwd backend/scripts check:mexas-browser
   ```

   If a full production QA run still needs a temporary bypass, a human must run
   the mitigation pause interactively, then resume protection immediately after
   QA:

   ```shell
   $ vercel firewall system-mitigations pause
   $ yarn --cwd backend/scripts check:mexas-smoke
   $ yarn --cwd backend/scripts check:mexas-browser
   $ vercel firewall system-mitigations resume
   ```

5. If `Privy allowed origin` fails with `Vercel Security Checkpoint`, the
   Privy app config endpoint could not be verified from this server. That is
   not evidence that the domain is missing from Privy. Re-run after the
   challenge clears, or manually verify Privy Dashboard > Configuration > App
   settings > Domains > Allowed origins.

   If the failure says the app does not accept the origin without a Vercel
   challenge, add:

   ```text
   https://mexas-manifold.vercel.app
   ```

   Do not use a generic `https://*.vercel.app` wildcard for the production app
   ID. Privy rejects generic preview wildcards and browser signup will fail with
   CORS until the exact production origin is allowlisted.

6. Re-run `check:mexas-launch`. Do not enable crossing orders or resolve filled
   markets unless every launch-readiness line is `PASS`.

As of the 2026-06-04 production readiness pass, the treasury has Arbitrum gas,
the launch SQL is applied in Supabase, the RPC matching engine reports ready,
the treasury ledger reports ready, the escrow capture guard reports ready, the
treasury ledger has the explicit service-role RLS policy plus bet-id FK index,
legacy Manifold Supabase tables/views/functions flagged by advisors are locked
down for anon/authenticated clients, and the production smoke checks pass.

`MEXAS_TREASURY_SIGNER_SECRET` is already expected in Vercel production and must
derive exactly to `MEXAS_TREASURY_WALLET_ADDRESS`. If either treasury env fails
readiness, rotate both treasury address envs and signer together, redeploy, and
re-run `check:mexas-launch`.

To apply the required MEXAS SQL migrations and normalize every contract row
whose JSON data marks it as a MEX market, run:

```shell
$ yarn --cwd backend/scripts apply:mexas-launch-sql
```

This requires `MEXAS_SUPABASE_DB_URL`, `SUPABASE_DB_URL`, `DATABASE_URL`,
`MEXAS_SUPABASE_DB_PASSWORD`, or `SUPABASE_DB_PASSWORD`. Service-role REST keys
cannot apply this because the launch SQL changes constraints, RPC functions,
function grants, and indexes. To review or paste the SQL manually in Supabase,
run:

```shell
$ yarn --silent --cwd backend/scripts print:mexas-launch-sql > mexas-launch.sql
```

The printed SQL is wrapped in `begin; ... commit;` and contains a verification
block that raises on incomplete RPC grants, indexes, or token normalization. If
verification raises in Supabase SQL Editor, the launch SQL rolls back instead of
leaving partial DDL/DML applied.

For a narrower production UI/API smoke test that should pass before every deploy,
run:

```shell
$ yarn --cwd backend/scripts check:mexas-smoke
```

This checks public page status codes, required Spanish MEXAS copy, absence of
visible legacy Manifold/Mana/comment/verification UI strings, and the public
MEXAS orderbook endpoint. Against non-local hosts it spaces requests by default
to avoid turning the audit itself into a Vercel mitigation trigger. Override
with `MEXAS_SMOKE_REQUEST_DELAY_MS` if production is especially sensitive or if
you are running against a local server.

For a browser-level smoke test that renders the allowed MEXAS pages in desktop
and mobile Chromium, run:

```shell
$ yarn --cwd backend/scripts check:mexas-browser
```

This checks hydrated Spanish copy, forbidden legacy copy, console errors,
critical same-origin failed requests, and horizontal overflow. Against non-local
hosts it spaces browser navigations by default and stops on the first detected
Vercel Firewall challenge instead of continuing to probe challenged pages.
Override the browser pacing with `MEXAS_BROWSER_REQUEST_DELAY_MS`; if that is
unset, the script falls back to `MEXAS_SMOKE_REQUEST_DELAY_MS`. If production is
behind a Vercel Firewall challenge, run the command against a local production
server with `MEXAS_SITE_URL=http://127.0.0.1:<port>` or disable the challenge
interactively before using the production URL. If Vercel automatic system
mitigations are challenging only the QA runner, use
`vercel firewall system-mitigations pause` interactively for the QA window and
resume it afterwards. The script installs
`playwright@1.60.0` into `/tmp/mexas-browser-playwright` on demand if it is not
already available in local `node_modules`, so it does not add browser binaries
to Vercel production installs.

When running the browser smoke locally, refresh the root Vercel production env
file first, rebuild, then load the repo `.env` after the pulled Vercel env.
The pulled Vercel file can contain empty placeholders for server-only Supabase
secrets, while `.env` holds the local service key used by the API routes. Do
not source `web/.vercel/.env.production.local`; that nested copy can be stale.

```shell
$ COREPACK_ENABLE_STRICT=0 npx vercel pull --yes --environment=production
$ COREPACK_ENABLE_STRICT=0 npx vercel build --prod
$ cd web
$ set -a; [ -f ../.vercel/.env.production.local ] && . ../.vercel/.env.production.local; [ -f ../.env ] && . ../.env; set +a
$ COREPACK_ENABLE_STRICT=0 yarn next start -p 3053
$ MEXAS_SITE_URL=http://127.0.0.1:3053 yarn --cwd ../backend/scripts check:mexas-browser
$ MEXAS_SITE_URL=http://127.0.0.1:3053 yarn --cwd ../backend/scripts check:mexas-smoke
```

For an isolated SQL integration audit of the MEXAS orderbook matcher, run:

```shell
$ yarn --cwd backend/scripts test:mexas-orderbook-sql
```

This starts a temporary Docker Postgres, applies the MEXAS launch migrations,
and verifies backend-only RPC grants, treasury ledger idempotency/RLS,
YES-side and escrowed NO-side price-time priority, two concurrent takers racing
for the same maker, escrow capture hash uniqueness, wallet-vs-escrow separation,
closed/resolved market rejection, and expired taker rejection.
