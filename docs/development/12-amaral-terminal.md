# Amaral terminal geometry

M172 uses the 17 platform coordinates and A–H assignments published by
[MO Transport](https://motransportinfo.com/zh/station/M172). The dated source
snapshot is `data/bus_reference/amaral-terminal.json`; surrounding OSM ways
provide street connectivity and one-way directions. Station coordinates are
not surveyed kerb lines. The 1.8 m vehicle clearance, lane curves and G/H
connections in `scripts/amaral-network.mjs` are explicit modelling estimates.

`amaral-route-paths.json` captures the public GPX URLs linked by MO Transport's
route pages. For 40 compatible routes these guide the approach and departure
between the neighbouring stops, before the station graph refines the bay
position. This prevents inherited OSRM detours from introducing extra terminal
crossings or roundabout loops. Route 33 follows the published D11-outbound and
A3-inbound path; G16 continues east around the roundabout, not into the nearby
northbound tunnel exit. Non-stopping passages are checked too: route 39 returns
around the roundabout towards Lisboa, while 102/H3 stay outside the platforms.
Source GPX vertices stay sparse outside the terminal.

The current 25AX dataset concatenates a completed loop and a partial alternate
journey, giving three M172 visits whereas the public GPX has two. Its closed
GPX is reused for matching terminal windows on the second journey; this does
not append a loop or alter any stops. `AMARAL_GUIDE_REPETITIONS` records that
source matching rule, and rejects a replacement GPX with disconnected ends.
MT2's stop sequence matches;
its old pre-stop vertex was about 180 m off the source corridor. The replacement
extends to the exact adjacent stop while preserving that stop's position.

The bus routing step visits each route's assigned platform, following directed
surface streets. It does not use the terminal's underground road connections.
It also replaces the former diagonal bridge joins on 102/H3 without adding
stops to those services. Other stops and their sequence remain unchanged.
The simulator still uses generated service cycles; this does not make its
traffic volumes or queues a real-time feed or a surveyed traffic model.

After extracting bus routes and applying bridge corrections, run:

```sh
npm run data:amaral
node scripts/inspect.mjs bus-station M172
```

The patch invalidates obsolete road spans. The following profile build records
`terminal-layout` and `lanePath` on the modelled lane centres, preventing a
second generic lane offset. Junction matching keeps their surface-way identity
so nearby tunnel nodes do not reserve a platform lane. Rounded corners remain
on their modelled path. An `entryLane: left` approach selects the kerb lane up
to 110 m before a terminal entrance while retaining the physical road's other
lanes. The vehicle keeps its lane after leaving. Existing following, turn sweeps and junction priorities
continue to apply. Crossing ownership accounts for clearance displacement, so
a retreated body does not release a linked junction at its unshifted schedule
position. Lane boundaries are checked along the actual accelerated or
queue-limited movement, including narrower intermediate sections of a bend.
In the recovery solver a queued bus backs up only together with the bus
directly in front of it. A lone retreat re-opened room that the bus's own
forward creep consumed on the next step: its body stayed pinned behind the
leader while its schedule distance ran up to 24 m ahead, and later claims and
reservations came from that phantom position (18:00 replay, MT5 and H3 on the
roundabout arc east of the terminal).
Route geometry and layout fingerprints make repeated runs
idempotent; fresh extraction or a changed layout invalidates those fingerprints.

`src/data/bus-terminals.json` is a small generated display layer with platform
labels and direction arrows. The OSM source snapshot and route-generation graph
are not loaded into the frontend. The display source is static and needs no
animation-frame updates.

To refresh the source, download the public M172 HTML to
`data/raw/amaral-mo.html`, update the dated road snapshot when appropriate, and
run `node scripts/capture-amaral-source.mjs`. Review changed platform assignments
before regenerating. Unrecognised assignments fail the patch instead of silently
moving a route to another bay.

Run `node scripts/capture-amaral-route-paths.mjs` to refresh the public GPX
references (append route IDs for a subset). `node scripts/inspect.mjs
bus-terminal-guide-check` reports incompatible adjacent-stop anchors. For a
single-route comparison, use `bus-terminal-reference <id> <public-gpx-file>`.

For a Sunday afternoon replay, set `BUS_TRAFFIC_DATE=2026-09-13` and run
`node scripts/inspect.mjs bus-traffic 15:50 600 2 amaral`. This mode uses the same
viewport traffic scope as the worker and checks physical vehicles, excluding
distant timetable-only markers. `BUS_TRAFFIC_ROUTES` can select a saved public
bus-route snapshot for comparison. Report collision and queue observations
separately; changing geometry alone does not prove that every queue is gone.

The older maneuver tests have captured playheads, distance reservations and
lane courses. Their exact public bus-route inputs are frozen in
`src/engines/__fixtures__/bus-replay-routes.json.gz`, shared by both maneuver
and kerb-turn tests. Replacing those inputs with new route lengths invalidates
the initial scene before the controller runs. The current network is covered
separately by `amaralTerminal.test.ts` and the citywide replay tests. The capture
utility accepts an explicit public bus-route snapshot; no test fixture is
loaded by the app.
