import json
import os
import zipfile
import tempfile
import time
import socket
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import shapefile


# ==========================================================
# CONFIGURACIÓN
# ==========================================================

URL_24H = os.environ.get(
    "VIIRS_URL_24H",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/shapes/zips/SUOMI_VIIRS_C2_Europe_24h.zip"
)

URL_48H = os.environ.get(
    "VIIRS_URL_48H",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/shapes/zips/SUOMI_VIIRS_C2_Europe_48h.zip"
)

URL_7D = os.environ.get(
    "VIIRS_URL_7D",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/shapes/zips/SUOMI_VIIRS_C2_Europe_7d.zip"
)

BASE_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = BASE_DIR / "datos" / "hotspots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILE_24H = OUT_DIR / "hotspots_24h.geojson"
FILE_48H = OUT_DIR / "hotspots_48h.geojson"
FILE_72H = OUT_DIR / "hotspots_72h.geojson"
FILE_7D = OUT_DIR / "hotspots_7d.geojson"
MANIFEST = OUT_DIR / "manifest_hotspots.json"

# Provincia de Valencia + margen
VALENCIA_BBOX = os.environ.get("VALENCIA_BBOX", "-1.70,38.60,0.05,40.25")
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = map(float, VALENCIA_BBOX.split(","))


# ==========================================================
# UTILIDADES
# ==========================================================

def now_utc():
    return datetime.now(timezone.utc)


def iso_utc(dt):
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def in_bbox(lon, lat):
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def write_geojson(path, features):
    data = {
        "type": "FeatureCollection",
        "features": features
    }

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def write_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def normalizar_clave(clave):
    return str(clave).strip().lower()


def forzar_ipv4():
    """
    GitHub Actions a veces intenta conectar por IPv6 y puede dar:
    OSError: [Errno 101] Network is unreachable

    Con esto obligamos a urllib a usar solo direcciones IPv4.
    """

    original_getaddrinfo = socket.getaddrinfo

    def getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
        return original_getaddrinfo(
            host,
            port,
            socket.AF_INET,
            type,
            proto,
            flags
        )

    socket.getaddrinfo = getaddrinfo_ipv4


def descargar_zip(url, destino, intentos=5):
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
                    "Accept": "application/zip,application/octet-stream,*/*",
                    "Connection": "close"
                }
            )

            with urlopen(req, timeout=240) as response:
                content = response.read()

            if not content or len(content) < 1000:
                raise RuntimeError(
                    f"Descarga demasiado pequeña o vacía: {len(content)} bytes"
                )

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

    raise RuntimeError(
        f"No se pudo descargar {url} después de {intentos} intentos. "
        f"Último error: {ultimo_error}"
    )


def buscar_shp(carpeta):
    shp_files = list(carpeta.rglob("*.shp"))

    if not shp_files:
        raise RuntimeError("No se encontró ningún archivo .shp dentro del ZIP")

    return shp_files[0]


def parse_fecha_viirs(props):
    """
    FIRMS suele traer:
    ACQ_DATE = YYYY-MM-DD
    ACQ_TIME = HHMM UTC
    """

    props_lower = {
        normalizar_clave(k): v
        for k, v in props.items()
    }

    acq_date = (
        props_lower.get("acq_date")
        or props_lower.get("acqdate")
        or props_lower.get("date")
    )

    acq_time = (
        props_lower.get("acq_time")
        or props_lower.get("acqtime")
        or props_lower.get("time")
    )

    if not acq_date:
        return None

    acq_date = str(acq_date).strip()

    if acq_time is None:
        acq_time = "0000"

    acq_time = str(acq_time).strip().zfill(4)

    try:
        dt = datetime.strptime(
            f"{acq_date} {acq_time}",
            "%Y-%m-%d %H%M"
        )
        return dt.replace(tzinfo=timezone.utc)

    except Exception:
        return None


def detectar_sensor(props):
    props_lower = {
        normalizar_clave(k): v
        for k, v in props.items()
    }

    satellite = str(props_lower.get("satellite", "SUOMI-NPP")).strip()
    instrument = str(props_lower.get("instrument", "VIIRS")).strip()

    return satellite, instrument


