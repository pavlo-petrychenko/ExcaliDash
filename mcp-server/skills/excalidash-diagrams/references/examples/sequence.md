# Example: sequence-ish diagram (manual layout)

`DiagramSpec` has no first-class "lifeline" concept, so a UML-style sequence
diagram is approximated with `layout.type:"manual"`: give each participant
its own fixed `x` column, and increase `y` down the page as time passes. This
is the recipe for "I need a specific geometric arrangement `flow`/`grid`
can't express" — manual layout requires `x`/`y` on every node.

```json
{
  "title": "Fetch User Profile",
  "nodes": [
    { "id": "s1", "label": "1. GET /profile", "x": 0, "y": 0 },
    { "id": "s2", "label": "2. Validate session + query DB", "x": 400, "y": 140, "width": 340 },
    { "id": "s3", "label": "3. Return profile row", "x": 800, "y": 280, "role": "data", "width": 260 },
    { "id": "s4", "label": "4. Build JSON response", "x": 400, "y": 420, "width": 280 },
    { "id": "s5", "label": "5. 200 OK + profile JSON", "x": 0, "y": 560, "width": 300 }
  ],
  "edges": [
    { "from": "s1", "to": "s2" },
    { "from": "s2", "to": "s3" },
    { "from": "s3", "to": "s4" },
    { "from": "s4", "to": "s5" }
  ],
  "layout": { "type": "manual" }
}
```

Why this reads clean:
- Each participant (client / server / database) owns one fixed `x` column
  (`0` / `400` / `800`), so every step's horizontal position tells you *who*
  is acting, and increasing `y` tells you *when* — the two axes readers
  expect from a sequence diagram.
- Node labels are numbered (`"1. ..."`, `"2. ..."`) since arrows alone
  don't carry the same obvious left-to-right/top-to-bottom step order a
  `flow` layout's ranks would.
- `s3` (the database's reply) uses `role:"data"` to flag it as a data-layer
  step, consistent with the palette convention even outside a `flow`
  diagram.
- Manual layout means **you** must keep columns far enough apart
  (`x` deltas here are 400px, well past the default 180px node width) and
  rows far enough apart (140px `y` deltas, past the default 80px node
  height) — there's no automatic overlap-avoidance in this mode.

If the sequence has many more steps, consider whether it's actually a
`flow` diagram in disguise (a linear chain with no real "which column" axis)
— `flow` needs far less manual bookkeeping and gets the same left-to-right
narrative with `direction:"right"`.
