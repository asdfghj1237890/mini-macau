# WebGL failure recovery — iPhone X investigation (2026-09-08)

The reported iPhone X / iOS 16.7.10 cannot maintain a WebGL context even on a
standalone MapLibre basemap. The application now rebuilds once, then uses a
Leaflet raster map with Canvas2D overlays if rendering fails again. This fixes
the application's persistent blank-screen behavior; it does not repair the
browser's GPU process or establish the exact cause of its failure.

## Device evidence

These outcomes were reported from the same physical phone:

| Comparison | Result | What it establishes |
| --- | --- | --- |
| App with debug disabled | Still blank | Debug instrumentation is not necessary to trigger the failure |
| Standalone MapLibre 6.7, no vehicles/circles, overscaling off | Context lost | Custom app layers are not necessary to trigger it |
| Standalone MapLibre 5.23, no vehicles/circles | Context lost | Downgrading to v5 is not a demonstrated fix |
| Standalone v6 in a new private tab | Context lost | A fresh browsing session did not recover it |
| Standalone v6, DPR 1, pitch 0, no vehicles/circles, overscaling off | Context lost | Lowering render resolution is not a demonstrated fix |

The standalone page used in those comparisons also allocated one capability-probe
context. That probe has now been removed; capabilities are read from its map's
existing context. These comparisons narrow the scope, but they are not a raw,
single-context WebGL reproduction that conclusively identifies a browser defect.

The photos also show repeated `Could not compile fragment shader: null` errors.
The original debug overlay said `vertex`, `contextLost false`, `log null` and
`len 627`. Its type check treated every result other than `FRAGMENT_SHADER`,
including `null`, as vertex. The captured defines and 627-character source match
MapLibre 6.7's compact `symbolIcon` **fragment** shader. Neither a null info log
nor an unsuccessful shader query, by itself, proves GPU out-of-memory, a GLSL
syntax error or context loss at that instant. The later context-loss events are
separate evidence.

[WebKit bug 262628, comment 2](https://bugs.webkit.org/show_bug.cgi?id=262628#c2)
reports persistent context loss on iPhone X / iOS 16.7 after backgrounding.
That is consistent with the failure class seen here, but it does not prove this
device has the same underlying bug or establish the fix status of iOS 16.7.10.
There is no native GPU-process trace from this phone. The triggering driver,
compiler, memory or lifecycle condition remains unresolved.

## Confirmed application defects and changes

- MapView previously caught constructor failure only. Subsequent context loss or
  shader failure left a blank map. A failed MapLibre program construction does
  not populate its program cache, so later renders can attempt the same failing
  compilation again. `mapRecovery.ts` now coalesces repeated errors, stops app
  simulation writes immediately, and schedules one replacement map. Unmounting
  cancels the pending retry and releases the map and debug hooks.
- The replacement retains center, zoom, pitch and bearing, with DPR capped at 2
  as a conservative resource limit. A second failure switches to the raster map;
  constructor failure switches directly. It does not repeatedly recreate GPU
  contexts. Explicitly retrying from 2D allows one new attempt at the current
  center and scale.
- The former debug overlay allocated two additional probe contexts, globally
  patched WebGL methods, and added a synchronous compile-status query for every
  shader. `webglDiagnostics.ts` now observes only the map's context and the
  compile-status queries MapLibre already makes. It records shader type when the
  shader is created, keeps `false` distinct from `null`, and restores methods on
  cleanup or partial installation failure. Diagnostic failure does not prevent
  map initialization.
- Initial theme setup no longer immediately replaces the just-created style.
  Existing layer setup remains guarded against duplicate load events.

## Compatibility map

`RasterMapFallback.tsx` is loaded lazily. Leaflet 1.9.4 requests ordinary raster
tiles and draws overlays with Canvas2D; it never requests WebGL. It shares the
existing simulation clock, visible data and selection callbacks. Routes, moving
vehicle points, station/city markers, schematic mains and the Grand Prix circuit
remain available. Tracking, layer filters, time controls and info panels work.
It omits 3D models/buildings, animated network flows and distribution meshes;
the main MapView settings drawer is not available in this mode. Raster labels
use the tile provider's language/style rather than the app's basemap theme.

The raster provider is `tile.openstreetmap.org`. Attribution stays visible in
the compatibility notice, including with the debug overlay open. Requests use
normal browser identification, referer and HTTP caching; there is no offline
download, prefetch job or tile proxy. Availability is best-effort under the
[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/).
Automated fault tests mock these tiles rather than pan/zoom against that service.

## Verification and reproduction

- `npm test`: 1,040 passed, 3 skipped, including 12 recovery/diagnostic tests.
- `npm run build`: TypeScript and production build passed. The fallback is a
  separate lazy chunk, approximately 46 KB gzip plus 6 KB CSS gzip.
- Lint passed with local Python virtualenv and temporary test files excluded:
  `npm run lint -- --ignore-pattern 'data/.venv/**' --ignore-pattern 'tmp_*'`.
- Browser fault injection at 375 × 812 / DPR 3: actual
  `WEBGL_lose_context` loss rebuilds the map with the same camera; a second loss
  switches to 2D. A null symbol-icon compile status/type/info-log with a live
  context also switches to 2D and reports **fragment** correctly. No WebGL2
  switches directly. Each case leaves no connected WebGL canvas, while raster
  tiles, Canvas2D overlays and zoom controls work. Raster requests are mocked for
  these automated tests.
- Interactive browser inspection confirmed actual OSM geography and the phone
  layout, including attribution and layer controls.
- Explicit retry from 2D after zooming preserves the raster camera's center and
  converted zoom, leaving one active WebGL canvas. Function typechecking (with
  local deployment inputs), Python data validation and the Git/static-data
  boundary check also passed.

Manual entry points:

- `/?map=2d`: directly inspect compatibility mode without a GPU failure.
- `/?debug=1&nowebgl2=1`: exercise unavailable-WebGL2 handling.
- On a healthy WebGL map, use `WEBGL_lose_context` in browser developer tools to
  lose its context; repeat on the replacement map to exercise fallback. Also
  check a normal load, a theme change, layer toggles and vehicle selection.

Desktop Chromium success is not proof of iPhone WebKit success. Physical-device
verification of the new build remains required after deployment.