def crear_feature(lon, lat, props, fuente, periodo):
    dt = parse_fecha_viirs(props)
    satellite, instrument = detectar_sensor(props)

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
    props_out["metvlc_satellite"] = satellite
    props_out["metvlc_instrument"] = instrument
    props_out["metvlc_time_utc"] = iso_utc(dt)

    return {
        "type": "Feature",
        "properties": props_out,
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat]
        }
    }


def leer_zip_viirs(url, periodo):
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / f"viirs_{periodo}.zip"

        descargar_zip(url, zip_path)

        extract_dir = tmp_path / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(extract_dir)

        shp_path = buscar_shp(extract_dir)

        print(f"Leyendo shapefile: {shp_path.name}")

        reader = shapefile.Reader(str(shp_path))

        field_names = [
            field[0]
            for field in reader.fields
            if field[0] != "DeletionFlag"
        ]

        features = []
        total = 0

        for sr in reader.iterShapeRecords():
            total += 1

            shape = sr.shape
            record = sr.record

            props = {
                field_names[i]: record[i]
                for i in range(len(field_names))
            }

            lon = None
            lat = None

            if shape.points:
                lon = float(shape.points[0][0])
                lat = float(shape.points[0][1])

            if lon is None or lat is None:
                props_lower = {
                    normalizar_clave(k): v
                    for k, v in props.items()
                }

                lon = float(
                    props_lower.get("longitude")
                    or props_lower.get("lon")
                )
                lat = float(
                    props_lower.get("latitude")
                    or props_lower.get("lat")
                )

            if not in_bbox(lon, lat):
                continue

            feature = crear_feature(
                lon=lon,
                lat=lat,
                props=props,
                fuente="NASA FIRMS · SUOMI-NPP VIIRS C2",
                periodo=periodo
            )

            features.append(feature)

        print(f"{periodo}: registros totales Europe = {total}")
        print(f"{periodo}: puntos dentro BBOX Valencia = {len(features)}")

        return features


def filtrar_ultimas_horas(features, horas, ref_time):
    cutoff = ref_time - timedelta(hours=horas)

    salida = []

    for feature in features:
        props = feature.get("properties") or {}
        value = props.get("metvlc_time_utc")

        if not value:
            continue

        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue

        if dt >= cutoff:
            salida.append(feature)

    return salida


# ==========================================================
# MAIN
# ==========================================================

def main():
    ref_time = now_utc()

    features_24h = leer_zip_viirs(URL_24H, "24h")
    features_48h = leer_zip_viirs(URL_48H, "48h")
    features_7d = leer_zip_viirs(URL_7D, "7d")

    features_72h = filtrar_ultimas_horas(features_7d, 72, ref_time)

    write_geojson(FILE_24H, features_24h)
    write_geojson(FILE_48H, features_48h)
    write_geojson(FILE_72H, features_72h)
    write_geojson(FILE_7D, features_7d)

    manifest = {
        "producto": "Puntos calientes NASA FIRMS · SUOMI-NPP VIIRS C2",
        "fuente_24h": URL_24H,
        "fuente_48h": URL_48H,
        "fuente_7d": URL_7D,
        "actualizado_utc": iso_utc(ref_time),
        "bbox_valencia": {
            "lon_min": LON_MIN,
            "lat_min": LAT_MIN,
            "lon_max": LON_MAX,
            "lat_max": LAT_MAX
        },
        "hotspots_24h": len(features_24h),
        "hotspots_48h": len(features_48h),
        "hotspots_72h": len(features_72h),
        "hotspots_7d": len(features_7d),
        "archivos": [
            "hotspots_24h.geojson",
            "hotspots_48h.geojson",
            "hotspots_72h.geojson",
            "hotspots_7d.geojson"
        ],
        "nota": (
            "Los ZIP de FIRMS contienen shapefiles de puntos calientes VIIRS. "
            "Este visor filtra la zona de la provincia de Valencia mediante BBOX."
        )
    }

    write_json(MANIFEST, manifest)

    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
