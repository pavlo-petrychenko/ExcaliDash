/**
 * Minimal assertion + step-logging helpers for the e2e harness — deliberately
 * not a test framework dependency: this script asserts against a REAL running
 * backend + a REAL subprocess, so a plain fail-fast `Error` with context is
 * more useful here than vitest's harness (which is for the faked-backend unit
 * tests in `src/tools/*.test.ts`).
 */

export class E2EAssertionError extends Error {}

export function assert(condition, message) {
  if (!condition) throw new E2EAssertionError(message);
}

/** Runs `fn`, logging start/pass/fail with the step name, and rethrows on failure (fail-fast). */
export async function step(name, fn) {
  process.stdout.write(`-> ${name}\n`);
  try {
    const result = await fn();
    process.stdout.write(`   ok\n`);
    return result;
  } catch (error) {
    process.stdout.write(`   FAILED\n`);
    throw error;
  }
}

/** Extracts the first text content block from a `CallToolResult`. */
export function textOf(result) {
  const block = result.content.find((entry) => entry.type === "text");
  assert(block, "tool result has no text content block");
  return block.text;
}

/** True if the result contains a native image content block (the render->look->fix loop's PNG). */
export function hasImageBlock(result) {
  return result.content.some((entry) => entry.type === "image" && entry.mimeType === "image/png");
}

/** Pulls an id out of the `"<name> (id: <id>)"` convention shared by every tool's summary text (`shared.ts`'s `idWithName`). */
export function extractId(text) {
  const match = text.match(/\(id: ([^)]+)\)/);
  assert(match, `expected "(id: ...)" in text: ${text}`);
  return match[1];
}

/** Pulls the first `- <snapshotId>:` line's id out of `manage_drawing action:"list_history"`'s text. */
export function extractFirstSnapshotId(text) {
  const match = text.match(/^- ([^:]+):/m);
  assert(match, `expected a "- <snapshotId>: ..." line in text: ${text}`);
  return match[1];
}

/** Parses the JSON payload out of a `get_drawing view:"full" response_format:"json"` result (untrusted-marker-prefixed text). */
export function parseFullViewJson(text) {
  const jsonStart = text.indexOf("{");
  assert(jsonStart !== -1, `expected JSON in full-view text: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(jsonStart));
}
