# Example: architecture diagram

A small web service architecture, grouped into two labeled frames (`Edge` and
`Application`) plus an external `data`-role dependency. `frame` is the right
tool whenever you want a visually distinct labeled boundary around a subset
of nodes — the library auto-sizes each frame from its children, so you never
set a frame's own geometry.

```json
{
  "title": "Web Service Architecture",
  "nodes": [
    { "id": "client", "label": "Browser client", "shape": "ellipse" },
    { "id": "lb", "label": "Load Balancer", "frame": "Edge" },
    { "id": "api1", "label": "API Server (a)", "frame": "Application", "group": "api" },
    { "id": "api2", "label": "API Server (b)", "frame": "Application", "group": "api" },
    { "id": "queue", "label": "Job Queue", "frame": "Application", "role": "data" },
    { "id": "worker", "label": "Background Worker", "frame": "Application", "width": 220 },
    { "id": "db", "label": "Postgres", "shape": "rectangle", "role": "data" }
  ],
  "edges": [
    { "from": "client", "to": "lb" },
    { "from": "lb", "to": "api1" },
    { "from": "lb", "to": "api2" },
    { "from": "api1", "to": "queue" },
    { "from": "api2", "to": "queue" },
    { "from": "queue", "to": "worker" },
    { "from": "api1", "to": "db" },
    { "from": "api2", "to": "db" },
    { "from": "worker", "to": "db" }
  ],
  "layout": { "type": "flow", "direction": "right" }
}
```

Why this reads clean:
- `direction:"right"` fits a request-flows-left-to-right architecture
  diagram better than the default top-to-bottom (which reads more like a
  process/flowchart).
- The two `api1`/`api2` replicas share `group:"api"` so auto-layout keeps
  them adjacent instead of scattered across ranks.
- `queue` and `db` use `role:"data"` (violet) so data stores are visually
  distinct from compute nodes without inventing a new shape convention.
- Every node inside the request path carries a `frame` name matching its
  logical tier (`Edge` vs `Application`); `db` is deliberately left un-framed
  since it's an external dependency both tiers share, not part of either.

For a large architecture diagram, prefer `excalidash_render mode:"frame"
frame_id:"<frame's element id>"` to zoom into one tier cheaply instead of
re-rendering the whole diagram.
