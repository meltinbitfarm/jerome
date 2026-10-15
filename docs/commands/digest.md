# `jerome digest [dir] [--since 7d]`

What happened in a project over a period, at zero tokens: the lines the lead agent appends to `digest.md` at the end of each heartbeat, with the period's runs by kind and status, usage and its API equivalent, decision requests opened and still open, and commits on `main`.

```
$ jerome digest --since 7d
claude-watch · digest of the last 7 days
runs      4 heartbeat blocked · 4 heartbeat done · 10 interactive done
usage     4.6M tokens ≈$3.59 API
requests  3 opened · 1 still open
main      8 commits
heartbeats
  2026-10-15 14:24 · checked the rupture report for the rigid hook fields: there is no hook payload comparison yet (notes/hook-rigid-fields.md) · hook-rigid-fields-rupture · R2
```

`--since` takes a number of days, such as `30d`.
