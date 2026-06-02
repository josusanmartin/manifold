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

To apply the required MEXAS SQL migrations and normalize the two published
market rows, run:

```shell
$ yarn --cwd backend/scripts apply:mexas-launch-sql
```

This requires `MEXAS_SUPABASE_DB_URL`, `SUPABASE_DB_URL`, `DATABASE_URL`,
`MEXAS_SUPABASE_DB_PASSWORD`, or `SUPABASE_DB_PASSWORD`. To review or paste the
SQL manually in Supabase, run:

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
