// ===============================
// METVLC · VISOR HOTSPOTS VIIRS
// NASA FIRMS · SUOMI-NPP VIIRS C2
// Comunitat Valenciana
// Hotspots + combustible + pendiente + NDMI
// ===============================

console.log("visor.js hotspots VIIRS cargado correctamente");

// ===============================
// MAPA
// ===============================

const map = L.map("map", {
  center: [39.35, -0.45],
  zoom: 8,
  minZoom: 7,
  maxZoom: 16
});

// ===============================
// ORDEN DE CAPAS
// ===============================

map.createPane("pendientePane");
map.getPane("pendientePane").style.zIndex = 330;

map.createPane("ndmiPane");
map.getPane("ndmiPane").style.zIndex = 340;

map.createPane("combustiblePane");
map.getPane("combustiblePane").style.zIndex = 350;

map.createPane("limitePane");
map.getPane("limitePane").style.zIndex = 500;

map.createPane("hotspotsPane");
map.getPane("hotspotsPane").style.zIndex = 650;

// ===============================
// CAPAS BASE
// ===============================

const osm = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }
).addTo(map);

const cartoLight = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }
);

const baseLayers = {
  "OpenStreetMap": osm,
  "Carto claro": cartoLight
};

// ===============================
// GRUPOS DE CAPAS
// ===============================
// Por defecto se activan los hotspots y el límite de la Comunitat.
// Combustible, pendiente y NDMI quedan disponibles en el selector.

const pendienteLayer = L.layerGroup();
const ndmiLayer = L.layerGroup();
const combustibleLayer = L.layerGroup();
const limiteLayer = L.layerGroup().addTo(map);
const hotspotsLayer = L.layerGroup().addTo(map);

const overlayLayers = {
  "Puntos calientes VIIRS": hotspotsLayer,
  "Límite Comunitat Valenciana": limiteLayer,
  "Modelo de combustible": combustibleLayer,
  "Pendiente": pendienteLayer,
  "NDMI Comunitat Valenciana": ndmiLayer
};

L.control.layers(baseLayers, overlayLayers, {
  collapsed: false
}).addTo(map);

// ===============================
// RUTAS
// ===============================

const HOTSPOTS_FILES = {
  24: "datos/hotspots/hotspots_24h.geojson",
  48: "datos/hotspots/hotspots_48h.geojson",
  72: "datos/hotspots/hotspots_72h.geojson",
  168: "datos/hotspots/hotspots_7d.geojson"
};

const HOTSPOTS_MANIFEST = "datos/hotspots/manifest_hotspots.json";

const LIMITE_CV = "datos/limites/comunitat_valenciana.geojson";

const COMBUSTIBLE_IMAGE = "datos/combustible/modelo_combustible.png";
const COMBUSTIBLE_BOUNDS = "datos/combustible/modelo_combustible_bounds.json";
const COMBUSTIBLE_LEYENDA = "datos/combustible/modelo_combustible_leyenda.json";

const PENDIENTE_IMAGE = "datos/pendiente/pendiente.png";
const PENDIENTE_BOUNDS = "datos/pendiente/pendiente_bounds.json";

const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";
const NDMI_BOUNDS = "datos/ndmi/ndmi_bounds.json";

// ===============================
// VARIABLES
// ===============================

let primeraCargaHotspots = true;
let limiteGeojsonLayer = null;

let combustibleOverlay = null;
let pendienteOverlay = null;
let ndmiOverlay = null;

let combustibleOpacity = 0.55;
let pendienteOpacity = 0.65;
let ndmiOpacity = 0.65;

// ===============================
// UTILIDADES
// ===============================

function urlNoCache(url) {
  return `${url}?v=${Date.now()}`;
}

function setInfoHotspots(texto) {
  const info = document.getElementById("infoHotspots");

  if (info) {
    info.textContent = texto;
  }

  console.log(texto);
}

async function cargarJSON(url) {
  const response = await fetch(urlNoCache(url), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`No se pudo cargar ${url} · HTTP ${response.status}`);
  }

  return await response.json();
}

function convertirBounds(data) {
  if (data.bounds && Array.isArray(data.bounds)) {
    return L.latLngBounds(data.bounds);
  }

  if (data.bbox) {
    return L.latLngBounds(
      [data.bbox.lat_min, data.bbox.lon_min],
      [data.bbox.lat_max, data.bbox.lon_max]
    );
  }

  throw new Error("Archivo bounds sin formato válido");
}

