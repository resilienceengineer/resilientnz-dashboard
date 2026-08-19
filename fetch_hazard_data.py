"""
Snapshot the static hazard GIS layers into ./data/ so the prototype can run
without waiting on (or having access to) the live government services.

Live feeds (GeoNet quakes / volcano alerts) are intentionally NOT snapshotted.

Run:  python fetch_hazard_data.py
"""
import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

CITY_BBOX = {
    "Auckland": (174.55, -37.05, 175.00, -36.70),
    "Wellington": (174.60, -41.40, 175.00, -41.10),
    "Christchurch": (172.45, -43.65, 172.80, -43.40),
    "Dunedin": (170.35, -45.95, 170.75, -45.75),
}

PAGE = 2000


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ResilientNZ-prototype/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_paged(url):
    features = []
    for page in range(12):
        j = fetch_json(f"{url}&resultOffset={page * PAGE}")
        got = j.get("features", [])
        features.extend(got)
        print(f"    page {page + 1}: {len(got)} features")
        if len(got) < PAGE:
            break
    return {"type": "FeatureCollection", "features": features}


def bboxed(url, bbox):
    geom = ",".join(str(v) for v in bbox)
    return (f"{url}&geometry={geom}&geometryType=esriGeometryEnvelope"
            f"&inSR=4326&spatialRel=esriSpatialRelIntersects")


LAYERS = [
    # (output name, base query url, bbox city or None, paginate)
    ("flood-plains__Auckland",
     "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Flood_Plains/FeatureServer/0/query"
     "?where=1%3D1&outFields=OBJECTID&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00002",
     "Auckland", True),
    ("coastal-inundation__Auckland",
     "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Coastal_Inundation_1_AEP/FeatureServer/0/query"
     "?where=1%3D1&outFields=OBJECTID,SeaLevelRiseScenario&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.0001",
     "Auckland", True),
    ("wellington-flood",
     "https://mapping.gw.govt.nz/arcgis/rest/services/GW/Flood_Hazards_Areas/MapServer/3/query"
     "?where=1%3D1&outFields=*&f=geojson&geometryPrecision=5&maxAllowableOffset=5",
     None, False),
    ("chch-liquefaction",
     "https://gis.ccc.govt.nz/server/rest/services/OpenData/LandCharacteristic/FeatureServer/36/query"
     "?where=1%3D1&outFields=*&f=geojson&geometryPrecision=5",
     None, False),
    ("dunedin-coastal",
     "https://services6.arcgis.com/ALxeDxaeNjQo1Mf0/arcgis/rest/services/General_Coastal_Hazard_Dunedin_City/FeatureServer/16/query"
     "?where=1%3D1&outFields=*&f=geojson",
     None, False),
    ("dunedin-flood",
     "https://services6.arcgis.com/ALxeDxaeNjQo1Mf0/arcgis/rest/services/Flood_Hazard_Dunedin_Urban_Streams_2GP/FeatureServer/5/query"
     "?where=1%3D1&outFields=*&f=geojson",
     None, False),
    ("active-faults",
     "https://gis.gns.cri.nz/server/rest/services/Active_Faults/NZActiveFaults250K/MapServer/0/query"
     "?where=1%3D1&outFields=name&outSR=4326&f=geojson&resultRecordCount=2000",
     None, True),
]


def main():
    total_kb = 0
    for name, url, city, paginate in LAYERS:
        out = OUT / f"{name}.geojson"
        print(f"[{name}]")
        if city:
            url = bboxed(url, CITY_BBOX[city])
        data = fetch_paged(url) if paginate else fetch_json(url)
        n = len(data.get("features", []))
        text = json.dumps(data, separators=(",", ":"))
        out.write_text(text, encoding="utf-8")
        kb = len(text) // 1024
        total_kb += kb
        print(f"    saved {n} features, {kb:,} KB -> {out.name}")
    print(f"\nDone. Total {total_kb / 1024:.1f} MB in {OUT}")


if __name__ == "__main__":
    main()
