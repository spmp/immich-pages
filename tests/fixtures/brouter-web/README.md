# BRouter-Web 0.18.1 fixtures

These fixtures contain only the exported BRouter-Web permalink fragment data;
they are parsed locally and are never fetched. BRouter-Web's route grammar is
exactly one `lonlats`, one `profile`, and optional `alternativeidx=0`.

The approved built-in profiles are `trekking`, `fastbike`, `safety`, `shortest`,
`car-fast`, and `car-eco`. Longitude precedes latitude. The asymmetric route is:

- A: `[13.377485, 52.516247]`
- B: `[13.351221, 52.515004]`
- C: `[13.337, 52.52]`

`forward-trekking.txt` is A-B-C, `reverse-trekking.txt` is C-B-A, and
`encoded-forward-trekking.txt` encodes the same forward fragment once.
