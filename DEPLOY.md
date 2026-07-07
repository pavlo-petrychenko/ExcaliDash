# ExcaliDash — self-hosted deploy (pavlop.dev)

Our self-hosted Excalidraw **dashboard/library** (persistent boards, collections,
search, version history, live collaboration, scoped sharing), deployed on `mjolnir`
via Coolify at **https://excalidraw.pavlop.dev**, behind the Cloudflare tunnel +
Cloudflare Access (3-email policy). Fork of
[`ZimengXiong/ExcaliDash`](https://github.com/ZimengXiong/ExcaliDash).

## Stack (`docker-compose.selfhost.yml`)

| Service    | Image                              | Exposed | Role                                   |
|------------|------------------------------------|---------|----------------------------------------|
| `frontend` | `zimengxiong/excalidash-frontend`  | yes (80)| SPA + nginx; proxies `/api` `/socket.io` → backend |
| `backend`  | `zimengxiong/excalidash-backend`   | no      | API + collab; SQLite in `excalidash-data` volume |

Pinned to `0.5.1`. Auth: local email/password (`AUTH_MODE=local`).

## Coolify

- Git app, `build_pack=dockercompose`, source = this repo, compose = `/docker-compose.selfhost.yml`.
- Domain: `frontend` service → `https://excalidraw.pavlop.dev`.
- Auto-deploys on push.

## First run

Visit the URL (pass Cloudflare Access first), complete the onboarding: choose
**Local** auth mode and create the admin account. Registration then closed to admin-managed.

## Updating

Bump the image tags to a newer [release](https://github.com/ZimengXiong/ExcaliDash/releases)
and push. Drawings/users persist in the `excalidash-data` volume. Backups: use the
in-app export (plain `.excalidraw`).
