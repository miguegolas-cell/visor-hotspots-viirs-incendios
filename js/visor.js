// ============================================================
// METVLC · VISOR PUNTOS CALIENTES VIIRS
// Hotspots NASA FIRMS · Comunitat Valenciana
// Capas: hotspots, límite CV, combustible, pendiente, NDMI
// Herramienta: dibujar perímetro + cálculo superficie/perímetro + KML
// ============================================================


// ===============================
// RUTAS
// ===============================

const HOTSPOTS_FILES = {
  "24h": "datos/hotspots/hotspots_24h.geojson",
  "48h": "datos/hotspots/hotspots_48h.geojson",
  "72h": "datos/hotspots/hotspots_72h.geojson",
  "7d": "datos/hotspots/hotspots_7d.geojson"
};

const HOTSPOTS_MANIFEST = "datos/hotspots/manifest_hotspots.json";

const LIMITE_CV = "datos/limites/comunitat_valenciana.geojson";

const COMBUSTIBLE_IMAGE = "datos/combustible/modelo_combustible.png";
const COMBUSTIBLE_BOUNDS = "datos/combustible/modelo_combustible_bounds.json";
const COMBUSTIBLE_LEYENDA = "datos/combustible/modelo_combustible_leyenda.json";

const PENDIENTE_IMAGE = "datos/pendiente/pendiente.png";
const PENDIENTE_BOUNDS = "datos/pendiente/pendiente_bounds.json";
const PENDIENTE_LEYENDA = "datos/pendiente/pendiente_leyenda.json";

const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";
const NDMI_BOUNDS = "datos/ndmi/ndmi_bounds.json";
const NDMI_LEYENDA = "datos/ndmi/ndmi_leyenda.json";


// ===============================
// MAPA
// ===============================

const map = L.map("map", {
  center: [39.35, -0.45],
  zoom: 8,
  minZoom: 7,
  maxZoom: 18,
  zoomControl: true
});

map.createPane("panePendiente");
map.getPane("panePendiente").style.zIndex = 330;

map.createPane("paneNdmi");
map.getPane("paneNdmi").style.zIndex = 340;

map.createPane("paneCombustible");
map.getPane("paneCombustible").style.zIndex = 350;

map.createPane("paneLimite");
map.getPane("paneLimite").style.zIndex = 500;

map.createPane("paneHotspots");
map.getPane("paneHotspots").style.zIndex = 650;

map.createPane("paneDibujo");
map.getPane("paneDibujo").style.zIndex = 700;

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
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }
);

// -------------------------------
// Capas base Esri: satélite y relieve
// -------------------------------

function crearEsriWorldImagery() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }
  );
}

function crearEsriHillshade(opacity = 0.32) {
  return L.tileLayer(
    "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 13,
      maxZoom: 19,
      opacity: opacity,
      attribution: "Hillshade &copy; Esri"
    }
  );
}

function crearEsriEtiquetas() {
  return L.tileLayer(
    "https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Labels &copy; Esri"
    }
  );
}

function crearEsriRelieveSombreado() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 13,
      maxZoom: 19,
      attribution: "Relief &copy; Esri"
    }
  );
}

const esriSatelite = crearEsriWorldImagery();

const esriSateliteRelieve = L.layerGroup([
  crearEsriWorldImagery(),
  crearEsriHillshade(0.28),
  crearEsriEtiquetas()
]);

const esriRelieveSombreado = crearEsriRelieveSombreado();

const baseLayers = {
  "OpenStreetMap": osm,
  "Carto claro": cartoLight,
  "Satélite + relieve": esriSateliteRelieve,
  "Satélite Esri": esriSatelite,
  "Relieve sombreado": esriRelieveSombreado
};

const overlayLayers = {};

let layerControl = L.control.layers(baseLayers, overlayLayers, {
  collapsed: false
}).addTo(map);


// ===============================
// VARIABLES DE CAPAS
// ===============================

let hotspotsLayer = L.layerGroup([], {
  pane: "paneHotspots"
}).addTo(map);

let limiteLayer = null;
let combustibleLayer = null;
let pendienteLayer = null;
let ndmiLayer = null;

let activePeriod = "24h";


// ===============================
// UTILIDADES
// ===============================

function urlNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

function setEstado(texto) {
  const el = document.getElementById("estadoDatos");
  if (el) el.textContent = texto;
}

