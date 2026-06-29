# Offline Resolution Log

Bundle: `ZimengXiong/ExcaliDash` offline export generated 2026-05-22. All work was local in `repository/`; no GitHub comments, commits, pushes, or PRs were created.

## Artifact/patch format

- Patch format: unified Git diff from the bundled repository `HEAD` to this local working tree.
- Human log format: Markdown tables for each open issue and open PR, with local disposition, closure work, primary files, validation, and risk.
- Line-count rule: `scripts/check-source-line-count.cjs` enforces `MAX_SOURCE_LINES` or 399 by default; there are no legacy exceptions.

## Open issue disposition

| # | Status | Local closure / evidence | Primary files |
|---:|---|---|---|
| 49 | fixed | Documented persistent `/app/prisma` and backup mounts for Unraid/host-path installs. | `README.md; docs/DEPLOYMENT.md` |
| 59 | fixed | Changed drawing-list API to omit heavy previews unless explicitly requested, and kept dashboard consumers on lightweight list payloads. | `backend/src/routes/dashboard/drawingListRoutes.ts; frontend/src/api/drawings.ts; frontend/src/pages/dashboard/useDashboardData.test.ts` |
| 63 | blocked | Recorded as upstream embedded-Excalidraw upgrade scope; no safe scoped open PR existed in the bundle. | `OFFLINE_RESOLUTION_LOG.md` |
| 66 | fixed | Integrated OIDC discovery/algorithm handling and provider documentation for alg mismatches. | `backend/src/auth/oidcRoutes.ts; backend/src/auth/schemas.ts; docs/DEPLOYMENT.md` |
| 71 | fixed | Implemented and documented runtime Prisma provider selection with separated SQLite/PostgreSQL migration handling. | `RELEASE.md; docs/DEPLOYMENT.md; backend/docker-entrypoint.sh; backend/scripts/provider-prisma.cjs` |
| 76 | fixed | Added persisted server-side preferences for theme and dashboard sort, plus frontend save/load behavior. | `backend/prisma/schema.prisma; backend/src/auth/accountPreferencesRoutes.ts; frontend/src/context/ThemeContext.tsx; frontend/src/pages/Settings.tsx` |
| 83 | fixed | Added scheduled SQLite backup scheduler, config/env support, startup wiring, and docs. | `backend/src/backups/scheduler.ts; backend/src/config.ts; backend/src/index.ts; docs/DEPLOYMENT.md` |
| 84 | fixed | Allowed safe SVG data URLs to persist/reload without weakening unrelated sanitization. | `backend/src/security.ts; backend/src/__tests__/drawings.integration.ts` |
| 88 | blocked | Recorded as embedded Excalidraw grid-step support/version scope with no scoped bundle PR. | `OFFLINE_RESOLUTION_LOG.md` |
| 93 | fixed | Closed through collection-sharing backend/frontend implementation. | `backend/src/routes/dashboard/collections.ts; frontend/src/components/ShareCollectionModal.tsx; frontend/src/pages/Dashboard.collection-sharing.test.tsx` |
| 98 | fixed | Tightened self-hosted/offline CSP and documented no-network operation. | `frontend/nginx.conf; frontend/nginx.conf.template; docs/DEPLOYMENT.md; README.md` |
| 111 | blocked | Recorded as upstream Excalidraw flow-chart/product feature scope with no local/dashboard patch. | `OFFLINE_RESOLUTION_LOG.md` |
| 119 | blocked | Recorded as upstream Excalidraw library-search scope; no scoped open PR was safely applicable. | `OFFLINE_RESOLUTION_LOG.md` |
| 121 | blocked | Collection-sharing prerequisites were added; full admin/OIDC access groups remain a larger schema/UI feature. | `backend/src/authz/sharing.ts; backend/src/routes/dashboard/collections.ts; OFFLINE_RESOLUTION_LOG.md` |
| 139 | fixed | Added excalidash-mcp community integration reference. | `README.md` |
| 145 | fixed | Added S3/S3-compatible image storage, file-processing, serving, cleanup/copy, and storage-management UI. | `backend/src/s3.ts; backend/src/fileProcessing.ts; backend/src/routes/storage.ts; frontend/src/components/StorageManageModal.tsx` |
| 156 | fixed | Integrated collection-sharing backend and frontend, including owner/grantee access checks and UI restrictions. | `backend/prisma/migrations/20260326143103_add_collection_sharing/migration.sql; backend/src/authz/sharing.ts; frontend/src/components/ShareCollectionModal.tsx` |
| 159 | fixed | Added OIDC userinfo/email verification handling and Entra-oriented docs. | `backend/src/auth/oidcRoutes.ts; docs/DEPLOYMENT.md` |
| 160 | fixed | Added optional self-hosted app-shell display-font override and docs. | `frontend/src/utils/displayFont.ts; frontend/src/index.css; frontend/.env.example; docs/DEPLOYMENT.md` |
| 161 | not reproducible | Administrative release-hold notice; no local repository defect to patch. | `OFFLINE_RESOLUTION_LOG.md` |
| 166 | blocked | Custom-font/Chinese-adjacent support was addressed where local; mindmap sibling/child/parent behavior depends on embedded canvas support. | `frontend/src/utils/displayFont.ts; OFFLINE_RESOLUTION_LOG.md` |
| 171 | fixed | Added configurable password policy env vars, backend exposure, and frontend validation. | `backend/src/config/passwordPolicy.ts; backend/src/auth/schemas.ts; frontend/src/utils/passwordPolicy.ts` |

