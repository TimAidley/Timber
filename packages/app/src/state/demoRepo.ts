import type { RepoSnapshot } from '@timber/content';

/**
 * A tiny in-memory content repo so the editor has real, schema-driven objects to
 * edit and preview in this de-risk slice. It stands in for what Phase 5 will load
 * from GitHub via `RepoClient.loadTree` — same `RepoSnapshot` shape, so swapping
 * the source later touches nothing downstream. Deliberately exercises a spread of
 * field kinds (text, multiline, number, boolean, date, enum, tags, reference,
 * video) so the form widgets are all reachable.
 */
export const demoRepo: RepoSnapshot = new Map([
  [
    'config/schemas/events.yml',
    `kind: collection
hasBody: true
fields:
  title:
    type: text
    required: true
  summary:
    type: multiline
  startDate:
    type: date
    required: true
  capacity:
    type: number
    min: 0
  featured:
    type: boolean
  status:
    type: enum
    options: [draft, scheduled, cancelled]
  tags:
    type: tags
  poster:
    type: image
  host:
    type: reference
    referenceType: people
  video:
    type: video
`,
  ],
  [
    'config/schemas/people.yml',
    `kind: collection
hasBody: true
fields:
  title:
    type: text
    required: true
  role:
    type: text
`,
  ],
  [
    'content/people/jane-smith/index.md',
    `---
id: PERSON-JANE
title: Jane Smith
role: Organiser
public: true
---

Jane runs the summer events programme.
`,
  ],
  [
    'content/events/summer-fete/index.md',
    `---
id: EVENT-FETE
title: Summer Fete
summary: A day of stalls, games and food on the green.
startDate: 2026-08-15
capacity: 200
featured: true
status: scheduled
tags: [outdoor, family]
host: PERSON-JANE
video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
public: true
---

# Summer Fete

Join us for the **annual** summer fete with _games_, cake, and live music.

- Face painting
- Cake stall
- Tombola
`,
  ],
]);