async function fetchJson(url) {
  const response = await fetch(urlNoCache(url));

  if (!response.ok) {
    throw new Error(`No se pudo cargar ${url}: ${response.status}`);
  }

  return response.json();
}

function normalizarFechaUTC(valor) {
  if (!valor) return null;

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) return null;

  return fecha;
}

function horasDesdeFecha(valor) {
  const fecha = normalizarFechaUTC(valor);

  if (!fecha) return null;

  return (Date.now() - fecha.getTime()) / 3600000;
}

function formatoFecha(valor) {
  const fecha = normalizarFechaUTC(valor);

  if (!fecha) return "Sin fecha";

  return fecha.toLocaleString("es-ES", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }) + " UTC";
}

function getProp(props, keys, fallback = "") {
  for (const key of keys) {
    if (props[key] !== undefined && props[key] !== null && props[key] !== "") {
      return props[key];
    }
  }

  return fallback;
}

function colorPorAntiguedad(props) {
  const fecha = getProp(props, [
    "metvlc_time_utc",
    "ACQ_DATE",
    "acq_date"
  ], null);

  let horas = null;

  if (props.metvlc_time_utc) {
    horas = horasDesdeFecha(props.metvlc_time_utc);
  }

  if (horas === null) {
    return "#ff3b00";
  }

  if (horas <= 6) return "#ff0000";
  if (horas <= 24) return "#ff8c00";
  if (horas <= 48) return "#ffd400";
  if (horas <= 72) return "#7a7a7a";

  return "#6a3d9a";
}

function radioPorConfianza(props) {
  const conf = getProp(props, ["CONFIDENCE", "confidence"], "");
  const confNum = Number(conf);

  if (!Number.isNaN(confNum)) {
    if (confNum >= 80) return 7;
    if (confNum >= 50) return 6;
    return 5;
  }

  const confText = String(conf).toLowerCase();

  if (confText.includes("high")) return 7;
  if (confText.includes("nominal")) return 6;
  if (confText.includes("low")) return 5;

  return 6;
}

function popupHotspot(feature) {
  const p = feature.properties || {};

  const sat = getProp(p, [
    "metvlc_satellite",
    "SATELLITE",
    "satellite"
  ], "VIIRS");

  const instrumento = getProp(p, [
    "metvlc_instrument",
    "INSTRUMENT",
    "instrument"
  ], "VIIRS");

  const fecha = getProp(p, [
    "metvlc_time_utc"
  ], null);

  const acqDate = getProp(p, ["ACQ_DATE", "acq_date"], "");
  const acqTime = getProp(p, ["ACQ_TIME", "acq_time"], "");

  const confianza = getProp(p, ["CONFIDENCE", "confidence"], "—");
  const frp = getProp(p, ["FRP", "frp"], "—");
  const brightT31 = getProp(p, ["BRIGHT_T31", "bright_t31"], "—");
  const brightTi4 = getProp(p, ["BRIGHT_TI4", "bright_ti4"], "—");
  const brightTi5 = getProp(p, ["BRIGHT_TI5", "bright_ti5"], "—");
  const daynight = getProp(p, ["DAYNIGHT", "daynight"], "—");
  const fuente = getProp(p, ["metvlc_fuente"], "NASA FIRMS");

  let fechaTexto = "Sin fecha";

  if (fecha) {
    fechaTexto = formatoFecha(fecha);
  } else if (acqDate) {
    fechaTexto = `${acqDate} ${acqTime || ""} UTC`;
  }

  return `
    <div class="popup-title">Punto caliente</div>
    <table class="popup-table">
      <tr><td>Satélite</td><td>${sat}</td></tr>
      <tr><td>Sensor</td><td>${instrumento}</td></tr>
      <tr><td>Fecha</td><td>${fechaTexto}</td></tr>
      <tr><td>Confianza</td><td>${confianza}</td></tr>
      <tr><td>FRP</td><td>${frp}</td></tr>
      <tr><td>Bright T31</td><td>${brightT31}</td></tr>
      <tr><td>Bright TI4</td><td>${brightTi4}</td></tr>
      <tr><td>Bright TI5</td><td>${brightTi5}</td></tr>
      <tr><td>Día/noche</td><td>${daynight}</td></tr>
      <tr><td>Fuente</td><td>${fuente}</td></tr>
    </table>
  `;
}


// ===============================
// HOTSPOTS
// ===============================

