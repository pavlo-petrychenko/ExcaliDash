/**
 * SSRF-guarded resolution of `files[id].dataURL` before rendering (plan §4-render
 * `images.ts`, §0.2 #9, threat model row "SSRF via render image fetch"). A scene's
 * `files` map is untrusted data read back from the backend (plan §4.7) — an
 * `image` element's file can in principle carry an arbitrary `http(s)` URL, so
 * this module only ever fetches one that:
 *   1. is `https://` (or `http://` only when the configured backend itself runs
 *      insecure via `EXCALIDASH_ALLOW_INSECURE`, mirroring `api/client.ts`'s policy);
 *   2. has a hostname matching the configured `EXCALIDASH_BASE_URL` origin — no
 *      open allow-list beyond the user's own backend, since that's the only host a
 *      legitimate ExcaliDash-hosted `dataURL` ever points at;
 *   3. resolves (DNS) to a public IP — private/loopback/link-local/unspecified
 *     ranges are rejected before any request is made.
 * Anything else, or any fetch failure, is a **warning**, never a thrown error —
 * per plan, a render must never fail wholesale because one image couldn't be
 * resolved; the unresolved entry is simply dropped from the returned `files` map
 * (the image element then draws as empty rather than crashing the export).
 */
import { lookup } from "node:dns/promises";
import { cfAccessHeaders, getConfig, type McpConfig } from "../config.js";
import type { BinaryFiles } from "../scene/excalidrawVendor.js";

/** `BinaryFileData["dataURL"]` is a branded `string & {_brand:"DataURL"}` — this file only ever builds well-formed data: URIs. */
type DataURLValue = BinaryFiles[string]["dataURL"];
function asDataURL(value: string): DataURLValue {
  return value as DataURLValue;
}

const FETCH_TIMEOUT_MS = 10_000;

export interface ResolveImagesResult {
  files: BinaryFiles;
  warnings: string[];
}

/** `config` defaults to the process-wide singleton; tests pass an explicit one (mirrors `api/client.ts`'s `createApiClient`). */
export async function resolveImages(
  files: BinaryFiles | null | undefined,
  config: McpConfig = getConfig(),
): Promise<ResolveImagesResult> {
  const warnings: string[] = [];
  if (!files) return { files: {}, warnings };

  const allowedHost = safeHostOf(config.baseUrl);
  const resolved: BinaryFiles = {};

  for (const [id, file] of Object.entries(files)) {
    if (!file || typeof file.dataURL !== "string") continue;

    if (file.dataURL.startsWith("data:")) {
      resolved[id] = file;
      continue;
    }

    const outcome = await resolveRemoteImage(file.dataURL, allowedHost, config.allowInsecure, config.cfAccess);
    if (outcome.ok) {
      resolved[id] = { ...file, dataURL: asDataURL(outcome.dataURL) };
    } else {
      warnings.push(`Image '${id}' could not be resolved (${outcome.reason}); it will render as empty.`);
    }
  }

  return { files: resolved, warnings };
}

type RemoteImageOutcome = { ok: true; dataURL: string } | { ok: false; reason: string };

async function resolveRemoteImage(
  url: string,
  allowedHost: string | undefined,
  allowInsecure: boolean,
  cfAccess: McpConfig["cfAccess"],
): Promise<RemoteImageOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "not a data: URI or a valid URL" };
  }

  if (parsed.protocol !== "https:" && !(allowInsecure && parsed.protocol === "http:")) {
    return { ok: false, reason: `blocked non-TLS URL (${parsed.protocol}//...)` };
  }
  if (!allowedHost || parsed.hostname !== allowedHost) {
    return { ok: false, reason: `host '${parsed.hostname}' is not the configured EXCALIDASH_BASE_URL origin` };
  }

  let address: string;
  try {
    address = (await lookup(parsed.hostname)).address;
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }
  if (isDisallowedIp(address)) {
    return { ok: false, reason: `resolved to a private/loopback/link-local address (${address})` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: cfAccessHeaders({ cfAccess }),
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ok: true, dataURL: `data:${contentType};base64,${buffer.toString("base64")}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

function safeHostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

/** True for IPv4/IPv6 private, loopback, link-local, or unspecified ranges — never fetched. */
export function isDisallowedIp(address: string): boolean {
  if (address.includes(":")) return isDisallowedIpv6(address);
  return isDisallowedIpv4(address);
}

function isDisallowedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true; // unparseable -> reject, never fetch
  }
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true; // "this network"
  return false;
}

function isDisallowedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80::")) return true; // link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(normalized)) return true; // unique local (fc00::/7)
  if (normalized.startsWith("::ffff:")) return isDisallowedIpv4(normalized.slice("::ffff:".length));
  return false;
}
