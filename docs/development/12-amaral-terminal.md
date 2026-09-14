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
Inside the terminal box the shortest street path decides the course, with two
exceptions taken from the published traces. Lane H is a kerb-side bay on the
roundabout arc east of the mouth: its modelled lane pulls in from the arc,
serves H17 and rejoins the arc at the next node, where it used to turn back
into lane A and send 2A and 7 round lanes A and B and through the mouth a
second time (their traces continue east along the arc). And after a route's
last bay, guide vertices of its trace that lie on a street become
intermediate targets, so the C-lane services (50, 52, 71, 73, N3, N5) leave by
the loop road west of the terminal as MO Transport draws them, instead of
crossing the entrance through lane D and the mouth; a guide vertex on a
modelled bay lane, one that no directed path reaches, or a set of waypoints
whose course laps the terminal or runs far longer than the direct path is
dropped, one waypoint at a time. Arrivals keep the shortest path: guiding
them along the loop road as well measured worse in the viewport replay,
because that road rejoins the arc exactly where every entrance turns off.
Per hour of timetable this takes lane D from 127 to 103 traversals, lane H
from 41 to 14, and departures crossing the C entrance from 156 to 131; the
satellite image and the OSM ways agree that the remaining D/E departures do
cross that entrance at grade, so those stay.
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
A junction reservation starts 8 m before the zone and ends 4 m past it
(`PASSAGE_ENTRY_PAD_M` / `PASSAGE_EXIT_PAD_M` in `busJunctions.ts`); zones
whose padded intervals come within 2 m of each other are still claimed as one
chain. The earlier 14 / 8 m pads fused the west arc of the roundabout and the
terminal entrance into single 90-145 m chains that admitted one bus at a time,
so buses coming off the bridge queued back onto it: in the 18:00 replay the
queue on the landing fell from 19 to 13 buses, the longest hold from 510 s to
348 s and the median delay around the terminal from 21 to 15 min, with no
overlaps. Splitting the chains at platforms instead was tried and rejected: a
bus holding one zone while waiting for the next tripled the long stalls.
Two courses through a junction share its reservation when every place they
overlap is driven within 45 degrees of the same direction (`followable` in
`busTraffic.ts`): a shared arc, a merge or a split is driven as one queue by
ordinary following and the turn sweeps, while a crossing, an opposing course,
a swerve or a U-turn detour still waits for the holder to leave. Waiting for
a co-directional holder had been the largest single cause of held time around
the terminal (23% of held bus-seconds in the 18:00 replay, sampled with
`BUS_TRACE_BOX`); with the shared reservation the landing queue is empty at
the end of the 40-minute replay, the peak queued fleet falls from 55 to 35
buses, the longest hold from 348 s to 98 s and the median delay around the
terminal from 15 to 11 minutes, with no overlaps.

The app is busier than that citywide replay suggests. Only buses near the
viewport run detailed traffic; the rest follow their timetables and enter
traffic on time, so the terminal sees the full timetable rate (38 routes,
about 270 visits an hour, i.e. some nine entrance or exit movements a minute)
that the citywide replay never delivers, because upstream junctions spread
the arrivals out. Measure what the app shows with the scope model,
`node scripts/inspect.mjs bus-traffic HH:MM 2400 2 amaral`, not `current`.
The terminal mouth is a genuine crossing: the entrance lane from the west arc
and the exit lane from lanes D and E meet at about 100 degrees
(`j7664093694`), so entering and exiting buses alternate, and at nine
movements a minute the mouth was saturated at every daytime hour. A bus that
can join the holders already inside a junction (`followable`) therefore goes
ahead of a crossing ticket that has waited less than `PLATOON_BYPASS_SEC`
(45 s), so each alternation carries a platoon rather than one bus; the older
ticket wins again after that. Over twelve start times the held buses in the
terminal box fell by 30% (summed means 147 to 102) and buses stalled for over
a minute at the end of the runs from 40 to 21; the citywide replays keep zero
overlaps. Requesting a junction only within braking distance (alone or
combined with the platoon rule) was tried and rejected: it starved the
creeping approach and long stalls tripled.
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
the initial scene before the controller runs, and so does a changed service
cycle: those scenes pass `busTripModel: 'legacy'`, the fixed 30/60-minute
schedule they were captured under. The current network is covered
separately by `amaralTerminal.test.ts` and the citywide replay tests. The capture
utility accepts an explicit public bus-route snapshot; no test fixture is
loaded by the app.
