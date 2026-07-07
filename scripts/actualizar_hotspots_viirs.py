import json
import os
import re
import socket
import tempfile
import time
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

import shapefile
from shapely.geometry import Point, shape as shapely_shape
from shapely.ops import unary_union


BASE_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = BASE_DIR / "datos" / "hotspots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

LIMITE_CV_GEOJSON = BASE_DIR / "datos" / "limites" / "comunitat_valenciana.geojson"

FILE_24H = OUT_DIR / "hotspots_24h.geojson"
FILE_48H = OUT_DIR / "hotspots_48h.geojson"
FILE_72H = OUT_DIR / "hotspots_72h.geojson"
FILE_7D = OUT_DIR / "hotspots_7d.geojson"
MANIFEST = OUT_DIR / "manifest_hotspots.json"

CV_BBOX = os.environ.get("CV_BBOX", "-1.60,37.80,0.80,40.90")
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = map(float, CV_BBOX.split(","))


KML_SOURCES_24H = [
    ("SUOMI", "Suomi-NPP", "VIIRS", os.environ.get("SUOMI_VIIRS_KML_24H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/kml/SUOMI_VIIRS_C2_Europe_24h.kml")),
    ("J1", "NOAA-20", "VIIRS", os.environ.get("J1_VIIRS_KML_24H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/kml/J1_VIIRS_C2_Europe_24h.kml")),
    ("J2", "NOAA-21", "VIIRS", os.environ.get("J2_VIIRS_KML_24H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/kml/J2_VIIRS_C2_Europe_24h.kml")),
]

