# Example: decision tree

A support-ticket triage decision tree — three chained yes/no questions, each
with a `diamond` and two labeled outgoing edges. This is the pattern for
"classify X by asking a series of questions" diagrams.

```json
{
  "title": "Ticket Priority Triage",
  "nodes": [
    { "id": "q1", "label": "Is it a security issue?", "shape": "diamond", "width": 280 },
    { "id": "p0sec", "label": "P0 - Security incident", "shape": "rectangle", "role": "accent", "width": 270 },
    { "id": "q2", "label": "Is production down?", "shape": "diamond", "width": 240 },
    { "id": "p0out", "label": "P0 - Outage", "shape": "rectangle", "role": "accent" },
    { "id": "q3", "label": "Affects more than 10% of users?", "shape": "diamond", "width": 380 },
    { "id": "p1", "label": "P1 - High priority", "shape": "rectangle", "width": 220 },
    { "id": "p2", "label": "P2 - Normal priority", "shape": "rectangle", "width": 250 }
  ],
  "edges": [
    { "from": "q1", "to": "p0sec", "label": "yes" },
    { "from": "q1", "to": "q2", "label": "no" },
    { "from": "q2", "to": "p0out", "label": "yes" },
    { "from": "q2", "to": "q3", "label": "no" },
    { "from": "q3", "to": "p1", "label": "yes" },
    { "from": "q3", "to": "p2", "label": "no" }
  ],
  "layout": { "type": "flow", "direction": "down" }
}
```

Why this reads clean:
- Every question is a `diamond`; every outcome is a plain `rectangle` —
  consistent shape-per-role, no ad-hoc mixing.
- The two P0 outcomes use `role:"accent"` so the "drop everything" outcomes
  visually jump out from the routine `p1`/`p2` outcomes, without needing a
  fourth shape type.
- Each diamond has exactly two outgoing edges, each labeled `"yes"`/`"no"` —
  never rely on edge order or position to imply which branch is which.
- Longest-path ranking naturally staggers `p0sec` above `p0out` above
  `p1`/`p2` (each is one hop further from the root), which is exactly the
  reading order a human expects for a tree that "goes deeper" the longer you
  keep answering "no."

For a deeper tree (4+ levels), watch the render for edges crossing through
unrelated boxes — if that happens, try `direction:"right"` or split the tree
into two diagrams at a natural break point.