async function cargarHotspots(periodo) {
  activePeriod = periodo;

  setEstado(`Cargando puntos ${periodo}...`);

  try {
    const geojson = await fetchJson(HOTSPOTS_FILES[periodo]);

    hotspotsLayer.clearLayers();

    const layer = L.geoJSON(geojson, {
      pane: "paneHotspots",

      pointToLayer: function (feature, latlng) {
        const props = feature.properties || {};

        return L.circleMarker(latlng, {
          radius: radioPorConfianza(props),
          color: "#1b1b1b",
          weight: 1,
          fillColor: colorPorAntiguedad(props),
          fillOpacity: 0.88,
          opacity: 1,
          pane: "paneHotspots"
        });
      },

      onEachFeature: function (feature, layer) {
        layer.bindPopup(popupHotspot(feature));
      }
    });

    layer.addTo(hotspotsLayer);

    const total = geojson.features ? geojson.features.length : 0;
    setEstado(`${total} puntos cargados · ${periodo}`);

    actualizarBotonesPeriodo(periodo);

  } catch (error) {
    console.error(error);
    setEstado(`Error cargando puntos ${periodo}`);
  }
}

function actualizarBotonesPeriodo(periodo) {
  document.querySelectorAll(".period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.period === periodo);
  });
}

document.querySelectorAll(".period-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    cargarHotspots(btn.dataset.period);
  });
});


// ===============================
// LÍMITE CV
// ===============================

async function cargarLimiteCV() {
  try {
    const geojson = await fetchJson(LIMITE_CV);

    limiteLayer = L.geoJSON(geojson, {
      pane: "paneLimite",
      style: {
        color: "#102a3a",
        weight: 2,
        opacity: 0.85,
        fillOpacity: 0
      }
    }).addTo(map);

    overlayLayers["Límite Comunitat Valenciana"] = limiteLayer;
    layerControl.addOverlay(limiteLayer, "Límite Comunitat Valenciana");

    try {
      map.fitBounds(limiteLayer.getBounds(), {
        padding: [20, 20]
      });
    } catch (e) {
      console.warn("No se pudo ajustar al límite CV", e);
    }

  } catch (error) {
    console.warn("No se pudo cargar límite CV", error);
  }
}


// ===============================
// RÁSTERES COMO IMAGEOVERLAY
// ===============================

function normalizarBounds(boundsJson) {
  if (Array.isArray(boundsJson)) {
    return boundsJson;
  }

  if (boundsJson.bounds) {
    return boundsJson.bounds;
  }

  if (
    boundsJson.south !== undefined &&
    boundsJson.west !== undefined &&
    boundsJson.north !== undefined &&
    boundsJson.east !== undefined
  ) {
    return [
      [boundsJson.south, boundsJson.west],
      [boundsJson.north, boundsJson.east]
    ];
  }

  throw new Error("Formato de bounds no reconocido");
}

async function cargarImageOverlay(nombre, imageUrl, boundsUrl, pane, opacity) {
  try {
    const boundsJson = await fetchJson(boundsUrl);
    const bounds = normalizarBounds(boundsJson);

    const layer = L.imageOverlay(urlNoCache(imageUrl), bounds, {
      pane: pane,
      opacity: opacity,
      interactive: false
    });

    layer._metvlcNombre = nombre;

    layerControl.addOverlay(layer, nombre);

    return layer;

  } catch (error) {
    console.warn(`No se pudo cargar ${nombre}`, error);
    return null;
  }
}

async function cargarRasteres() {
  pendienteLayer = await cargarImageOverlay(
    "Pendiente",
    PENDIENTE_IMAGE,
    PENDIENTE_BOUNDS,
    "panePendiente",
    0.70
  );

  ndmiLayer = await cargarImageOverlay(
    "NDMI",
    NDMI_IMAGE,
    NDMI_BOUNDS,
    "paneNdmi",
    0.72
  );

  combustibleLayer = await cargarImageOverlay(
    "Modelo de combustible",
    COMBUSTIBLE_IMAGE,
    COMBUSTIBLE_BOUNDS,
    "paneCombustible",
    0.72
  );
}


// ===============================
// LEYENDAS
// ===============================

const legendHotspots = L.control({
  position: "bottomleft"
});

legendHotspots.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Puntos calientes</div>
    <div class="legend-item"><span class="legend-color" style="background:#ff0000"></span>0–6 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#ff8c00"></span>6–24 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#ffd400"></span>24–48 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#7a7a7a"></span>48–72 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#6a3d9a"></span>72 h–7 días</div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

