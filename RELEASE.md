# ExcaliDash v0.5.0

Release date: 2026-06-03

This release focuses on safer sharing, stronger storage handling, cleaner account management, and smoother self-hosted operation.

| Area | Key changes |
|------|-------------|
| **Sharing and collaboration** | Share drawings and collections with specific people, manage viewer/editor roles, and use safer public links. |
| **Storage and files** | Improved S3 support for image files, private bucket redirects, cleanup tools, and safer handling for nested S3 prefixes. |
| **Account and admin** | API keys, user preferences, profile and password management, admin user management, access controls, and login rate-limit settings. |
| **Editor reliability** | More reliable saving, cleaner image handling, better multi-image imports, and safer collaboration updates. |
| **Import/export and backups** | Improved drawing imports, backup handling, and scheduled SQLite backups. |
| **Deployment** | Updated production Compose files and expanded deployment guidance for reverse proxies, OIDC, backups, offline use, and environment settings. |

## Notes

- S3 deployments should verify private file access, storage cleanup, duplicate/copy behavior, and orphan cleanup against the real bucket after upgrading.
- Keep regular backups of the backend database, secrets, uploads, and S3 bucket data.
- If you run behind a reverse proxy, make sure TLS, forwarded headers, trusted proxy settings, and public URLs are configured before opening the app to users.

## Upgrading

<details>
<summary>Show upgrade steps</summary>

### Data safety checklist

- Back up the backend volume (`dev.db`, secrets, uploads, and S3 bucket data) before upgrading.
- Let migrations run on startup (`RUN_MIGRATIONS=true`) for normal deploys.
- If S3 is enabled, verify that existing object keys follow the canonical layout `{prefix}/{userId}/{drawingId}/{fileId}.{ext}`.
- Run `docker compose -f docker-compose.prod.yml logs backend --tail=200` after rollout and verify startup/migration status.

### Recommended upgrade

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Pin images to this release

Edit `docker-compose.prod.yml` and pin the release tags:

```yaml
services:
  backend:
    image: zimengxiong/excalidash-backend:v0.5.0
  frontend:
    image: zimengxiong/excalidash-frontend:v0.5.0
```

Example:

```bash
docker compose -f docker-compose.prod.yml up -d
```

</details>