async function cargarBounds(url) {
  const data = await cargarJSON(url);
  const bounds = convertirBounds(data);

  if (!bounds.isValid()) {
    throw new Error(`Bounds no válidos en ${url}`);
  }

  return bounds;
}

function getProp(props, nombres, valorDefecto = "") {
  for (const nombre of nombres) {
    if (props[nombre] !== undefined && props[nombre] !== null && props[nombre] !== "") {
      return props[nombre];
    }

    const lower = nombre.toLowerCase();
    const upper = nombre.toUpperCase();

    if (props[lower] !== undefined && props[lower] !== null && props[lower] !== "") {
      return props[lower];
    }

    if (props[upper] !== undefined && props[upper] !== null && props[upper] !== "") {
      return props[upper];
    }
  }

  return valorDefecto;
}

// ===============================
// LÍMITE COMUNITAT VALENCIANA
// ===============================

async function cargarLimiteCV() {
  try {
    const data = await cargarJSON(LIMITE_CV);

    limiteGeojsonLayer = L.geoJSON(data, {
      pane: "limitePane",
      style: {
        color: "#174d6d",
        weight: 2,
        opacity: 0.95,
        fill: false
      }
    });

    limiteGeojsonLayer.addTo(limiteLayer);

    const bounds = limiteGeojsonLayer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.08));
    }

    console.log("Límite Comunitat Valenciana cargado correctamente");

  } catch (error) {
    console.warn("No se pudo cargar el límite de la Comunitat Valenciana:", error);
  }
}

// ===============================
// FECHAS HOTSPOTS
// ===============================

function parseFechaUTC(value) {
  if (!value) return null;

  const d = new Date(value);

  if (isNaN(d.getTime())) {
    return null;
  }

  return d;
}

function edadHoras(feature) {
  const props = feature.properties || {};
  const fecha = parseFechaUTC(props.metvlc_time_utc);

  if (!fecha) return null;

  return (new Date() - fecha) / 1000 / 3600;
}

function colorPorEdad(horas) {
  if (horas === null) return "#666666";
  if (horas <= 6) return "#ff0000";
  if (horas <= 24) return "#ff8c00";
  if (horas <= 48) return "#ffd400";
  if (horas <= 72) return "#7a7a7a";
  return "#6a3d9a";
}

function radioPorEdad(horas) {
  if (horas === null) return 7;
  if (horas <= 6) return 10;
  if (horas <= 24) return 9;
  if (horas <= 48) return 8;
  if (horas <= 72) return 7;
  return 6;
}

function formatearFecha(value) {
  const d = parseFechaUTC(value);

  if (!d) return "Sin fecha";

  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function textoPeriodo(horas) {
  if (horas === 168) return "7 días";
  return `${horas} h`;
}

// ===============================
// POPUP HOTSPOTS
// ===============================

function crearPopupHotspot(feature) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];

  const lon = coords[0];
  const lat = coords[1];

  const h = edadHoras(feature);
  const antiguedad = h !== null ? `${h.toFixed(1)} h` : "No disponible";

  const satellite = getProp(props, ["metvlc_satellite", "satellite"], "SUOMI-NPP");
  const instrument = getProp(props, ["metvlc_instrument", "instrument"], "VIIRS");
  const confidence = getProp(props, ["confidence", "CONFIDENCE"], "No disponible");
  const frp = getProp(props, ["frp", "FRP"], "No disponible");
  const brightTi4 = getProp(props, ["bright_ti4", "BRIGHT_TI4"], "No disponible");
  const brightTi5 = getProp(props, ["bright_ti5", "BRIGHT_TI5"], "No disponible");
  const daynight = getProp(props, ["daynight", "DAYNIGHT"], "No disponible");
  const source = getProp(props, ["metvlc_fuente"], "NASA FIRMS · SUOMI-NPP VIIRS C2");

  return `
    <div style="min-width:250px">
      <strong>Punto caliente VIIRS</strong><br>
      <hr style="margin:6px 0">

      <strong>Fecha:</strong> ${formatearFecha(props.metvlc_time_utc)}<br>
      <strong>Antigüedad:</strong> ${antiguedad}<br>
      <strong>Satélite:</strong> ${satellite}<br>
      <strong>Sensor:</strong> ${instrument}<br>
      <strong>Confianza:</strong> ${confidence}<br>
      <strong>FRP:</strong> ${frp}<br>
      <strong>Bright TI4:</strong> ${brightTi4}<br>
      <strong>Bright TI5:</strong> ${brightTi5}<br>
      <strong>Día/noche:</strong> ${daynight}<br>
      <strong>Lat/Lon:</strong> ${lat?.toFixed(5)}, ${lon?.toFixed(5)}

      <hr style="margin:6px 0">
      <small>${source}</small>
    </div>
  `;
}

