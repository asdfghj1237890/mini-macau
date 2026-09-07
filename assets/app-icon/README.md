# App icon artwork

`ruins-material.png` is the illustrated master for the favicon and PWA icons.
It is an opaque raster illustration; its dark background is intentional.
Rebuild the exports with `npm run icons:pwa`.

The generator frames the artwork separately for general, Android maskable and
iOS icons. `public/favicon.svg` is a generated, self-contained SVG wrapper around
a 128 px PNG of the same artwork. Edit the master, not the generated exports.

The artwork was generated with built-in ImageGen on 2026-09-07. Architectural
reference: the Macao Cultural Affairs Bureau's
[south elevation of the Ruins of St. Paul's](https://www.wh.gov.mo/en/site/detail/18).
The reference drawing is not redistributed in the application.

Art direction: a Material-inspired filled symbol, preserving the five-tier
facade, rectangular ground-floor portals, arched openings, concave shoulders,
slender finials and a simple two-step base. Broad ivory shapes and muted stone
bands sit against a charcoal-teal background (`#1c2729`). Openings use dark
negative space. No outline strokes, statues, capitals, carved motifs, masonry
lines, decorative spirals, labels or surrounding scenery.

The latest simplification prompt is recorded in [prompt.txt](prompt.txt).