legendHotspots.addTo(map);

async function crearLeyendaDesdeJson(titulo, url, posicion) {
  try {
    const data = await fetchJson(url);

    const control = L.control({
      position: posicion
    });

    control.onAdd = function () {
      const div = L.DomUtil.create("div", "legend");

      let html = `<div class="legend-title">${data.titulo || titulo}</div>`;

      if (Array.isArray(data.items)) {
        data.items.forEach(item => {
          html += `
            <div class="legend-item">
              <span class="legend-color" style="background:${item.color || item.colour || "#999"}"></span>
              ${item.label || item.nombre || item.name || ""}
            </div>
          `;
        });
      }

      if (Array.isArray(data.grupos)) {
        data.grupos.forEach(item => {
          html += `
            <div class="legend-item">
              <span class="legend-color" style="background:${item.color || item.colour || "#999"}"></span>
              ${item.label || item.nombre || item.name || ""}
            </div>
          `;
        });
      }

      if (data.nota) {
        html += `<div class="measure-small">${data.nota}</div>`;
      }

      div.innerHTML = html;

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      return div;
    };

    return control;

  } catch (error) {
    console.warn(`No se pudo cargar leyenda ${titulo}`, error);
    return null;
  }
}


// ===============================
// CONTROL DE OPACIDAD
// ===============================

const opacityControl = L.control({
  position: "topright"
});