## Open PR disposition

| # | Merge decision | Local handling | Primary files |
|---:|---|---|---|
| 64 | no direct merge; superseded | Large stale pre-release/meta PR was superseded by current main plus smaller integrated PRs. | `OFFLINE_RESOLUTION_LOG.md` |
| 70 | merge with modifications | Addressed persistence/deployment intent through README/docs instead of stale compose hunks. | `README.md; docs/DEPLOYMENT.md` |
| 72 | merge with modifications | Provider switching intent is covered by runtime schema/provider setup, Docker startup generation, and provider-specific local Prisma workflows. | `RELEASE.md; docs/DEPLOYMENT.md; backend/docker-entrypoint.sh; backend/scripts/provider-prisma.cjs` |
| 86 | merge | Integrated SVG data URL persistence fix. | `backend/src/security.ts; backend/src/__tests__/drawings.integration.ts` |
| 105 | no direct merge; split/superseded | Extracted compatible hardening/documentation pieces; avoided stale broad refactor. | `backend/src/db/prisma.ts; backend/src/server/csrf.ts; docs/DEPLOYMENT.md` |
| 120 | no direct merge; superseded | Older collection-sharing PR superseded by #154/#155 implementation. | `backend/src/routes/dashboard/collections.ts; frontend/src/components/ShareCollectionModal.tsx` |
| 135 | merge | Integrated OIDC discovery/userinfo/signing improvements. | `backend/src/auth/oidcRoutes.ts; backend/src/auth/schemas.ts` |
| 154 | merge | Integrated collection-sharing backend schema/routes/authz/tests. | `backend/prisma/migrations/20260326143103_add_collection_sharing/migration.sql; backend/src/authz/sharing.ts; backend/src/__tests__/collection-sharing.integration.ts` |
| 155 | merge | Integrated collection-sharing frontend modals, cards, sidebar/dashboard rules, and tests. | `frontend/src/components/ShareCollectionModal.tsx; frontend/src/pages/Dashboard.collection-sharing.test.tsx` |
| 158 | merge with modifications | Implemented editor wheel zoom-to-cursor behavior while omitting stale unrelated hunks. | `frontend/src/pages/Editor.tsx` |
| 162 | merge | Enabled SQLite WAL/busy_timeout before serving. | `backend/src/db/prisma.ts; backend/src/index.ts` |
| 163 | merge/superseded | S3 upload intent covered by the stronger per-drawing storage implementation in #165. | `backend/src/s3.ts; backend/src/fileProcessing.ts` |
| 165 | merge with modifications | Integrated per-drawing storage management around current auth/sharing code. | `backend/src/routes/storage.ts; frontend/src/components/StorageManageModal.tsx` |
| 168 | merge | Integrated backend dependency bumps. | `backend/package.json; backend/package-lock.json` |
| 169 | merge | Integrated frontend axios bump. | `frontend/package.json; frontend/package-lock.json` |
| 170 | merge | Integrated frontend mermaid bump. | `frontend/package.json; frontend/package-lock.json` |
| 172 | merge with modifications | Integrated API key auth/routes/UI/tests with local conflict resolution and no public workflow changes. | `backend/src/auth/apiKeys.ts; backend/src/middleware/auth.ts; frontend/src/pages/profile/ApiKeysCard.tsx` |

