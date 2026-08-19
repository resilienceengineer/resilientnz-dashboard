"""
Fetch key strategic buildings for the four cities from OpenStreetMap
(Overpass API): hospitals, government offices, town halls / council
buildings and civil-defence / emergency-management facilities.

Output: data/strategic-buildings.geojson  (points, {name, category, city})

Run:  python fetch_strategic_buildings.py
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "data" / "strategic-buildings.geojson"

# Overpass bboxes are (south, west, north, east)
CITY_BBOX = {
    "Auckland": (-37.05, 174.55, -36.70, 175.00),
    "Wellington": (-41.40, 174.60, -41.10, 175.00),
    "Christchurch": (-43.65, 172.45, -43.40, 172.80),
    "Dunedin": (-45.95, 170.35, -45.75, 170.75),
}

ENDPOINT = "https://overpass-api.de/api/interpreter"


def query_city(city, bbox):
    b = ",".join(str(v) for v in bbox)
    q = f"""
[out:json][timeout:90];
(
  nwr["amenity"="hospital"]({b});
  nwr["amenity"="townhall"]({b});
  nwr["office"="government"]({b});
  nwr["name"~"Civil Defence|Emergency Management",i]({b});
);
out center tags;
"""
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(ENDPOINT, data=data,
                                 headers={"User-Agent": "ResilientNZ-prototype/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 504) and attempt < 3:
                wait = 45 * (attempt + 1)
                print(f"  rate limited ({e.code}), waiting {wait}s ...")
                time.sleep(wait)
            else:
                raise


def categorise(tags):
    name = tags.get("name", "")
    if "civil defence" in name.lower() or "emergency management" in name.lower():
        return "Civil Defence"
    if tags.get("amenity") == "hospital":
        return "Hospital"
    if tags.get("amenity") == "townhall":
        return "Council"
    if tags.get("office") == "government":
        return "Government"
    return None


def main():
    features = []
    for i, (city, bbox) in enumerate(CITY_BBOX.items()):
        if i:
            time.sleep(15)     # be polite to the public Overpass instance
        j = query_city(city, bbox)
        n = 0
        for el in j.get("elements", []):
            tags = el.get("tags", {})
            name = tags.get("name")
            if not name:
                continue                      # unnamed → not useful on a mockup
            cat = categorise(tags)
            if not cat:
                continue
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": {"name": name, "category": cat, "city": city}
            })
            n += 1
        print(f"{city}: {n} strategic buildings")

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                              separators=(",", ":")), encoding="utf-8")
    cats = {}
    for f in features:
        cats[f["properties"]["category"]] = cats.get(f["properties"]["category"], 0) + 1
    print(f"Saved {len(features)} features -> {OUT.name}  {cats}")


if __name__ == "__main__":
    main()
