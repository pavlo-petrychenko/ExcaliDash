# Example: flowchart

A password-reset flow: a linear happy path plus one decision branch. This is
the shape of diagram `layout.type:"flow"` (the default) handles best —
there's a clear "what happens after what."

Call `excalidash_create_diagram` with `name` set and this object as `spec`:

```json
{
  "title": "Password Reset",
  "nodes": [
    { "id": "start", "label": "User requests reset", "shape": "ellipse", "width": 240 },
    { "id": "valid", "label": "Email on file?", "shape": "diamond" },
    { "id": "send", "label": "Send reset email", "shape": "rectangle", "width": 210 },
    { "id": "confirm", "label": "User sets new password", "shape": "rectangle", "width": 280 },
    { "id": "done", "label": "Reset complete", "shape": "ellipse" },
    { "id": "error", "label": "Show \"no account found\" error", "shape": "rectangle", "role": "accent", "width": 360 }
  ],
  "edges": [
    { "from": "start", "to": "valid" },
    { "from": "valid", "to": "send", "label": "yes" },
    { "from": "valid", "to": "error", "label": "no" },
    { "from": "send", "to": "confirm" },
    { "from": "confirm", "to": "done" }
  ],
  "layout": { "type": "flow", "direction": "down" }
}
```

Why this reads clean:
- The two terminators (`start`, `done`) are `ellipse`; every intermediate
  step is a plain `rectangle`; the one branch point is a `diamond` — shape
  always matches the role-convention in `references/style-guide.md`.
- The failure path (`error`) uses `role:"accent"` (red) so it visually
  stands out from the happy path without needing a different shape.
- Edge labels (`"yes"`/`"no"`) carry the branch condition — `valid`'s own
  label stays a plain yes/no question, not "email on file? if yes then...".
- `direction:"down"` reads top-to-bottom like a flowchart on paper.
- Every node with a label longer than the default 180px box comfortably
  fits sets an explicit `width` (per the "Label may overflow its box"
  warning) — widen the box rather than shrink the font.

After creating it, look at the returned PNG: the `error` box should sit off
to one side of the main column (it's a leaf with only `valid` as a
predecessor, so the barycenter pass keeps it out of the primary path's way)
rather than crossing back through `send`/`confirm`.
