# Layout recipes

How `scene/layout.ts` turns `nodes` + `edges` + `layout` into `(x, y)` per
node, and recipes for common diagram shapes. Layout is deterministic given
the same input (no randomness) — the same spec always produces the same
positions.

## The three strategies

### `flow` (default) — layered, edge-following

1. Treats `nodes`/`edges` as a directed graph. Ranks are assigned by
   **longest path from a root** (a node with no incoming edge); a node's
   rank is always exactly one more than its furthest-back predecessor, so
   ranks read as "steps since the start."
2. **Cycles** are handled by ignoring "back-edges" (an edge to a node
   already on the current DFS path) purely for the ranking computation — the
   edge is still drawn, it just doesn't push its target to a later rank. A
   cyclic flow (e.g. a retry loop) lays out fine; the back-edge will loop
   back visually rather than pushing the diagram infinitely deeper.
3. Within a rank, one **barycenter pass** orders nodes by the average
   position of their predecessors in the previous rank (a node with no
   placed predecessor keeps its input-order position) — this is what keeps
   edges from needlessly criss-crossing.
4. A stable **group-sort** then clusters same-`group` nodes together within
   their rank.
5. Ranks stack along `direction` (`"down"` = rows top-to-bottom, `"right"` =
   columns left-to-right); spacing between and within ranks is computed from
   each node's **actual** width/height (not a fixed slot), so custom-sized
   nodes never overlap their neighbors.

Use `flow` for: processes, flowcharts, pipelines, decision trees, anything
with a "what happens after what" structure. This is the right default for
almost every diagram.

### `grid` — uniform wrap, no implied order

1. Nodes are stable-sorted by `group` (ungrouped nodes share one bucket and
   keep their input order) so grouped nodes end up adjacent.
2. Arranged into `ceil(sqrt(n))` columns, row-major.
3. Column widths and row heights are each sized from the actual nodes placed
   in them — again, no fixed slot size, so mixed node sizes don't overlap.

Use `grid` for: a set of unrelated/parallel items with no meaningful
ordering — a list of services, a feature comparison, icons with labels.
Don't force a `grid` through edges meant to show sequence; use `flow` for
that instead.

### `manual` — you own every position

Every node must carry both `x` and `y`; they pass through unchanged and
overlap-avoidance becomes your responsibility. Use only when you have a
specific geometric layout in mind that `flow`/`grid` can't express (e.g.
mimicking a reference diagram's exact positions, or laying out non-flowchart
shapes like a floor plan).

## Recipe: simple linear process

```json
{
  "nodes": [
    { "id": "a", "label": "Request received" },
    { "id": "b", "label": "Validate" },
    { "id": "c", "label": "Process" },
    { "id": "d", "label": "Respond", "shape": "ellipse" }
  ],
  "edges": [
    { "from": "a", "to": "b" }, { "from": "b", "to": "c" }, { "from": "c", "to": "d" }
  ],
  "layout": { "type": "flow", "direction": "down" }
}
```

## Recipe: decision branch (see also SKILL.md §3)

Give the decision node `shape:"diamond"` and label each outgoing edge with
the branch condition (`"yes"`/`"no"`, or a short condition phrase) rather
than encoding the condition into the target node's own label.

## Recipe: swimlanes via grouped flow

`flow` doesn't have a first-class "lane" concept, but grouping achieves the
same visual effect: give every node in a lane the same `group` string. Within
each rank, same-group nodes cluster together, which reads as informal lanes
when combined with consistent roles per lane (e.g. all `role:"process"` in
one lane, all `role:"data"` in another).

## Recipe: unrelated services (grid)

```json
{
  "nodes": [
    { "id": "auth", "label": "Auth Service", "role": "data" },
    { "id": "billing", "label": "Billing Service", "role": "data" },
    { "id": "search", "label": "Search Service", "role": "data" },
    { "id": "notify", "label": "Notification Service", "role": "data" }
  ],
  "layout": { "type": "grid" }
}
```

## Recipe: frames (grouping by a labeled box)

Give every node that belongs together the same `frame` name — the library
draws a labeled box around them and auto-sizes it to fit; you never set a
frame's own `width`/`height`/`x`/`y`.

```json
{
  "nodes": [
    { "id": "req", "label": "HTTP Request", "frame": "Edge" },
    { "id": "lb", "label": "Load Balancer", "frame": "Edge" },
    { "id": "api", "label": "API Server", "frame": "Application" },
    { "id": "worker", "label": "Worker", "frame": "Application" }
  ],
  "edges": [
    { "from": "req", "to": "lb" }, { "from": "lb", "to": "api" }, { "from": "api", "to": "worker" }
  ],
  "layout": { "type": "flow", "direction": "right" }
}
```

## Spacing math (for when you need to override defaults)

- Default node box: 180×80 px. Default gaps: `spacingX` 120 px, `spacingY`
  100 px.
- In `flow` with `direction:"down"`: the gap **between ranks** (rows) is
  `spacingY`; the gap **within a rank** (between neighboring columns) is
  `spacingX`. With `direction:"right"` these swap (between-rank gap is
  `spacingX`, within-rank is `spacingY`).
- If your labels are consistently longer than the 180 px default width,
  raise `width` on those nodes rather than shrinking font size — shrinking
  fonts breaks the diagram's visual consistency (§ style-guide.md).
- If a `flow` diagram reads as too tall/narrow, try flipping
  `direction:"down"` ↔ `"right"` before reaching for manual layout.

## No-overlap guarantee

Both `flow` and `grid` compute every gap from the *actual* dimensions of the
nodes involved (not a fixed slot), so as long as you don't switch to
`manual`, laid-out node boxes never overlap each other — regardless of
custom per-node `width`/`height`. `manual` layout has no such guarantee; you
are responsible for spacing.
