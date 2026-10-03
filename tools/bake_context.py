#!/usr/bin/env python3
"""Build data/context.json: the City boundary, Capital Bikeshare stations in and
around Alexandria, and the City's scooter corrals. Standard library only; run it
whenever stations or corrals change."""

import json
import urllib.request
from pathlib import Path

OPEN_DATA = "https://services2.arcgis.com/ChYV69FhfjwkvRmy/arcgis/rest/services"
CITY = f"{OPEN_DATA}/City_of_Alexandria_Boundary/FeatureServer/0/query?where=1%3D1&outFields=NAME&outSR=4326&f=geojson"
CORRALS = f"{OPEN_DATA}/Corral_Areas/FeatureServer/0/query?where=1%3D1&outFields=corrallabel,street&outSR=4326&f=geojson"
STATIONS = "https://gbfs.lyft.com/gbfs/2.3/dca-cabi/en/station_information.json"
MARGIN = 0.008  # degrees, roughly half a mile: keeps stations just over the City line for context
OUT = Path(__file__).resolve().parent.parent / "data" / "context.json"


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def outer_ring(geometry):
    rings = geometry["coordinates"]
    return rings[0][0] if geometry["type"] == "MultiPolygon" else rings[0]


def centroid(ring):
    return [round(sum(p[0] for p in ring) / len(ring), 6), round(sum(p[1] for p in ring) / len(ring), 6)]


def main():
    ring = outer_ring(fetch(CITY)["features"][0]["geometry"])
    west, east = min(p[0] for p in ring), max(p[0] for p in ring)
    south, north = min(p[1] for p in ring), max(p[1] for p in ring)

    stations = [
        [round(s["lon"], 6), round(s["lat"], 6), s["name"]]
        for s in fetch(STATIONS)["data"]["stations"]
        if south - MARGIN <= s["lat"] <= north + MARGIN and west - MARGIN <= s["lon"] <= east + MARGIN
    ]
    corrals = [
        centroid(outer_ring(f["geometry"])) + [f["properties"]["corrallabel"] or "", f["properties"]["street"] or ""]
        for f in fetch(CORRALS)["features"]
    ]

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "boundary": [[round(p[0], 6), round(p[1], 6)] for p in ring],
        "bbox": [round(v, 4) for v in (west, south, east, north)],
        "stations": sorted(stations, key=lambda s: s[2]),
        "corrals": sorted(corrals, key=lambda c: c[2]),
    }, separators=(",", ":"), ensure_ascii=False))
    print(f"{OUT.name}: {len(stations)} stations, {len(corrals)} corrals, boundary of {len(ring)} points")


if __name__ == "__main__":
    main()