## Strict under-400 refactor

- Removed the prior legacy-size grandfathering behavior.
- Lowered the default cap to 399 lines so every checked authored file is literally under 400 lines.
- Expanded the check to backend/frontend source, e2e tests, scripts, docs, makefiles, and root README/AGENTS/Makefile/log files.
- Split or compacted legacy monoliths including editor/dashboard/account/core routes/import helpers/share modal/release makefile documentation paths.
- Current largest checked files are under the cap: StorageManageModal 392, backend storage route 390, collection-sharing integration test 388, config 387, and e2e drawing CRUD 385 lines.

## Validation

| Command | Result |
|---|---|
| `node scripts/check-source-line-count.cjs` | passed after README/test split: 272 files checked; max 399; no legacy exceptions |
| `npm --prefix backend run check:max-lines` | passed: 272 files checked; max 399; no legacy exceptions |
| `npm --prefix frontend run check:max-lines` | passed: 272 files checked; max 399; no legacy exceptions |
| `cd frontend && npx tsc -b` | passed |
| `cd frontend && npx vitest run --reporter=verbose` | passed: 16 files / 66 tests |
| `make help` | passed |
| `npm --prefix backend run build` | passed with local Prisma client/engine availability |
| `npm --prefix backend test -- --run` | passed with local Prisma client/engine availability |

## Remaining risk

- Backend build/typecheck/test validation now passes in the current local environment. Fresh sealed-network machines still need dependencies and Prisma engines preseeded before running `prisma generate`.
- Provider selection is implemented for SQLite and PostgreSQL; automatic data migration between database providers remains out of scope for this branch.
- Blocked upstream/product items remain documented rather than falsely marked fixed: #63, #88, #111, #119, #121, #166.
- S3 and sharing behavior was integrated from stale/conflicting PR metadata and should still receive maintainer review despite local validation coverage.

## Exact files changed