// ===============================
// CARGAR HOTSPOTS
// ===============================

async function cargarHotspots(horas = 24) {
  try {
    setInfoHotspots(`Cargando puntos calientes VIIRS · últimas ${textoPeriodo(horas)}...`);

    hotspotsLayer.clearLayers();

    const data = await cargarJSON(HOTSPOTS_FILES[horas]);
    const features = data.features || [];

    console.log(`Hotspots cargados ${textoPeriodo(horas)}:`, features.length);

    const geojson = L.geoJSON(data, {
      pointToLayer: function (feature, latlng) {
        const h = edadHoras(feature);

        return L.circleMarker(latlng, {
          pane: "hotspotsPane",
          radius: radioPorEdad(h),
          color: "#111111",
          weight: 1.7,
          fillColor: colorPorEdad(h),
          fillOpacity: 0.92,
          opacity: 1
        });
      },

      onEachFeature: function (feature, layer) {
        layer.bindPopup(crearPopupHotspot(feature));
      }
    });

    geojson.addTo(hotspotsLayer);

    if (features.length > 0 && primeraCargaHotspots) {
      const bounds = geojson.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.25));
      }

      primeraCargaHotspots = false;
    }

    await cargarManifestHotspots(horas, features.length);

  } catch (error) {
    console.error("ERROR cargando hotspots:", error);
    setInfoHotspots(`ERROR: ${error.message}`);
  }
}

// ===============================
// MANIFEST HOTSPOTS
// ===============================

async function cargarManifestHotspots(horasSeleccionadas, totalFeatures) {
  try {
    const manifest = await cargarJSON(HOTSPOTS_MANIFEST);

    const actualizado = manifest.actualizado_utc
      ? new Date(manifest.actualizado_utc).toLocaleString("es-ES", {
          timeZone: "Europe/Madrid",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "sin fecha";

    setInfoHotspots(
      `Puntos calientes VIIRS · ${textoPeriodo(horasSeleccionadas)} · ${totalFeatures} detecciones · actualizado: ${actualizado}`
    );

  } catch (error) {
    console.warn("No se pudo cargar manifest_hotspots.json", error);

    setInfoHotspots(
      `Puntos calientes VIIRS · ${textoPeriodo(horasSeleccionadas)} · ${totalFeatures} detecciones`
    );
  }
}

// ===============================
// BOTONES 24 / 48 / 72 / 7D
// ===============================

document.querySelectorAll(".time-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".time-btn").forEach(b => {
      b.classList.remove("active");
    });

    btn.classList.add("active");

    const horas = Number(btn.dataset.hours);
    cargarHotspots(horas);
  });
});

// ===============================
// CAPAS RASTER
// ===============================

async function cargarCapaRaster(nombre, imageUrl, boundsUrl, layerGroup, pane, opacity) {
  try {
    const bounds = await cargarBounds(boundsUrl);

    const overlay = L.imageOverlay(urlNoCache(imageUrl), bounds, {
      pane: pane,
      opacity: opacity,
      interactive: false
    });

    overlay.addTo(layerGroup);

    console.log(`${nombre} cargado correctamente`);

    return overlay;

  } catch (error) {
    console.warn(`No se pudo cargar ${nombre}:`, error);
    return null;
  }
}

async function cargarCombustible() {
  combustibleOverlay = await cargarCapaRaster(
    "modelo de combustible",
    COMBUSTIBLE_IMAGE,
    COMBUSTIBLE_BOUNDS,
    combustibleLayer,
    "combustiblePane",
    combustibleOpacity
  );
}

