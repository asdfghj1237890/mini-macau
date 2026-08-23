"""Align ordered bus stops to vertex offsets in a route LineString.

The route geometry can cross the same road more than once, so independently
choosing each stop's nearest vertex is not sufficient: an early stop may be
matched to a later pass and strand every stop after it.  This module performs
a globally optimal, strictly increasing alignment and anchors the first and
last stops to the first and last geometry vertices produced by OSRM.

Pure stdlib on purpose: the data validator imports no scraper dependencies.
"""

from __future__ import annotations

import math


METERS_PER_DEG_LAT = 110_540.0
METERS_PER_DEG_LNG = 111_320.0
MAX_STOP_TO_ROUTE_M = 150.0


class StopOffsetError(ValueError):
    """Raised when stops cannot be aligned safely to a route geometry."""


def distance_m2(a: list[float], b: list[float]) -> float:
    """Approximate squared distance between two Macau lon/lat points."""
    mean_lat = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * METERS_PER_DEG_LNG * math.cos(mean_lat)
    dy = (b[1] - a[1]) * METERS_PER_DEG_LAT
    return dx * dx + dy * dy


def align_stop_offsets(
    geometry_coords: list[list[float]],
    stop_coords: list[list[float]],
    *,
    route_name: str = "",
    max_distance_m: float = MAX_STOP_TO_ROUTE_M,
) -> tuple[list[int], list[float]]:
    """Return strictly increasing vertex indices and per-stop distances.

    Dynamic programming minimizes the total squared stop-to-vertex distance
    while preserving visit order.  Endpoints are anchored because
    ``build_route_geometry`` starts and ends at the first/last input stop.
    A hard distance gate prevents a successful-but-distant OSRM snap from
    silently publishing a line that never reaches a served stop.
    """
    vertex_count = len(geometry_coords)
    stop_count = len(stop_coords)
    label = f"route {route_name}" if route_name else "route"

    if stop_count == 0:
        return [], []
    if vertex_count < stop_count:
        raise StopOffsetError(
            f"{label}: {vertex_count} geometry vertices cannot align "
            f"{stop_count} ordered stops"
        )
    if stop_count == 1:
        distance = math.sqrt(distance_m2(stop_coords[0], geometry_coords[0]))
        if distance > max_distance_m:
            raise StopOffsetError(
                f"{label}: only stop is {distance:.0f}m from geometry start"
            )
        return [0], [distance]

    infinity = float("inf")
    previous = [infinity] * vertex_count
    previous[0] = distance_m2(stop_coords[0], geometry_coords[0])
    parents: list[list[int]] = []

    for stop_index in range(1, stop_count):
        current = [infinity] * vertex_count
        parent = [-1] * vertex_count

        # Reserve enough vertices for all remaining stops.  The final stop
        # is fixed to the final vertex, matching the ordered OSRM request.
        if stop_index == stop_count - 1:
            candidates = range(vertex_count - 1, vertex_count)
        else:
            first_vertex = stop_index
            last_vertex = vertex_count - (stop_count - stop_index)
            candidates = range(first_vertex, last_vertex + 1)

        best_cost = infinity
        best_index = -1
        scan_index = 0
        for vertex_index in candidates:
            while scan_index < vertex_index:
                candidate_cost = previous[scan_index]
                if candidate_cost < best_cost:
                    best_cost = candidate_cost
                    best_index = scan_index
                scan_index += 1
            if best_index >= 0:
                current[vertex_index] = best_cost + distance_m2(
                    stop_coords[stop_index], geometry_coords[vertex_index]
                )
                parent[vertex_index] = best_index

        previous = current
        parents.append(parent)

    final_index = vertex_count - 1
    if previous[final_index] == infinity:
        raise StopOffsetError(f"{label}: no monotonic stop-to-geometry alignment")

    offsets = [final_index]
    cursor = final_index
    for parent in reversed(parents):
        cursor = parent[cursor]
        if cursor < 0:
            raise StopOffsetError(f"{label}: incomplete stop-offset backtrack")
        offsets.append(cursor)
    offsets.reverse()

    distances = [
        math.sqrt(distance_m2(stop_coord, geometry_coords[offset]))
        for stop_coord, offset in zip(stop_coords, offsets, strict=True)
    ]
    worst_index = max(range(stop_count), key=distances.__getitem__)
    if distances[worst_index] > max_distance_m:
        raise StopOffsetError(
            f"{label}: stop #{worst_index} is {distances[worst_index]:.0f}m "
            f"from its ordered geometry vertex (limit {max_distance_m:.0f}m)"
        )

    return offsets, distances