- `AGENTS.md`
- `Makefile`
- `OFFLINE_RESOLUTION_LOG.md`
- `README.md`
- `backend/.env.example`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/prisma/migrations/20260326143103_add_collection_sharing/migration.sql`
- `backend/prisma/migrations/20260408060000_add_s3_files/migration.sql`
- `backend/prisma/migrations/20260506130000_s3file_composite_pk/migration.sql`
- `backend/prisma/migrations/20260513120000_add_api_keys/migration.sql`
- `backend/prisma/migrations/20260522100000_add_user_preferences/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/__tests__/api-key-auth.integration.ts`
- `backend/src/__tests__/collection-sharing.integration.ts`
- `backend/src/__tests__/drawing-history.test.ts`
- `backend/src/__tests__/drawings.integration.ts`
- `backend/src/__tests__/fileProcessing.test.ts`
- `backend/src/__tests__/imports-compat.integration.ts`
- `backend/src/__tests__/storage.integration.ts`
- `backend/src/__tests__/testUtils.ts`
- `backend/src/auth.ts`
- `backend/src/auth/accountApiKeyRoutes.ts`
- `backend/src/auth/accountPasswordChangeRoutes.ts`
- `backend/src/auth/accountPasswordResetRoutes.ts`
- `backend/src/auth/accountPreferencesRoutes.ts`
- `backend/src/auth/accountProfileRoutes.ts`
- `backend/src/auth/accountRoutes.test.ts`
- `backend/src/auth/accountRoutes.ts`
- `backend/src/auth/adminRoutes.ts`
- `backend/src/auth/apiKeys.test.ts`
- `backend/src/auth/apiKeys.ts`
- `backend/src/auth/coreRouteHelpers.ts`
- `backend/src/auth/coreRoutes.ts`
- `backend/src/auth/oidcRoutes.ts`
- `backend/src/auth/schemas.ts`
- `backend/src/authz/sharing.ts`
- `backend/src/backups/scheduler.ts`
- `backend/src/config.ts`
- `backend/src/config/passwordPolicy.ts`
- `backend/src/config/production.ts`
- `backend/src/db/prisma.ts`
- `backend/src/fileProcessing.ts`
- `backend/src/index.ts`
- `backend/src/middleware/auth.test.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/routes/dashboard/collections.ts`
- `backend/src/routes/dashboard/drawingCreateUpdateRoutes.ts`
- `backend/src/routes/dashboard/drawingDeleteDuplicateRoutes.ts`
- `backend/src/routes/dashboard/drawingHistoryRoutes.ts`
- `backend/src/routes/dashboard/drawingListRoutes.ts`
- `backend/src/routes/dashboard/drawingReadRoutes.ts`
- `backend/src/routes/dashboard/drawingRouteContext.ts`
- `backend/src/routes/dashboard/drawingSharingRoutes.ts`
- `backend/src/routes/dashboard/drawings.ts`
- `backend/src/routes/dashboard/types.ts`
- `backend/src/routes/files.ts`
- `backend/src/routes/importExport/excalidashImportRoutes.ts`
- `backend/src/routes/importExport/legacySqliteImportRoutes.ts`
- `backend/src/routes/storage.ts`
- `backend/src/routes/storage/helpers.ts`
- `backend/src/s3.ts`
- `backend/src/security.ts`
- `backend/src/server/csrf.ts`
- `backend/tsconfig.json`
- `docs/DEPLOYMENT.md`
- `frontend/.env.example`
- `frontend/nginx.conf`
- `frontend/nginx.conf.template`
- `frontend/package-lock.json`
- `frontend/package.json`
- `frontend/src/api/auth.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/collections.ts`
- `frontend/src/api/drawings.ts`
- `frontend/src/api/index.ts`
- `frontend/src/api/storage.ts`
- `frontend/src/api/system.ts`
- `frontend/src/components/DrawingCard.collection-sharing.test.tsx`
- `frontend/src/components/DrawingCard.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/RoleSelect.tsx`
- `frontend/src/components/ShareCollectionModal.tsx`
- `frontend/src/components/ShareModal.tsx`
- `frontend/src/components/Sidebar.tsx`
- `frontend/src/components/StorageManageModal.tsx`
- `frontend/src/components/share-modal/CustomSelect.tsx`
- `frontend/src/components/share-modal/GeneralAccessSection.tsx`
- `frontend/src/components/share-modal/SharePeopleSection.tsx`
- `frontend/src/components/share-modal/shareUtils.ts`
- `frontend/src/context/ThemeContext.tsx`
- `frontend/src/index.css`
- `frontend/src/main.tsx`
- `frontend/src/pages/Admin.tsx`
- `frontend/src/pages/Dashboard.collection-sharing.test.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/Editor.tsx`
- `frontend/src/pages/Profile.apiKeys.test.tsx`
- `frontend/src/pages/Profile.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/dashboard/useDashboardData.test.ts`
- `frontend/src/pages/profile/ApiKeysCard.tsx`
- `frontend/src/pages/profile/PasswordCard.tsx`
- `frontend/src/types/index.ts`
- `frontend/src/utils/displayFont.ts`
- `frontend/src/utils/importHelpers.ts`
- `frontend/src/utils/importUtils.ts`
- `frontend/src/utils/passwordPolicy.ts`
- `make/release.mk`
- `scripts/check-source-line-count.cjs`

## Recommended commit grouping

1. Dependency/security/OIDC/SVG/WAL hardening: #86, #135, #162, #168, #169, #170.
2. Collection sharing backend/frontend: #154, #155, #156, #93, superseding #120.
3. API key authentication and profile UI: #172.
4. S3 image storage and storage management: #145, #163, #165.
5. Password policy, preferences, backups, offline docs, fonts, deployment docs: #171, #76, #83, #98, #160, #49, #139, #159.
6. Editor zoom-to-cursor UX: #158.
7. Strict source-size refactor and line-count guard.
