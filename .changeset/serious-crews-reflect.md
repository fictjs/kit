---
'@fictjs/kit': patch
---

Fix Vite virtual module resolution so SSR builds can reliably resolve
`virtual:fict-kit/entry-server` when ids are normalized with rooted prefixes.
