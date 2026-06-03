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

Current launch blockers should be resolved in this order:

1. Add `MEXAS_TREASURY_SIGNER_SECRET` to Vercel production. The private key
   must derive exactly to `MEXAS_TREASURY_WALLET_ADDRESS`.

   ```shell
   $ vercel env add MEXAS_TREASURY_SIGNER_SECRET production
   ```

2. Fund the treasury wallet with enough Arbitrum ETH for outgoing ERC-20
   transfers. The readiness script enforces `MEXAS_TREASURY_MIN_GAS_WEI`,
   defaulting to `0.0001 ETH`.

3. Apply the MEXAS launch SQL in Supabase so `contracts.token` can become
   `MEX`, the matching RPC is installed, escrow capture is guarded, and the
   backend-only treasury ledger exists.

4. If site checks report `Vercel Firewall challenge active`, disable Attack
   Challenge Mode or adjust the Vercel WAF challenge rule before launch. Vercel
   requires this to be done interactively; run:

   ```shell
   $ vercel firewall attack-mode disable
   ```

5. Re-run `check:mexas-launch`. Do not enable crossing orders or resolve filled
   markets until every launch-readiness line is `PASS`.

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
$ yarn --silent --cwd backend/scripts apply:mexas-launch-sql --print-sql > mexas-launch.sql
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
MEXAS orderbook endpoint.

For an isolated SQL integration audit of the MEXAS orderbook matcher, run:

```shell
$ yarn --cwd backend/scripts test:mexas-orderbook-sql
```

This starts a temporary Docker Postgres, applies the MEXAS launch migrations,
and verifies backend-only RPC grants, treasury ledger idempotency/RLS, price-time
priority, two concurrent takers racing for the same maker, wallet-vs-escrow
separation, closed/resolved market rejection, and expired taker rejection.
