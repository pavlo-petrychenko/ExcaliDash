/**
 * Starts/stops a throwaway local ExcaliDash backend for the e2e harness
 * (plan §7 "Against local `make dev` backend", T9). Deliberately does NOT
 * shell out to `make dev`/nodemon: it runs the backend directly via its own
 * `ts-node` devDependency (no restart-on-save churn, one predictable child
 * process to reap) against a fresh, isolated SQLite file under the OS tmp
 * dir — never the developer's own `backend/prisma/dev.db`.
 *
 * The MCP client's `EXCALIDASH_BASE_URL` is the PUBLIC origin a reverse proxy
 * rewrites `/api/*` from (see `mcp-server/src/api/client.ts`'s
 * `${baseUrl}/api${path}` and `frontend/vite.config.ts`'s dev proxy /
 * `docker-compose.selfhost.yml`'s nginx layer) — the bare backend has no
 * `/api` prefix of its own. Rather than also standing up the frontend/Vite
 * just for that rewrite, this starts a ~15-line in-process HTTP proxy that
 * does the same strip-`/api`-and-forward.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKEND_DIR } from "./paths.mjs";
import { getFreePorts } from "./ports.mjs";
import { seedBackend } from "./seed.mjs";

const HEALTH_TIMEOUT_MS = 30_000;
const API_KEY_HASH_PEPPER = "excalidash-mcp-e2e-pepper";

function tsNodeBin() {
  return path.join(BACKEND_DIR, "node_modules", ".bin", process.platform === "win32" ? "ts-node.cmd" : "ts-node");
}

function runMigrations(databaseUrl) {
  const result = spawnSync(process.execPath, [path.join(BACKEND_DIR, "scripts/provider-prisma.cjs"), "migrate", "deploy"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_PROVIDER: "sqlite" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`backend migrate deploy failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

async function waitForHealth(backendPort) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/health`);
      if (response.ok) return;
      lastError = new Error(`/health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`backend never became healthy on port ${backendPort}: ${lastError?.message ?? "unknown error"}`);
}

/** Strips a leading `/api` and forwards everything else to the backend (mirrors nginx/vite's dev proxy rewrite). */
function startApiProxy(backendPort, proxyPort) {
  const server = http.createServer((req, res) => {
    const targetPath = req.url.replace(/^\/api(?=\/|$)/, "") || "/";
    const upstream = http.request(
      { host: "127.0.0.1", port: backendPort, path: targetPath, method: req.method, headers: req.headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502);
      res.end(`e2e proxy: upstream error: ${error.message}`);
    });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(proxyPort, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Starts an isolated backend + proxy, seeds it with a full-scope and a
 * read-only API key, and returns everything the scenario needs plus a
 * `stop()` to tear it all down (process, proxy, tmp dir) — safe to call once,
 * always, including after a startup failure.
 */
export async function startEphemeralBackend() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "excalidash-mcp-e2e-"));
  const databaseUrl = `file:${path.join(tmpDir, "e2e.db")}`;
  const logPath = path.join(tmpDir, "backend.log");
  const { backendPort, proxyPort } = await getFreePorts();

  let backendProcess;
  let proxyServer;
  const stop = async () => {
    if (proxyServer) await new Promise((resolve) => proxyServer.close(resolve));
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => backendProcess.once("exit", resolve)),
        delay(5_000).then(() => backendProcess.kill("SIGKILL")),
      ]);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  try {
    runMigrations(databaseUrl);
    const { fullToken, readOnlyToken } = await seedBackend(databaseUrl, API_KEY_HASH_PEPPER);

    const logStream = fs.createWriteStream(logPath);
    backendProcess = spawn(tsNodeBin(), ["--transpile-only", "src/index.ts"], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PORT: String(backendPort),
        DATABASE_URL: databaseUrl,
        AUTH_MODE: "local",
        NODE_ENV: "development",
        JWT_SECRET: "excalidash-mcp-e2e-jwt-secret-at-least-32-chars",
        CSRF_SECRET: "excalidash-mcp-e2e-csrf-secret",
        API_KEY_HASH_PEPPER,
        FRONTEND_URL: `http://127.0.0.1:${proxyPort}`,
        ENFORCE_HTTPS_REDIRECT: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backendProcess.stdout.pipe(logStream);
    backendProcess.stderr.pipe(logStream);

    await waitForHealth(backendPort);
    proxyServer = await startApiProxy(backendPort, proxyPort);

    return {
      baseUrl: `http://127.0.0.1:${proxyPort}`,
      fullToken,
      readOnlyToken,
      logPath,
      stop,
    };
  } catch (error) {
    await stop().catch(() => {});
    if (fs.existsSync(logPath)) {
      error.message += `\n--- backend.log ---\n${fs.readFileSync(logPath, "utf8").slice(-4000)}`;
    }
    throw error;
  }
}
