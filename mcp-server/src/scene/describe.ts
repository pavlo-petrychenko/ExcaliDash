/**
 * Cheap textual scene summary (plan §2.2 `excalidash_get_drawing view:"summary"`,
 * research 07 "describe-scene"): counts by element type, node labels, the
 * from→to edge list, and overall bounds — computed directly from the already-
 * normalized elements array, no render needed. `describeScene()` returns
 * structured data (for tests/other callers); `formatSceneDescription()` renders
 * it as the markdown text a tool actually returns, with every user-authored
 * string routed through `untrusted.ts` and the whole block prefixed with the
 * untrusted-data marker.
 */
import type { OrderedExcalidrawElement } from "./excalidrawVendor.js";
import { quoteUntrustedText, sanitizeLink, withUntrustedMarker } from "./untrusted.js";

export interface SceneNode {
  id: string;
  type: string;
  label: string | null;
}

export interface SceneEdge {
  id: string;
  from: string | null;
  to: string | null;
  label: string | null;
}

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface SceneDescription {
  elementCount: number;
  countsByType: Record<string, number>;
  nodes: SceneNode[];
  edges: SceneEdge[];
  bounds: SceneBounds | null;
}

/** "Bindable" shape types that can host a label and that arrows bind to (research 07 §5.3). */
const NODE_TYPES = new Set(["rectangle", "diamond", "ellipse", "image", "frame"]);
const LINEAR_TYPES = new Set(["arrow", "line"]);

export function describeScene(elements: readonly OrderedExcalidrawElement[]): SceneDescription {
  const live = elements.filter((element) => !element.isDeleted);
  const byId = new Map(live.map((element) => [element.id, element] as const));
  const countsByType: Record<string, number> = {};
  for (const element of live) {
    countsByType[element.type] = (countsByType[element.type] ?? 0) + 1;
  }

  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  for (const element of live) {
    if (NODE_TYPES.has(element.type)) {
      nodes.push({ id: element.id, type: element.type, label: findBoundLabel(element, byId) });
    } else if (LINEAR_TYPES.has(element.type) && "startBinding" in element) {
      edges.push({
        id: element.id,
        from: element.startBinding?.elementId ?? null,
        to: element.endBinding?.elementId ?? null,
        label: findBoundLabel(element, byId),
      });
    }
  }

  return { elementCount: live.length, countsByType, nodes, edges, bounds: computeBounds(live) };
}

function findBoundLabel(
  element: OrderedExcalidrawElement,
  byId: ReadonlyMap<string, OrderedExcalidrawElement>,
): string | null {
  for (const bound of element.boundElements ?? []) {
    if (bound.type !== "text") continue;
    const text = byId.get(bound.id);
    if (text && text.type === "text") return text.text;
  }
  return null;
}

function computeBounds(elements: readonly OrderedExcalidrawElement[]): SceneBounds | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Renders a `SceneDescription` as the untrusted-framed markdown text a tool returns. */
export function formatSceneDescription(description: SceneDescription): string {
  const lines: string[] = [];
  lines.push(`${description.elementCount} element(s):`);
  for (const [type, count] of Object.entries(description.countsByType).sort()) {
    lines.push(`- ${type}: ${count}`);
  }

  if (description.nodes.length > 0) {
    lines.push("", "Nodes:");
    for (const node of description.nodes) {
      const label = node.label !== null ? quoteUntrustedText(node.label) : "(no label)";
      lines.push(`- ${node.id} [${node.type}]: ${label}`);
    }
  }

  if (description.edges.length > 0) {
    lines.push("", "Edges:");
    for (const edge of description.edges) {
      const from = edge.from ?? "(unbound)";
      const to = edge.to ?? "(unbound)";
      const label = edge.label !== null ? ` labeled ${quoteUntrustedText(edge.label)}` : "";
      lines.push(`- ${edge.id}: ${from} -> ${to}${label}`);
    }
  }

  if (description.bounds) {
    const { minX, minY, width, height } = description.bounds;
    lines.push("", `Bounds: x=${round(minX)}, y=${round(minY)}, width=${round(width)}, height=${round(height)}`);
  }

  return withUntrustedMarker(lines.join("\n"));
}

/** Re-exported for callers that need to sanitize a `link` field alongside a description. */
export { sanitizeLink };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