opacityControl.onAdd = function () {
  const div = L.DomUtil.create("div", "opacity-control");

  div.innerHTML = `
    <label>Opacidad capas</label>

    <div class="opacity-row">
      <span>Pendiente</span>
      <input id="opPendiente" type="range" min="0" max="1" step="0.05" value="0.70">
    </div>

    <div class="opacity-row">
      <span>NDMI</span>
      <input id="opNdmi" type="range" min="0" max="1" step="0.05" value="0.72">
    </div>

    <div class="opacity-row">
      <span>Combustible</span>
      <input id="opCombustible" type="range" min="0" max="1" step="0.05" value="0.72">
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

opacityControl.addTo(map);

function activarControlesOpacidad() {
  const opPendiente = document.getElementById("opPendiente");
  const opNdmi = document.getElementById("opNdmi");
  const opCombustible = document.getElementById("opCombustible");

  if (opPendiente) {
    opPendiente.addEventListener("input", e => {
      if (pendienteLayer) pendienteLayer.setOpacity(Number(e.target.value));
    });
  }

  if (opNdmi) {
    opNdmi.addEventListener("input", e => {
      if (ndmiLayer) ndmiLayer.setOpacity(Number(e.target.value));
    });
  }

  if (opCombustible) {
    opCombustible.addEventListener("input", e => {
      if (combustibleLayer) combustibleLayer.setOpacity(Number(e.target.value));
    });
  }
}


// ===============================
// DESCARGAS DIRECTAS
// ===============================

const descargaControl = L.control({
  position: "topleft"
});

descargaControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Descargas</div>
    <div style="display:grid;gap:6px;">
      <button class="download-btn" data-file="24h">GeoJSON 24 h</button>
      <button class="download-btn" data-file="48h">GeoJSON 48 h</button>
      <button class="download-btn" data-file="72h">GeoJSON 72 h</button>
      <button class="download-btn" data-file="7d">GeoJSON 7 días</button>
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

descargaControl.addTo(map);

setTimeout(() => {
  document.querySelectorAll(".download-btn").forEach(btn => {
    btn.style.padding = "6px 9px";
    btn.style.border = "none";
    btn.style.borderRadius = "7px";
    btn.style.background = "#0b4f75";
    btn.style.color = "#fff";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", () => {
      const periodo = btn.dataset.file;
      const a = document.createElement("a");
      a.href = HOTSPOTS_FILES[periodo];
      a.download = `hotspots_${periodo}.geojson`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}, 500);


// ============================================================
// HERRAMIENTA DE DIBUJO DE PERÍMETROS
// ============================================================

const perimetrosDibujados = new L.FeatureGroup();
map.addLayer(perimetrosDibujados);

// Traducción básica Leaflet.draw
L.drawLocal.draw.toolbar.buttons.polygon = "Dibujar perímetro";
L.drawLocal.draw.toolbar.actions.title = "Cancelar dibujo";
L.drawLocal.draw.toolbar.actions.text = "Cancelar";
L.drawLocal.draw.toolbar.finish.title = "Finalizar perímetro";
L.drawLocal.draw.toolbar.finish.text = "Finalizar";
L.drawLocal.draw.toolbar.undo.title = "Eliminar último punto";
L.drawLocal.draw.toolbar.undo.text = "Eliminar último punto";

L.drawLocal.draw.handlers.polygon.tooltip.start = "Haz clic para empezar el perímetro";
L.drawLocal.draw.handlers.polygon.tooltip.cont = "Haz clic para continuar dibujando";
L.drawLocal.draw.handlers.polygon.tooltip.end = "Haz clic en el primer punto para cerrar el perímetro";

L.drawLocal.edit.toolbar.buttons.edit = "Editar perímetro";
L.drawLocal.edit.toolbar.buttons.remove = "Borrar perímetro";
L.drawLocal.edit.toolbar.actions.save.title = "Guardar cambios";
L.drawLocal.edit.toolbar.actions.save.text = "Guardar";
L.drawLocal.edit.toolbar.actions.cancel.title = "Cancelar edición";
L.drawLocal.edit.toolbar.actions.cancel.text = "Cancelar";
L.drawLocal.edit.toolbar.actions.clearAll.title = "Borrar todos";
L.drawLocal.edit.toolbar.actions.clearAll.text = "Borrar todos";

const drawControl = new L.Control.Draw({
  position: "topleft",

  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: "#ff0000",
        weight: 3,
        opacity: 1,
        fillColor: "#ff0000",
        fillOpacity: 0.12,
        pane: "paneDibujo"
      }
    },

    polyline: false,
    rectangle: false,
    circle: false,
    circlemarker: false,
    marker: false
  },

  edit: {
    featureGroup: perimetrosDibujados,
    edit: true,
    remove: true
  }
});

map.addControl(drawControl);


// ===============================
// PANEL DE MEDICIÓN
// ===============================

const medicionControl = L.control({
  position: "bottomright"
});

medicionControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend measure-box");

  div.id = "panelMedicionPerimetro";

  div.innerHTML = `
    <div class="legend-title">Perímetro dibujado</div>
    <div>Dibuja un polígono para calcular superficie y perímetro.</div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

medicionControl.addTo(map);

function formatoSuperficie(m2) {
  const ha = m2 / 10000;
  const km2 = m2 / 1000000;

  if (ha >= 100) {
    return `${ha.toFixed(1)} ha · ${km2.toFixed(2)} km²`;
  }

  return `${ha.toFixed(2)} ha · ${m2.toFixed(0)} m²`;
}

function formatoPerimetro(km) {
  if (km >= 1) {
    return `${km.toFixed(2)} km`;
  }

  return `${(km * 1000).toFixed(0)} m`;
}

function calcularMedicion(layer) {
  const geojson = layer.toGeoJSON();

  const areaM2 = turf.area(geojson);
  const linea = turf.polygonToLine(geojson);
  const perimetroKm = turf.length(linea, {
    units: "kilometers"
  });

  return {
    areaM2,
    perimetroKm,
    geojson
  };
}

function actualizarPanelMedicion(layer) {
  const panel = document.getElementById("panelMedicionPerimetro");

  if (!panel) return;

  const medicion = calcularMedicion(layer);

  panel.innerHTML = `
    <div class="legend-title">Perímetro dibujado</div>

    <div class="legend-item">
      <strong>Superficie:</strong>&nbsp; ${formatoSuperficie(medicion.areaM2)}
    </div>

    <div class="legend-item">
      <strong>Perímetro:</strong>&nbsp; ${formatoPerimetro(medicion.perimetroKm)}
    </div>

    <div style="margin-top:8px;display:grid;gap:6px;">
      <button id="descargarPerimetroKml">Descargar KML</button>
      <button id="descargarPerimetroGeojson">Descargar GeoJSON</button>
    </div>

    <div class="measure-small">
      Cálculo automático orientativo sobre el polígono dibujado.
    </div>
  `;

  setTimeout(() => {
    const botonKml = document.getElementById("descargarPerimetroKml");
    const botonGeojson = document.getElementById("descargarPerimetroGeojson");

    if (botonKml) {
      botonKml.onclick = function () {
        descargarPerimetroKML(layer, medicion);
      };
    }

    if (botonGeojson) {
      botonGeojson.onclick = function () {
        descargarPerimetroGeoJSON(layer, medicion);
      };
    }
  }, 100);
}

function limpiarPanelMedicion() {
  const panel = document.getElementById("panelMedicionPerimetro");

  if (!panel) return;

  panel.innerHTML = `
    <div class="legend-title">Perímetro dibujado</div>
    <div>Dibuja un polígono para calcular superficie y perímetro.</div>
  `;
}


// ===============================
// EVENTOS DIBUJO
// ===============================

map.on(L.Draw.Event.CREATED, function (event) {
  const layer = event.layer;

  // Un único perímetro activo cada vez
  perimetrosDibujados.clearLayers();
  perimetrosDibujados.addLayer(layer);

  actualizarPanelMedicion(layer);

  const medicion = calcularMedicion(layer);

  layer.bindPopup(`
    <strong>Perímetro dibujado</strong><br>
    Superficie: ${formatoSuperficie(medicion.areaM2)}<br>
    Perímetro: ${formatoPerimetro(medicion.perimetroKm)}
  `).openPopup();
});

map.on(L.Draw.Event.EDITED, function (event) {
  event.layers.eachLayer(function (layer) {
    actualizarPanelMedicion(layer);

    const medicion = calcularMedicion(layer);

    layer.bindPopup(`
      <strong>Perímetro dibujado</strong><br>
      Superficie: ${formatoSuperficie(medicion.areaM2)}<br>
      Perímetro: ${formatoPerimetro(medicion.perimetroKm)}
    `);
  });
});

map.on(L.Draw.Event.DELETED, function () {
  limpiarPanelMedicion();
});


// ===============================
// EXPORTAR KML Y GEOJSON
// ===============================

function descargarTexto(nombreArchivo, contenido, mimeType) {
  const blob = new Blob([contenido], {
    type: mimeType
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function descargarPerimetroKML(layer, medicion) {
  const geojson = layer.toGeoJSON();

  if (!geojson.geometry || geojson.geometry.type !== "Polygon") {
    alert("Solo se puede exportar un polígono.");
    return;
  }

  const coords = geojson.geometry.coordinates[0];

  const coordText = coords.map(coord => {
    const lon = coord[0];
    const lat = coord[1];
    return `${lon},${lat},0`;
  }).join(" ");

  const fecha = new Date().toISOString();

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Perímetro dibujado MetVlc</name>

  <Style id="perimetroMetVlc">
    <LineStyle>
      <color>ff0000ff</color>
      <width>4</width>
    </LineStyle>
    <PolyStyle>
      <color>330000ff</color>
      <fill>1</fill>
      <outline>1</outline>
    </PolyStyle>
  </Style>

  <Placemark>
    <name>Perímetro dibujado</name>
    <description>
      Superficie: ${formatoSuperficie(medicion.areaM2)}
      Perímetro: ${formatoPerimetro(medicion.perimetroKm)}
      Fecha: ${fecha}
      Generado desde visor MetVlc.
    </description>
    <styleUrl>#perimetroMetVlc</styleUrl>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            ${coordText}
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
</Document>
</kml>`;

  descargarTexto(
    "perimetro_dibujado_metvlc.kml",
    kml,
    "application/vnd.google-earth.kml+xml"
  );
}

function descargarPerimetroGeoJSON(layer, medicion) {
  const geojson = layer.toGeoJSON();

  geojson.properties = {
    nombre: "Perímetro dibujado MetVlc",
    superficie_m2: Number(medicion.areaM2.toFixed(2)),
    superficie_ha: Number((medicion.areaM2 / 10000).toFixed(4)),
    perimetro_km: Number(medicion.perimetroKm.toFixed(4)),
    generado_utc: new Date().toISOString()
  };

  const featureCollection = {
    type: "FeatureCollection",
    features: [geojson]
  };

  descargarTexto(
    "perimetro_dibujado_metvlc.geojson",
    JSON.stringify(featureCollection, null, 2),
    "application/geo+json"
  );
}


// ===============================
// ARRANQUE
// ===============================

async function init() {
  setEstado("Inicializando visor...");

  await cargarLimiteCV();
  await cargarRasteres();

  activarControlesOpacidad();

  cargarHotspots(activePeriod);

  // Cargar manifest solo para mostrar fecha de actualización si existe
  try {
    const manifest = await fetchJson(HOTSPOTS_MANIFEST);

    if (manifest.actualizado_utc) {
      console.log("Manifest hotspots:", manifest);
    }
  } catch (error) {
    console.warn("No se pudo cargar manifest", error);
  }
}

init();
