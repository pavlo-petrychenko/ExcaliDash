# Element schema reference

Exact shapes accepted by `excalidash_create_diagram` / `excalidash_edit_diagram`
(`ops[].action:"add"`/`"replace_all"`). There are three input paths — pick the
narrowest one that does the job.

## 1. `spec` (DiagramSpec) — the ergonomic default

```ts
{
  title?: string,                 // optional heading placed above the diagram
  nodes: [{
    id: string,                   // required, unique; edges/ops reference nodes by this
    label: string,                // required, text shown inside the node
    shape?: "rectangle" | "ellipse" | "diamond",   // default "rectangle"
    role?: "process" | "decision" | "terminator" | "data" | "accent",
    color?: string,                // explicit background hex; overrides role and shape default
    group?: string,                // same-group nodes are clustered adjacent by auto-layout
    frame?: string,                // same-frame nodes get a labeled frame box drawn around them
    width?: number,                 // px, default 180
    height?: number,                // px, default 80
    x?: number, y?: number,         // px; REQUIRED on every node only when layout.type is "manual"
  }],
  edges?: [{
    from: string, to: string,      // required, must match a node id each
    label?: string,
    style?: "solid" | "dashed" | "dotted",   // default "solid"
    arrowhead?: "arrow" | "triangle" | "none", // default "arrow"; "none" draws a plain connector
  }],
  layout?: {
    type?: "flow" | "grid" | "manual",   // default "flow"
    direction?: "down" | "right",        // default "down"; flow-only
    spacingX?: number,                   // default 120
    spacingY?: number,                   // default 100
  },
  theme?: "light" | "dark",        // default "light"; cosmetic, informational only today
}
```

Notes:
- `nodes` must have at least one entry. Node `id`s must be unique — a
  duplicate id is rejected before layout even runs.
- Every edge `from`/`to` must reference an existing node id — an unknown id
  produces `DiagramSpec edge references unknown <end> node '<id>'. Valid
  node ids: [...].` before anything is persisted.
- `x`/`y` are ignored unless `layout.type` is `"manual"`; when it is,
  **every** node needs both, or you get `layout.type is 'manual' but
  node(s) [...] are missing x/y.`

## 2. `skeleton` — power-user path (`ExcalidrawElementSkeleton[]`)

An array where every entry needs at minimum a `type`. Common shape entries:

```ts
{
  type: "rectangle" | "ellipse" | "diamond",
  id?: string,                 // supply your own id if other elements bind to it
  x: number, y: number,        // top-left origin, y grows down, px
  width?: number, height?: number,
  backgroundColor?: string,    // hex
  strokeColor?: string,        // hex
  strokeWidth?: number,
  strokeStyle?: "solid" | "dashed" | "dotted",
  fillStyle?: "solid" | "hachure" | "cross-hatch",
  roughness?: number,          // 0=architect, 1=artist (default), 2=cartoonist
  roundness?: { type: 3 },     // rounded corners
  label?: { text: string, fontSize?: number },   // attaches a centered bound text — do NOT
                                                  // create a separate floating text element instead
}
```

Arrow entries bind by id, never by index or coordinates:

```ts
{
  type: "arrow",
  x: 0, y: 0,                  // placeholder; actual geometry is computed from the binding
  start: { id: "<source node id>" },
  end: { id: "<target node id>" },
  label?: { text: string },
  strokeStyle?: "solid" | "dashed" | "dotted",
  startArrowhead?: "arrow" | "triangle" | null,
  endArrowhead?: "arrow" | "triangle" | null,
}
```

Other useful entries: `text` (standalone label, `{ type:"text", x, y, text,
fontSize? }`), `frame` (`{ type:"frame", name, children: [nodeIds] }` — the
library auto-sizes the frame from its children's bounds, so you never set
`width`/`height` on a frame), `image`/`line`/`freedraw` for less common cases.

This path is normalized through `convertToExcalidrawElements`, which:
- auto-wires the label ↔ container `boundElements`/`containerId` back-reference,
- computes arrow `startBinding`/`endBinding` (with `focus`/`gap`) and their
  reciprocal `boundElements` entry on the bound shape,
- measures text and assigns valid fractional `index` values.

**Never hand-author any of the above bindings/indices yourself** — always go
through `spec`/`skeleton`, never construct a raw `elements` entry with
guessed `boundElements`/`startBinding`/`index` fields.

## 3. `elements` — escape hatch (raw, already-complete elements)

A raw Excalidraw elements array — typically round-tripped from
`excalidash_get_drawing view:"full"`, edited in place, and passed back. This
path runs through `restoreElements({ repairBindings: true })`, which:
- backfills any missing default fields,
- regenerates missing `seed`/`versionNonce`,
- repairs `containerId`/`boundElements`/`startBinding`/`endBinding`
  reciprocal references if you broke one while editing,
- normalizes z-order/fractional indices.

Use this only when you genuinely need full manual control over an existing
element (e.g. you already have its exact persisted shape and just need to
tweak one field) — for everything else, `spec` or `skeleton` is safer because
mistakes there are caught by validation before they're persisted.

## Validation you'll see (all three paths, after normalization)

Errors (abort the mutation, message returned verbatim so you can fix input):
- `Scene has N elements; max 10000. Split into multiple drawings.`
- `Element '<id>' has non-finite <field> (<value>).`
- `Arrow '<id>' references missing <start|end> node '<id>'. Valid node ids: [...].`
- `Text '<id>' has containerId '<id>', which does not exist.`
- `Text '<id>' is bound to container '<id>' but the container's boundElements
  does not list it back — a broken binding.`
- `Element '<id>' lists bound text '<id>' that does not reciprocally point
  back to it — a broken binding.`

Warnings (ride along with a successful response, don't block it):
- `Label '<text>' may overflow its box (~Wpx vs Upx usable); widen the node
  or shorten the text.`
- `Text '<id>' uses fontFamily N with lineHeight L; expected E for that
  family.`
- `Element '<id>' lists bound arrow '<id>' that does not reciprocally bind
  back to it.`

## Coordinate system

Top-left origin. `x` increases rightward, `y` increases **downward**. All
sizes/positions are in px. There is no implicit canvas boundary — the canvas
grows to fit whatever you place; a diagram crammed into one corner is a
layout choice you made, not a hard limit.
