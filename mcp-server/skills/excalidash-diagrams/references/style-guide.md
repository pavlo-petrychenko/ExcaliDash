# Style guide

The curated palette, sizing, and font defaults `scene/spec.ts` applies to a
`DiagramSpec`. These are the exact constants the server uses — cite them
instead of guessing.

## Role → background color palette

`DiagramSpec` node `role` picks one of these (Excalidraw's own default
background swatches, so diagrams match the app's native look):

| role | hex | swatch | typical use |
|---|---|---|---|
| `process` | `#a5d8ff` | blue | a normal action/step (default for `shape:"rectangle"`) |
| `decision` | `#ffec99` | yellow | a branch point (default for `shape:"diamond"`) |
| `terminator` | `#b2f2bb` | green | a start/end point (default for `shape:"ellipse"`) |
| `data` | `#eebefa` | violet | a data store / external data reference |
| `accent` | `#ffc9c9` | red | an error/failure/highlight box |

## Shape → default role (when `role`/`color` are unset)

| shape | default role |
|---|---|
| `rectangle` | `process` |
| `diamond` | `decision` |
| `ellipse` | `terminator` |

Resolution order for a node's fill color: explicit `color` (hex) wins over
`role` wins over the shape's default role above. Prefer `role` over `color`
so diagrams built at different times still share one consistent palette —
only fall back to an explicit `color` when you need a shade outside this
curated set (e.g. matching an existing brand color).

## Sizing

| constant | value |
|---|---|
| default node width | 180 px |
| default node height | 80 px |
| default node label font size | 20 px |
| default title font size | 28 px |
| gap between a title and the diagram body below it | 24 px |

Override `width`/`height` per node when a label is unusually long — better to
widen one box deliberately than to let every node in the diagram grow to
accommodate the longest label.

## Layout spacing

| constant | value |
|---|---|
| default horizontal gap between node boxes (`layout.spacingX`) | 120 px |
| default vertical gap between node boxes (`layout.spacingY`) | 100 px |

## Edges

- Default arrow style: `solid` line, `arrow` (open triangle) head at the
  `to` end, no head at the `from` end.
- `style:"dashed"`/`"dotted"` for a secondary/optional relationship.
- `arrowhead:"none"` draws a plain line-like connector (still bound to both
  nodes) — use for undirected relationships.
- Put a short label on the edge itself (`edges[].label`, e.g. `"yes"`/`"no"`
  off a decision diamond) rather than restating the branch condition in the
  target node's own label.

## Fonts

Excalidraw ships several font families; the DiagramSpec path always uses the
default (fontFamily 5, "Excalifont" — Excalidraw's own hand-drawn font,
line-height 1.25) for node labels and titles. If you drop to the `skeleton`
escape hatch and set a different `fontFamily` explicitly, keep its
`lineHeight` matched to what that family expects (Virgil 1.25, Helvetica
1.15, Cascadia 1.2, Nunito 1.35, Lilita One 1.15, Comic Shanns 1.25,
Liberation Sans 1.15) — a mismatch surfaces as a validation warning.

## One consistent look, every time

- One palette (above), not ad-hoc colors per diagram.
- One stroke width / roughness across a diagram — don't mix a hand-drawn
  `roughness:2` box with an architect-precise `roughness:0` box in the same
  scene unless that contrast is the point.
- Shape carries meaning (process/decision/terminator) — don't use a diamond
  for a non-decision step just because it looks different.
