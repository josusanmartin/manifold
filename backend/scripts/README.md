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