async function cargarPendiente() {
  pendienteOverlay = await cargarCapaRaster(
    "pendiente",
    PENDIENTE_IMAGE,
    PENDIENTE_BOUNDS,
    pendienteLayer,
    "pendientePane",
    pendienteOpacity
  );
}

async function cargarNDMI() {
  ndmiOverlay = await cargarCapaRaster(
    "NDMI",
    NDMI_IMAGE,
    NDMI_BOUNDS,
    ndmiLayer,
    "ndmiPane",
    ndmiOpacity
  );
}

// ===============================
// CONTROL DE OPACIDADES
// ===============================

const opacityControl = L.control({
  position: "topright"
});

opacityControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend opacity-box");

  div.innerHTML = `
    <div class="legend-title">Opacidad capas</div>

    <label style="display:block;margin-top:6px;">
      Combustible
      <input 
        id="combustibleOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${combustibleOpacity}"
        style="width:130px;"
      >
    </label>

    <label style="display:block;margin-top:6px;">
      Pendiente
      <input 
        id="pendienteOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${pendienteOpacity}"
        style="width:130px;"
      >
    </label>

    <label style="display:block;margin-top:6px;">
      NDMI
      <input 
        id="ndmiOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${ndmiOpacity}"
        style="width:130px;"
      >
    </label>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  setTimeout(() => {
    const combustibleInput = document.getElementById("combustibleOpacity");
    const pendienteInput = document.getElementById("pendienteOpacity");
    const ndmiInput = document.getElementById("ndmiOpacity");

    if (combustibleInput) {
      combustibleInput.addEventListener("input", e => {
        combustibleOpacity = Number(e.target.value);

        if (combustibleOverlay) {
          combustibleOverlay.setOpacity(combustibleOpacity);
        }
      });
    }

    if (pendienteInput) {
      pendienteInput.addEventListener("input", e => {
        pendienteOpacity = Number(e.target.value);

        if (pendienteOverlay) {
          pendienteOverlay.setOpacity(pendienteOpacity);
        }
      });
    }

    if (ndmiInput) {
      ndmiInput.addEventListener("input", e => {
        ndmiOpacity = Number(e.target.value);

        if (ndmiOverlay) {
          ndmiOverlay.setOpacity(ndmiOpacity);
        }
      });
    }
  }, 300);

  return div;
};

opacityControl.addTo(map);

// ===============================
// LEYENDA COMBUSTIBLE
// ===============================

function rgbaToCss(rgba) {
  if (!rgba || rgba.length < 3) {
    return "rgba(180,180,180,0.85)";
  }

  const r = rgba[0];
  const g = rgba[1];
  const b = rgba[2];
  const a = rgba.length >= 4 ? rgba[3] / 255 : 1;

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function colorCombustible(item) {
  if (item.color_rgba) return rgbaToCss(item.color_rgba);
  if (item.rgba) return rgbaToCss(item.rgba);
  if (item.color) return item.color;
  if (item.fill) return item.fill;

  return "#c17f35";
}

function nombreCombustible(item) {
  return (
    item.nombre ??
    item.name ??
    item.descripcion ??
    item.description ??
    item.modelo ??
    item.codigo ??
    item.valor ??
    "Modelo combustible"
  );
}

function extraerGruposCombustible(data) {
  if (!data) return [];

  if (Array.isArray(data.grupos)) return data.grupos;
  if (Array.isArray(data.familias)) return data.familias;
  if (Array.isArray(data.categorias)) return data.categorias;

  if (Array.isArray(data.valores)) {
    return [
      {
        nombre: "Modelos de combustible",
        items: data.valores
      }
    ];
  }

  if (Array.isArray(data.items)) {
    return [
      {
        nombre: "Modelos de combustible",
        items: data.items
      }
    ];
  }

  if (Array.isArray(data.leyenda)) {
    return [
      {
        nombre: "Modelos de combustible",
        items: data.leyenda
      }
    ];
  }

  return [];
}

function renderGrupoCombustible(grupo, abierto = false) {
  const nombreGrupo =
    grupo.nombre ??
    grupo.name ??
    grupo.familia ??
    grupo.categoria ??
    "Grupo";

  const items =
    grupo.items ??
    grupo.valores ??
    grupo.modelos ??
    grupo.clases ??
    [];

  if (!items.length) return "";

  const openAttr = abierto ? "open" : "";

  const htmlItems = items.map(item => {
    const color = colorCombustible(item);
    const nombre = nombreCombustible(item);

    return `
      <div class="legend-item">
        <span class="legend-square" style="background:${color}"></span>
        ${nombre}
      </div>
    `;
  }).join("");

  return `
    <details ${openAttr} style="margin-top:5px;">
      <summary style="font-weight:600; cursor:pointer;">${nombreGrupo}</summary>
      <div style="margin-top:5px;">
        ${htmlItems}
      </div>
    </details>
  `;
}

async function cargarLeyendaCombustible() {
  try {
    const data = await cargarJSON(COMBUSTIBLE_LEYENDA);
    const grupos = extraerGruposCombustible(data);

    if (!grupos.length) {
      return `
        <div class="legend-item">
          <span class="legend-square" style="background:#c17f35"></span>
          Modelo de combustible
        </div>
      `;
    }

    return grupos.map((grupo, i) => {
      return renderGrupoCombustible(grupo, i === 0);
    }).join("");

  } catch (error) {
    console.warn("No se pudo cargar la leyenda de combustible:", error);

    return `
      <div class="legend-item">
        <span class="legend-square" style="background:#c17f35"></span>
        Modelo de combustible
      </div>
    `;
  }
}

// ===============================
// LEYENDA GENERAL
// ===============================

const legend = L.control({
  position: "bottomleft"
});

legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend main-legend");

  div.innerHTML = `
    <div class="legend-title">Leyenda del visor</div>

    <details open style="margin-top:6px;">
      <summary style="font-weight:700; cursor:pointer;">Puntos calientes VIIRS</summary>

      <div style="margin-top:6px;">
        <div class="legend-item">
          <span class="legend-dot" style="background:#ff0000"></span>
          0 - 6 h
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#ff8c00"></span>
          6 - 24 h
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#ffd400"></span>
          24 - 48 h
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#7a7a7a"></span>
          48 - 72 h
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#6a3d9a"></span>
          72 h - 7 días
        </div>
      </div>
    </details>

    <hr>

    <details open>
      <summary style="font-weight:700; cursor:pointer;">Pendiente media del terreno</summary>

      <div style="margin-top:6px;">
        <div class="legend-item">
          <span class="legend-square" style="background:transparent; border:1px dashed #777;"></span>
          ≤ 25 % · transparente
        </div>

        <div class="legend-item">
          <span class="legend-square" style="background:#ffff00"></span>
          &gt; 25 % y ≤ 30 %
        </div>

        <div class="legend-item">
          <span class="legend-square" style="background:#ff8500"></span>
          &gt; 30 % y ≤ 50 %
        </div>

        <div class="legend-item">
          <span class="legend-square" style="background:#910000"></span>
          &gt; 50 %
        </div>
      </div>
    </details>

    <hr>

    <details open>
      <summary style="font-weight:700; cursor:pointer;">NDMI Comunitat Valenciana</summary>

      <div style="margin-top:6px;">
        <div style="
          width:180px;
          height:13px;
          border-radius:6px;
          border:1px solid #777;
          background:linear-gradient(to right, #ff7f00, #ffff33, #00bfff, #0033ff);
          margin:5px 0 6px 0;
        "></div>

        <div style="
          display:flex;
          justify-content:space-between;
          font-size:11px;
          gap:8px;
        ">
          <span>Más seco</span>
          <span>Más húmedo</span>
        </div>
      </div>
    </details>

    <hr>

    <details>
      <summary style="font-weight:700; cursor:pointer;">Modelo de combustible</summary>

      <div id="leyendaCombustible" style="
        margin-top:6px;
        max-height:210px;
        overflow-y:auto;
        padding-right:4px;
      ">
        Cargando leyenda...
      </div>
    </details>

    <hr>

    <div class="legend-item">
      <span class="legend-line"></span>
      Límite Comunitat Valenciana
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  setTimeout(async () => {
    const contenedor = document.getElementById("leyendaCombustible");

    if (contenedor) {
      contenedor.innerHTML = await cargarLeyendaCombustible();
    }
  }, 250);

  return div;
};

legend.addTo(map);

// ===============================
// INICIO
// ===============================

cargarLimiteCV();
cargarHotspots(24);
cargarCombustible();
cargarPendiente();
cargarNDMI();
