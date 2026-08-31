# MapLibre style fixture

`style.json` is a deterministic MapLibre style used by browser-test mock
endpoints. It intentionally contains only a subdued background layer and no
sources, tiles, glyphs, sprites, or external resource URLs, so tests never
contact public map infrastructure or arbitrary hosts.

Production style selection uses the deployment-owned
`MAP_STYLE_URL_QUIET_ATLAS` configuration name. Album YAML may select the
approved name, but it cannot provide a style URL.