KML_SOURCES_48H = [
    ("SUOMI", "Suomi-NPP", "VIIRS", os.environ.get("SUOMI_VIIRS_KML_48H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/kml/SUOMI_VIIRS_C2_Europe_48h.kml")),
    ("J1", "NOAA-20", "VIIRS", os.environ.get("J1_VIIRS_KML_48H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/kml/J1_VIIRS_C2_Europe_48h.kml")),
    ("J2", "NOAA-21", "VIIRS", os.environ.get("J2_VIIRS_KML_48H", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/kml/J2_VIIRS_C2_Europe_48h.kml")),
]

ZIP_SOURCES_7D = [
    ("SUOMI", "Suomi-NPP", "VIIRS", os.environ.get("SUOMI_VIIRS_ZIP_7D", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/shapes/zips/SUOMI_VIIRS_C2_Europe_7d.zip")),
    ("J1", "NOAA-20", "VIIRS", os.environ.get("J1_VIIRS_ZIP_7D", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/shapes/zips/J1_VIIRS_C2_Europe_7d.zip")),
    ("J2", "NOAA-21", "VIIRS", os.environ.get("J2_VIIRS_ZIP_7D", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/shapes/zips/J2_VIIRS_C2_Europe_7d.zip")),
]


def now_utc():
    return datetime.now(timezone.utc)


def iso_utc(dt):
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def in_bbox(lon, lat):
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def normalizar_clave(clave):
    return str(clave).strip().lower()


def write_geojson(path, features):
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8"
    )


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def forzar_ipv4():
    original_getaddrinfo = socket.getaddrinfo

    def getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
        return original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

    socket.getaddrinfo = getaddrinfo_ipv4


def descargar_archivo(url, destino, intentos=5):
    print(f"Descargando: {url}")
    forzar_ipv4()
    ultimo_error = None

    for intento in range(1, intentos + 1):
        try:
            print(f"Intento {intento}/{intentos}")
            req = Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 MetVlc GitHub Action",
                    "Accept": "*/*",
                    "Connection": "close"
                }
            )

            with urlopen(req, timeout=240) as response:
                content = response.read()

            if not content or len(content) < 100:
                raise RuntimeError(f"Descarga demasiado pequeña o vacía: {len(content)} bytes")

            destino.write_bytes(content)
            print(f"Descargado: {destino.name} · {len(content) / 1024:.1f} KB")
            return

        except (URLError, HTTPError, OSError, TimeoutError, RuntimeError) as e:
            ultimo_error = e
            print(f"Error descargando {url}: {e}")

            if intento < intentos:
                espera = intento * 20
                print(f"Reintentando en {espera} segundos...")
                time.sleep(espera)

    raise RuntimeError(f"No se pudo descargar {url} después de {intentos} intentos. Último error: {ultimo_error}")


def cargar_geometria_cv():
    if not LIMITE_CV_GEOJSON.exists():
        raise RuntimeError(
            f"No existe {LIMITE_CV_GEOJSON}. Sube datos/limites/comunitat_valenciana.geojson."
        )

    data = json.loads(LIMITE_CV_GEOJSON.read_text(encoding="utf-8"))
    geoms = []

    if data.get("type") == "FeatureCollection":
        for feature in data.get("features", []):
            if feature.get("geometry"):
                geoms.append(shapely_shape(feature["geometry"]))
    elif data.get("type") == "Feature":
        geoms.append(shapely_shape(data["geometry"]))
    else:
        geoms.append(shapely_shape(data))

    geom_cv = unary_union(geoms).buffer(0)

    if geom_cv.is_empty:
        raise RuntimeError("La geometría de la Comunitat Valenciana está vacía")

    print("Límite Comunitat Valenciana cargado correctamente")
    print(f"Bounds CV: {geom_cv.bounds}")

    return geom_cv


def punto_dentro_cv(lon, lat, geom_cv):
    if not in_bbox(lon, lat):
        return False
    p = Point(lon, lat)
    return geom_cv.contains(p) or geom_cv.touches(p)


def parse_fecha_viirs(props):
    props_lower = {normalizar_clave(k): v for k, v in props.items()}

    acq_date = props_lower.get("acq_date") or props_lower.get("acqdate") or props_lower.get("date")
    acq_time = props_lower.get("acq_time") or props_lower.get("acqtime") or props_lower.get("time")

    if not acq_date:
        return None

    acq_date = str(acq_date).strip()
    acq_time = "0000" if acq_time is None else str(acq_time).strip().zfill(4)
    acq_time = re.sub(r"\D", "", acq_time).zfill(4)[:4]

    try:
        return datetime.strptime(f"{acq_date} {acq_time}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def crear_feature(lon, lat, props, fuente, periodo, satelite, instrumento, origen):
    dt = parse_fecha_viirs(props)
    props_out = {}

    for k, v in props.items():
        if isinstance(v, bytes):
            try:
                v = v.decode("utf-8")
            except Exception:
                v = str(v)
        props_out[k] = v

    props_out["metvlc_fuente"] = fuente
    props_out["metvlc_periodo_origen"] = periodo
    props_out["metvlc_satellite"] = satelite
    props_out["metvlc_instrument"] = instrumento
    props_out["metvlc_time_utc"] = iso_utc(dt)
    props_out["metvlc_ambito"] = "Comunitat Valenciana"
    props_out["metvlc_origen_archivo"] = origen

    return {
        "type": "Feature",
        "properties": props_out,
        "geometry": {"type": "Point", "coordinates": [lon, lat]}
    }


def deduplicar_features(features):
    salida = []
    vistos = set()

    for feature in features:
        props = feature.get("properties") or {}
        lon, lat = feature["geometry"]["coordinates"]

        key = (
            props.get("metvlc_satellite", ""),
            props.get("metvlc_time_utc", ""),
            round(float(lon), 5),
            round(float(lat), 5)
        )

        if key in vistos:
            continue

        vistos.add(key)
        salida.append(feature)

    return salida


def filtrar_ultimas_horas(features, horas, ref_time):
    cutoff = ref_time - timedelta(hours=horas)
    salida = []

    for feature in features:
        value = (feature.get("properties") or {}).get("metvlc_time_utc")

        if not value:
            continue

        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue

        if dt >= cutoff:
            salida.append(feature)

    return salida


def get_namespace(root):
    m = re.match(r"\{(.*)\}", root.tag)
    return m.group(1) if m else ""


def find_placemarks(root, ns):
    return root.findall(f".//{{{ns}}}Placemark") if ns else root.findall(".//Placemark")


def find_first(elem, local_name, ns):
    found = elem.find(f".//{{{ns}}}{local_name}") if ns else None
    return found if found is not None else elem.find(".//" + local_name)


def coords_from_placemark(pm, ns):
    coord_elem = find_first(pm, "coordinates", ns)
    if coord_elem is None or not coord_elem.text:
        return None

    nums = re.findall(r"[-+]?\d+(?:\.\d+)?", coord_elem.text.strip())

    if len(nums) < 2:
        return None

    return float(nums[0]), float(nums[1])


def placemark_to_properties(pm, ns):
    props = {}

    name_elem = find_first(pm, "name", ns)
    if name_elem is not None and name_elem.text:
        props["name"] = name_elem.text.strip()

    desc_elem = find_first(pm, "description", ns)
    if desc_elem is not None and desc_elem.text:
        props["description"] = desc_elem.text.strip()

    data_nodes = pm.findall(f".//{{{ns}}}Data") if ns else pm.findall(".//Data")
    if not data_nodes:
        data_nodes = pm.findall(".//Data")

    for d in data_nodes:
        key = d.attrib.get("name")
        value_elem = d.find(f"{{{ns}}}value") if ns else None
        if value_elem is None:
            value_elem = d.find("value")
        if key and value_elem is not None and value_elem.text is not None:
            props[key] = value_elem.text.strip()

    simple_nodes = pm.findall(f".//{{{ns}}}SimpleData") if ns else pm.findall(".//SimpleData")
    if not simple_nodes:
        simple_nodes = pm.findall(".//SimpleData")

    for d in simple_nodes:
        key = d.attrib.get("name")
        if key and d.text is not None:
            props[key] = d.text.strip()

    return props


def leer_kml_viirs(source, periodo, geom_cv):
    source_id, satelite, instrumento, url = source

    with tempfile.TemporaryDirectory() as tmp:
        kml_path = Path(tmp) / f"{source_id}_{periodo}.kml"
        descargar_archivo(url, kml_path)

        root = ET.parse(kml_path).getroot()
        ns = get_namespace(root)
        placemarks = find_placemarks(root, ns)

        features = []
        dentro_bbox = 0

        for pm in placemarks:
            coords = coords_from_placemark(pm, ns)
            if coords is None:
                continue

            lon, lat = coords

            if in_bbox(lon, lat):
                dentro_bbox += 1

            if not punto_dentro_cv(lon, lat, geom_cv):
                continue

            props = placemark_to_properties(pm, ns)

            features.append(crear_feature(
                lon=lon,
                lat=lat,
                props=props,
                fuente=f"NASA FIRMS · {satelite} {instrumento} C2",
                periodo=periodo,
                satelite=satelite,
                instrumento=instrumento,
                origen=Path(url).name
            ))

        print(f"{source_id} {periodo}: placemarks Europe = {len(placemarks)}")
        print(f"{source_id} {periodo}: puntos dentro BBOX CV = {dentro_bbox}")
        print(f"{source_id} {periodo}: puntos dentro Comunitat Valenciana = {len(features)}")

        return features


def buscar_shp(carpeta):
    shp_files = list(carpeta.rglob("*.shp"))
    if not shp_files:
        raise RuntimeError("No se encontró ningún archivo .shp dentro del ZIP")
    return shp_files[0]


def leer_zip_viirs(source, periodo, geom_cv):
    source_id, satelite, instrumento, url = source

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / f"{source_id}_{periodo}.zip"
        descargar_archivo(url, zip_path)

        extract_dir = tmp_path / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(extract_dir)

        shp_path = buscar_shp(extract_dir)
        print(f"Leyendo shapefile: {shp_path.name}")

        reader = shapefile.Reader(str(shp_path))
        field_names = [field[0] for field in reader.fields if field[0] != "DeletionFlag"]

        features = []
        total = 0
        dentro_bbox = 0

        for sr in reader.iterShapeRecords():
            total += 1
            shape = sr.shape
            record = sr.record
            props = {field_names[i]: record[i] for i in range(len(field_names))}

            lon = lat = None

            if shape.points:
                lon = float(shape.points[0][0])
                lat = float(shape.points[0][1])

            if lon is None or lat is None:
                props_lower = {normalizar_clave(k): v for k, v in props.items()}
                lon = float(props_lower.get("longitude") or props_lower.get("lon"))
                lat = float(props_lower.get("latitude") or props_lower.get("lat"))

            if in_bbox(lon, lat):
                dentro_bbox += 1

            if not punto_dentro_cv(lon, lat, geom_cv):
                continue

            features.append(crear_feature(
                lon=lon,
                lat=lat,
                props=props,
                fuente=f"NASA FIRMS · {satelite} {instrumento} C2",
                periodo=periodo,
                satelite=satelite,
                instrumento=instrumento,
                origen=Path(url).name
            ))

        print(f"{source_id} {periodo}: registros totales Europe = {total}")
        print(f"{source_id} {periodo}: puntos dentro BBOX CV = {dentro_bbox}")
        print(f"{source_id} {periodo}: puntos dentro Comunitat Valenciana = {len(features)}")

        return features


def main():
    ref_time = now_utc()
    geom_cv = cargar_geometria_cv()

    features_24h = []
    for source in KML_SOURCES_24H:
        features_24h.extend(leer_kml_viirs(source, "24h", geom_cv))

    features_48h = []
    for source in KML_SOURCES_48H:
        features_48h.extend(leer_kml_viirs(source, "48h", geom_cv))

    features_7d = []
    for source in ZIP_SOURCES_7D:
        features_7d.extend(leer_zip_viirs(source, "7d", geom_cv))

    features_24h = deduplicar_features(features_24h)
    features_48h = deduplicar_features(features_48h)
    features_7d = deduplicar_features(features_7d)
    features_72h = deduplicar_features(filtrar_ultimas_horas(features_7d, 72, ref_time))

    write_geojson(FILE_24H, features_24h)
    write_geojson(FILE_48H, features_48h)
    write_geojson(FILE_72H, features_72h)
    write_geojson(FILE_7D, features_7d)

    manifest = {
        "producto": "Puntos calientes NASA FIRMS · VIIRS C2 multi-satélite",
        "ambito": "Comunitat Valenciana",
        "satellites": ["Suomi-NPP", "NOAA-20", "NOAA-21"],
        "instrument": "VIIRS",
        "actualizado_utc": iso_utc(ref_time),
        "limite_usado": "datos/limites/comunitat_valenciana.geojson",
        "bbox_cv": {
            "lon_min": LON_MIN,
            "lat_min": LAT_MIN,
            "lon_max": LON_MAX,
            "lat_max": LAT_MAX
        },
        "hotspots_24h": len(features_24h),
        "hotspots_48h": len(features_48h),
        "hotspots_72h": len(features_72h),
        "hotspots_7d": len(features_7d),
        "fuentes_24h": [s[3] for s in KML_SOURCES_24H],
        "fuentes_48h": [s[3] for s in KML_SOURCES_48H],
        "fuentes_7d": [s[3] for s in ZIP_SOURCES_7D],
        "archivos": [
            "hotspots_24h.geojson",
            "hotspots_48h.geojson",
            "hotspots_72h.geojson",
            "hotspots_7d.geojson"
        ],
        "nota": (
            "24h y 48h se descargan desde KML de FIRMS para Suomi-NPP, NOAA-20 y NOAA-21. "
            "7d se descarga desde shapefile ZIP para los mismos satélites. "
            "Todos los puntos se filtran al polígono de la Comunitat Valenciana."
        )
    }

    write_json(MANIFEST, manifest)
    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
