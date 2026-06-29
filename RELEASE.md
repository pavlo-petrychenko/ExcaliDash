# ExcaliDash v0.5.1

Release date: 2026-06-21

## Key changes

- Add runtime-selectable Prisma provider support for SQLite and PostgreSQL deployments.
- Add provider-specific migration handling for Docker startup and local Prisma workflows.
- Add PostgreSQL compose/test coverage and health-check coverage for containerized deployments.
- Preserve SQLite as the default deployment path while allowing `DATABASE_PROVIDER=postgresql`.

## Upgrading

<details>
<summary>Show upgrade steps</summary>

### Data safety checklist

- Back up the backend volume (`dev.db`, secrets, uploads, and S3 bucket data) before upgrading.
- Let migrations run on startup (`RUN_MIGRATIONS=true`) for normal deploys.
- If S3 is enabled, verify that existing object keys follow the canonical layout `{prefix}/{userId}/{drawingId}/{fileId}.{ext}`.
- Run `docker compose -f docker-compose.prod.yml logs backend --tail=200` after rollout and verify startup/migration status.

### Recommended upgrade (Docker Hub compose)

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Pin images to this release (recommended for reproducible deploys)

Edit `docker-compose.prod.yml` and pin the release tags:

```yaml
services:
  backend:
    image: zimengxiong/excalidash-backend:v0.5.1
  frontend:
    image: zimengxiong/excalidash-frontend:v0.5.1
```

Example:

```bash
docker compose -f docker-compose.prod.yml up -d
```

</details>
