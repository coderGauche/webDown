# Page fixture profiles

These fixtures are deterministic capture-risk profiles, not a framework compatibility claim.
They do not load public network resources.

| Profile           | Runtime boundary represented                                         | Capture risk represented                                                                | Explicit limitation                                                     |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `static-page`     | Parsed server HTML                                                   | Base URL resolution, form sanitization, sandboxed iframe, inline CSS                    | No client runtime                                                       |
| `spa-page`        | React `createRoot`                                                   | Delayed client mount, title change, runtime resource, open Shadow DOM                   | No SSR or router                                                        |
| `vue-style-page`  | Vue-like compiled DOM shape plus a deterministic local mount adapter | `v-cloak`, scoped attributes, delayed route content, lazy image, runtime form value     | Does not execute Vue; it must not be cited as Vue runtime compatibility |
| `next-style-page` | Server markup hydrated with React `hydrateRoot`                      | SSR markup, `__NEXT_DATA__`, hydration, deferred route content, `_next` resource timing | Does not execute Next.js routing, server components, or a Next server   |

M9-T2 owns dedicated font, media, and third-party CDN scenarios. M9-T3 owns real browser extension E2E.
