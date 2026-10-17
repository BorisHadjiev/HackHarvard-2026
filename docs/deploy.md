# Deploy the landlord portal on Render

The landlord portal runs as one long-running Node web service. The tenant app stays on the demo laptop (`localhost:3001`). Render reads [`render.yaml`](../render.yaml) at the repo root.

| | |
|---|---|
| Service name | `need-to-know` |
| Runtime | Node 22 (`NODE_VERSION=22`) |
| Build | `npm ci && npm run build -w landlord-portal` |
| Start | `npm run start -w landlord-portal` |
| Health check | `GET /api/requests` |

Render sets `PORT`. The portal's production start script uses that port, and uses `3000` when `PORT` is unset. Local `npm run dev` is unchanged and still serves the portal on port 3000.

## Disk on the free plan

The request store is `landlord-portal/.data/store.json`. The portal creates the `.data/` folder when it first saves. On Render's free plan the disk is wiped on every deploy or restart, so open requests and used one-time codes disappear. Create a new request after a restart.

## After the PR is merged

About 10 minutes later, in the Render dashboard:

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Choose **New → Blueprint** and pick the **HackHarvard-2026** repo. Render reads `render.yaml`. Boris may need to approve Render's access to his repo, the same way he did for Claude.
3. Fill in the env vars (values stay in the dashboard; they are not in git):
   - `TENANT_APP_PUBLIC_JWK`: copy from local `landlord-portal/.env.local`.
   - `PUBLIC_PORTAL_URL`: the Render address, `https://<service>.onrender.com` (no trailing slash required).
   - `TENANT_APP_URL`: `http://localhost:3001`.
   - `PORTAL_AUDIENCE`: `landlord-portal`.
   - `PORTAL_REQUESTER_NAME`: copy from local `landlord-portal/.env.local` if it is set. If you leave it empty, the portal uses "Harbor View Apartments".
   - `TRUSTED_BUILD_HASHES`: copy from local `landlord-portal/.env.local` if it is set. If you leave it empty, the portal skips the build-hash check (same as local dev).
4. Deploy.
5. In local `tenant-app/.env.local`, set `DEFAULT_PORTAL_URL` to the Render address (`https://<service>.onrender.com`). Do not commit that file.
6. Run the tenant app locally, then the smoke test below.

Copy only the public JWK. `TENANT_APP_PRIVATE_JWK` stays in `tenant-app/.env.local` on the laptop.

## Env vars

| Variable | Where the value comes from |
|---|---|
| `TENANT_APP_PUBLIC_JWK` | Local `landlord-portal/.env.local` (written by `npm run keys`) |
| `PORTAL_AUDIENCE` | `landlord-portal` |
| `PORTAL_REQUESTER_NAME` | Local `landlord-portal/.env.local`, or leave unset for the default name |
| `TENANT_APP_URL` | `http://localhost:3001` while the tenant app is on the laptop |
| `PUBLIC_PORTAL_URL` | `https://<service>.onrender.com` |
| `TRUSTED_BUILD_HASHES` | Local `landlord-portal/.env.local` if you turned the tamper check on |

`POST /api/requests` puts `PUBLIC_PORTAL_URL` in the tenant link when it is set. Otherwise it uses `x-forwarded-proto` and `x-forwarded-host`, then the request URL.

## Smoke test against the live portal

With the tenant app running locally:

```bash
PORTAL=https://<service>.onrender.com npm run smoke
```

A free instance sleeps when idle. If the first request fails or hangs, wait for the service to wake and run the command again.
