# excalidash-mcp

A local **stdio** [MCP](https://modelcontextprotocol.io) server that lets an
agent (Claude Code, Claude Desktop, any MCP client) author, edit, and render
[ExcaliDash](https://excalidraw.pavlop.dev) diagrams — flowcharts,
architecture diagrams, decision trees — through a compact `DiagramSpec`
(nodes + edges + auto-layout), with a render-after-mutate loop so the agent
sees a PNG of its own work in the same turn.

It talks to your existing ExcaliDash backend over HTTPS using a **scoped API
key** you create yourself; it never touches your session cookie, and the
token never leaves your machine except in requests to your own backend.

See `skills/excalidash-diagrams/SKILL.md` for the diagram-authoring guide the
agent reads; the tool surface itself is documented per-tool via each tool's
MCP `description` (also servable in-band via the `excalidash_guide` tool).

## Requirements

- Node.js ≥ 18
- An ExcaliDash account with an API key (see below)
- Nothing else by default — the built-in `resvg` render engine is pure
  Node/Rust and does not download a browser. The optional Playwright/Chromium
  engine is opt-in (see "Render engine" below).

## 1. Create a scoped API key

Log into your ExcaliDash instance → **Profile → API Keys** → create a key.

- A **read + write** agent (create/edit/render/organize diagrams) needs:
  `drawings:read, drawings:write, collections:read, collections:write`
- A **read-only** agent (list/get/render only, never mutates anything) needs
  just: `drawings:read`

Copy the `exd_…` token now — it is shown once. There is no separate
"history"/"restore" scope: those actions reuse `drawings:read`/`drawings:write`
(see the plan's §0.2 #2 for why).

## 2. Install & build

From a checkout of this repo:

```sh
cd mcp-server
npm install
npm run build
```

This produces `dist/index.js` (the stdio entry point) and, as part of the
build, bundles the Excalidraw core into `dist/vendor/` — no separate step
needed.

If/when this package is published to npm, `npx -y excalidash-mcp` will work
without a local checkout at all; until then, point your MCP client at the
built `dist/index.js` from a `git clone` as shown below.

## 3. Register it with your MCP client

Using the Claude Code CLI:

```sh
claude mcp add --scope user --transport stdio excalidash \
  --env EXCALIDASH_API_KEY=exd_your_token_here \
  --env EXCALIDASH_BASE_URL=https://excalidraw.pavlop.dev \
  -- node /absolute/path/to/mcp-server/dist/index.js
```

Any other MCP client works the same way: spawn
`node /absolute/path/to/mcp-server/dist/index.js` as a stdio subprocess with
the environment variables below set.

Once published: `claude mcp add ... -- npx -y excalidash-mcp`.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `EXCALIDASH_API_KEY` | **yes** | — | The `exd_<keyId>_<secret>` token. Missing/empty → the server prints an actionable message to stderr and exits(1) before any transport is wired up. |
| `EXCALIDASH_BASE_URL` | no | `https://excalidraw.pavlop.dev` | Origin of your ExcaliDash backend. Must be `https://` unless `EXCALIDASH_ALLOW_INSECURE=true`. |
| `EXCALIDASH_ALLOW_INSECURE` | no | `false` | Allows an `http://` base URL. **Local development only** — never set this against a real deployment. |
| `EXCALIDASH_RENDER_ENGINE` | no | `resvg` | `resvg` (default, no browser) or `browser` (Playwright/Chromium, opt-in — see below). |
| `EXCALIDASH_REQUEST_TIMEOUT_MS` | no | `30000` | Timeout for calls to the ExcaliDash backend. |
| `EXCALIDASH_MAX_LONG_SIDE` | no | `1200` | Default pixel clamp on the longest side of a rendered image (token-cost safety). |

## Render engine

**Default: `resvg`.** Pure Node — `jsdom` supplies DOM globals for
Excalidraw's own `exportToSvg`, and `@resvg/resvg-js` rasterizes the SVG to
PNG using the TTF font assets bundled in `fonts/` (see `fonts/README.md` for
why they're TTF, not the shipped woff2). No browser download, works out of
the box after `npm install`.

**Opt-in: `browser`.** Launches a Playwright-controlled Chromium and renders
inside a real page that imports the repo-bundled Excalidraw core (no CDN), for
maximum hand-drawn-style fidelity. `playwright` is declared as an
`optionalDependency` and is **not installed** by a plain `npm install`. To use
it:

```sh
npm install playwright   # or: npx playwright install chromium (if already a devDependency elsewhere)
npx playwright install chromium
```

then set `EXCALIDASH_RENDER_ENGINE=browser`. If you set this without
installing `playwright`, `excalidash_render` (and any `render:true` call)
returns an actionable error telling you to install it or switch back to
`resvg`.

## Security notes

- **Transport is local stdio only.** This server is never meant to run as a
  network-reachable service; there is no HTTP/SSE transport wired up. The API
  key lives in your MCP client's local config/env, not in any request header
  a browser would send (no `Origin`/`Referer`), which is exactly why it can
  legitimately bypass the backend's CSRF check as a non-browser bearer
  request.
- **All logging goes to stderr**, with the `Authorization` header redacted —
  stdout is reserved for JSON-RPC framing.
- **HTTPS-only by default.** Plain `http://` base URLs are rejected unless you
  explicitly opt in with `EXCALIDASH_ALLOW_INSECURE=true` (local dev only).
  Redirects are not followed automatically (`redirect: "manual"`).
- **Untrusted content.** Any text read back from a drawing (labels, scene
  content) is framed as *data*, never as instructions — a scene authored by
  someone else cannot make the agent perform an unrelated action just by
  containing text that looks like a command.
- **Destructive actions are narrow.** `excalidash_manage_drawing`'s `delete`
  takes exactly one `drawing_id` — there is no bulk/wildcard delete. Edits
  never send a partial elements array (a partial `PUT` would silently delete
  omitted elements); on a version conflict the server re-fetches, re-applies
  the same declarative ops once, and only then reports a concurrent-edit error
  — it never blind-overwrites a drawing someone else has open.
- **Image fetches during render are SSRF-guarded.** Only your own ExcaliDash
  origin (or an explicit allow-list) may be fetched over TLS; private/loopback/
  link-local IP ranges are blocked. A failed image resolves to a labeled
  placeholder plus a warning — it never fails the whole render.
- **Least privilege.** Issue a `drawings:read`-only key for any agent that
  should never be able to mutate a drawing.

## Development

```sh
npm run build          # builds dist/ (vendors the Excalidraw core first)
npm test                # vitest unit tests (mocked fetch — no real backend)
npm run check:max-lines # enforces the repo's 399-line-per-file convention
```

### End-to-end test

`npm run test:e2e` (`scripts/e2e-local.mjs`) is a full-lifecycle test against
a **real** local ExcaliDash backend and the **actual built** `dist/index.js`
server (not mocks): it starts its own throwaway backend process on a free
port with its own temporary SQLite database (never your `make dev` database),
seeds a full-scope and a read-only API key directly via Prisma, then drives
one diagram through create → get → render(region) → edit+relayout → history →
restore → move-to-collection → delete, plus asserting a `drawings:read`-only
key gets a 403 on writes. Everything it starts is torn down in a `finally`,
success or failure.

Requires `backend/` to have its dependencies installed and its Prisma client
generated (`cd backend && npm install && npx prisma generate`) — the harness
runs the backend in-process via its own `ts-node` devDependency; it does not
shell out to `make dev`.

```sh
npm run build && npm test && npm run test:e2e
```

This is also wired as a CI job (`mcp-tests` in
`.github/workflows/test.yml`), independent of the frontend/backend/e2e
browser jobs — it builds and tests `mcp-server/` and, since it has no
external network dependency (its "backend" is a local ephemeral process),
runs the full `test:e2e` script too.

## Deployment

This server is **never deployed** — it is a local subprocess of whatever
agent runs it, one per developer/machine, holding that person's own scoped
API key. It is intentionally absent from `docker-compose.selfhost.yml` and
Coolify.

The **backend change** this project depends on (`backend/src/middleware/auth.ts`
reachability for duplicate/history/restore/shared-list under existing scopes,
no new scope) *does* need to reach whatever backend this server talks to. See
`docker-compose.selfhost.yml`'s comment block for the current status and the
exact options to get it there.
