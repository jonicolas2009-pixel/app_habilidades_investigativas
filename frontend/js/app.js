/* =====================================================================
   AIRE VISIBLE — interfaz (páginas, navegación y llamadas a la API)
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const fmt = C.fmt;

// ------------------------------------------------------------------ íconos
const I = {
  panorama: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  yo: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  semaforo: '<rect x="7" y="2" width="10" height="20" rx="5"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  reloj: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  campana: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  libro: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M8 7h8M8 11h6"/>',
  casa: '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  estudio: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  trabajo: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  ejercicio: '<circle cx="13" cy="4" r="2"/><path d="M4 22l4-7 4 3 2-5 4 3 2-3"/><path d="M8 15l2-5 4 1"/>',
  nube: '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  alerta: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  ojo: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  rayo: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
};
const ico = (n, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${I[n]}</svg>`;

// ------------------------------------------------------------------- API
const API = {
  modo: null,
  async iniciar() {
    if (location.protocol !== "file:") {
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
        const r = await fetch("api/info", { signal: ctl.signal });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) { this.modo = "servidor"; return r.json(); }
      } catch { /* sin servidor */ }
    }
    if (window.DEMO_DATA) { this.modo = "demo"; return window.DEMO_DATA.info; }
    throw new Error("No se encontró el servidor. Ejecute <code>uvicorn app.main:app</code> en la carpeta backend y abra http://localhost:8000");
  },
  async get(ruta, params = {}) {
    const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if (this.modo === "demo") return Demo.manejar("GET", ruta, p);
    const r = await fetch(ruta.slice(1) + (Object.keys(p).length ? "?" + new URLSearchParams(p) : ""));
    const j = await r.json(); if (!r.ok) throw new Error(j.detail || "Error del servidor"); return j;
  },
  async post(ruta, body = {}) {
    if (this.modo === "demo") return Demo.manejar("POST", ruta, body);
    const r = await fetch(ruta.slice(1), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Datos inválidos"); return j;
  },
};

const mem = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

let INFO = null;
const LOCS = () => INFO.localidades.map(l => l.nombre);
const opciones = (arr, sel) => arr.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${v}" ${String(v) === String(sel) ? "selected" : ""}>${t}</option>`; }).join("");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaLarga = iso => { const [y, m, d] = iso.split("-"); return `${+d} de ${["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][+m - 1]} de ${y}`; };
const cargando = el => el.innerHTML = '<div class="spinner"></div>';
const error = (el, e) => el.innerHTML = `<div class="alert-msg err">${e.message || e}</div>`;

// --------------------------------------------------------------- rutas
const PAGINAS = [
  { cap: "Ciudad" },
  { id: "panorama", t: "Panorama", i: "panorama", sub: "¿Dónde y cuándo se respira peor en Bogotá?", f: pPanorama },
  { id: "semaforo", t: "Semáforo del día", i: "semaforo", sub: "Promedio de 24 h comparado con la OMS y la norma", f: pSemaforo },
  { id: "calendario", t: "Calendario", i: "calendario", sub: "Cada día del año, en un color", f: pCalendario },
  { cap: "Personal" },
  { id: "mi-aire", t: "Mi aire", i: "yo", sub: "Tu exposición según tu rutina real", f: pMiAire },
  { id: "mejor-momento", t: "Mejor momento", i: "reloj", sub: "Las horas más limpias para salir o entrenar", f: pMejor },
  { id: "alertas", t: "Alertas y pronóstico", i: "campana", sub: "Aviso por Telegram antes de un día de aire malo", f: pAlertas },
  { cap: "Proyecto" },
  { id: "metodologia", t: "Metodología", i: "libro", sub: "Datos, cálculos y fuentes", f: pMetodologia },
];

function navegar() {
  const id = location.hash.slice(1) || "panorama";
  const p = PAGINAS.find(x => x.id === id) || PAGINAS[1];
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("active", a.dataset.id === p.id));
  $("#titulo").textContent = p.t; $("#crumb").textContent = p.sub;
  document.body.classList.remove("menu-open");
  const v = $("#vista"); v.innerHTML = ""; v.className = "content fade";
  void v.offsetWidth;
  p.f(v);
  scrollTo(0, 0);
}

async function iniciar() {
  C.initTip();
  $("#nav").innerHTML = PAGINAS.map(p => p.cap ? `<div class="nav-caption">${p.cap}</div>` :
    `<a href="#${p.id}" data-id="${p.id}">${ico(p.i)}<span>${p.t}</span></a>`).join("");
  try { INFO = await API.iniciar(); } catch (e) { $("#vista").innerHTML = `<div class="alert-msg err">${e.message}</div>`; return; }
  $("#modo").textContent = API.modo === "servidor" ? "Conectado al servidor" : "Modo demostración";
  const d = $("#datos");
  d.className = "chip dot " + (INFO.datos_simulados ? "warn" : "ok");
  d.textContent = INFO.datos_simulados ? "Datos simulados de prueba" : "Datos IDEAM";
  d.setAttribute("data-tip", INFO.datos_simulados
    ? "Estos datos imitan el formato del IDEAM para probar la app. Se reemplazan cargando el CSV real con scripts/cargar_datos_ideam.py"
    : "Datos del conjunto «Calidad del Aire en Colombia» (IDEAM, datos.gov.co)");
  $("#foot").innerHTML = `Datos: <b>${INFO.desde}</b> a <b>${INFO.hasta}</b><br>${INFO.estaciones.length} estaciones · ${INFO.localidades.length} localidades`;
  addEventListener("hashchange", navegar);
  navegar();
}

// =====================================================================
// PANORAMA
// =====================================================================
async function pPanorama(v) {
  cargando(v);
  try {
    const [r, est, loc, ten] = await Promise.all([API.get("/api/resumen"), API.get("/api/ranking/estaciones"), API.get("/api/ranking/localidades"), API.get("/api/tendencia")]);
    const aprobados = r.dias_verdes + r.dias_invisibles;
    const brecha = Math.round(10 * r.dias_invisibles / aprobados);
    v.innerHTML = `
    <div class="insight">
      <div class="big">${brecha} de 10</div>
      <div><h5>La brecha invisible</h5>
      <p>De cada 10 mediciones diarias que <b>cumplen la norma colombiana</b> (≤ 37 µg/m³), <b>${brecha}</b> no cumplen la guía de la OMS (≤ 15 µg/m³).
      Son días que la ley aprueba pero que la salud reprueba. Periodo analizado: ${fechaLarga(r.desde)} – ${fechaLarga(r.hasta)}.</p></div>
    </div>
    <div class="row">
      <div class="c-3 card stat g-yellow">${ico("ojo", 'class="ico"')}<h6>Días invisibles</h6>
        <div class="num">${r.dias_ciudad_invisibles}<small>/ ${r.dias_ciudad}</small></div>
        <p>días en que el promedio de Bogotá cumplió la norma pero superó la OMS</p>
        <div class="bar mt"><span style="width:${100 * r.dias_ciudad_invisibles / r.dias_ciudad}%"></span></div></div>
      <div class="c-3 card stat g-red">${ico("alerta", 'class="ico"')}<h6>Sobre la guía OMS</h6>
        <div class="num">${fmt(r.pct_sobre_oms)}<small>%</small></div>
        <p>de los ${fmt(r.dias_estacion, 0)} días-estación medidos superaron 15 µg/m³; ${r.dias_rojos} superaron la norma</p>
        <div class="bar mt"><span style="width:${r.pct_sobre_oms}%"></span></div></div>
      <div class="c-3 card stat g-purple">${ico("nube", 'class="ico"')}<h6>Promedio de la ciudad</h6>
        <div class="num">${fmt(r.promedio)}<small>µg/m³</small></div>
        <p><b>${fmt(r.veces_guia_oms)}×</b> la guía anual de la OMS (5 µg/m³)</p>
        <div class="bar mt"><span style="width:${Math.min(100, r.promedio / 25 * 100)}%"></span></div></div>
      <div class="c-3 card stat g-teal">${ico("pin", 'class="ico"')}<h6>Estación más crítica</h6>
        <div class="num" style="font-size:26px">${r.estacion_critica.nombre}</div>
        <p>${r.estacion_critica.localidad} · ${fmt(r.estacion_critica.promedio)} µg/m³ · ${fmt(r.estacion_critica.pct_sobre_oms)} % de días sobre OMS.
        La más limpia: ${r.estacion_limpia.nombre} (${fmt(r.estacion_limpia.promedio)}).</p></div>
    </div>
    <div class="row">
      <div class="c-7 card"><div class="card-header"><h5>Mapa de estaciones</h5><div class="sub">Tamaño y color = promedio de PM2.5 del último año. Pasa el cursor por cada estación.</div></div>
        <div class="card-body" id="mapa"></div></div>
      <div class="c-5 card"><div class="card-header"><h5>¿Cumple la ley o cumple la salud?</h5><div class="sub">Clasificación de todos los días-estación del último año</div></div>
        <div class="card-body"><div id="dona" style="max-width:280px;margin:0 auto"></div>
        <div class="legend mt" style="justify-content:center">
          <span><i style="background:${C.COL.verde}"></i>Cumple OMS: ${fmt(r.dias_verdes, 0)}</span>
          <span><i style="background:${C.COL.amarillo}"></i>Invisibles: ${fmt(r.dias_invisibles, 0)}</span>
          <span><i style="background:${C.COL.rojo}"></i>Sobre norma: ${fmt(r.dias_rojos, 0)}</span></div>
        <div class="alert-msg mt small">El <b>peor día</b> del periodo fue el <b>${fechaLarga(r.peor_dia.fecha)}</b>, con un promedio de ciudad de <b>${fmt(r.peor_dia.promedio)} µg/m³</b>.</div>
        </div></div>
    </div>
    <div class="row">
      <div class="c-12 card"><div class="card-header"><h5>Tendencia mensual</h5><div class="tools"><select class="input sm" id="tenLoc"><option value="">Toda Bogotá</option>${opciones(LOCS())}</select></div>
        <div class="sub">Promedio mensual de PM2.5 frente a la guía OMS y la norma nacional (24 h)</div></div>
        <div class="card-body" id="tend"></div></div>
    </div>
    <div class="row mb0">
      <div class="c-12 card"><div class="card-header"><h5>Ranking por localidad</h5><div class="sub">Días del último año según el semáforo · ordenado por promedio</div>
        <div class="tools legend"><span><i style="background:${C.COL.verde}"></i>Verde</span><span><i style="background:${C.COL.amarillo}"></i>Invisible</span><span><i style="background:${C.COL.rojo}"></i>Rojo</span></div></div>
        <div class="card-body tight" style="overflow-x:auto"><table class="rank"><thead><tr><th>#</th><th>Localidad</th><th>Zona</th><th style="width:45%">Distribución de días</th><th style="text-align:right">Promedio</th><th style="text-align:right">% sobre OMS</th></tr></thead><tbody>
        ${loc.map((l, i) => `<tr><td class="muted">${i + 1}</td><td><b style="color:#111">${l.localidad}</b></td><td class="muted">${l.zona}</td>
          <td><div class="stack" data-tip="<b>${l.localidad}</b><br>Verdes: ${l.verdes}<br>Invisibles: ${l.invisibles}<br>Rojos: ${l.rojos}">
          <span style="width:${100 * l.verdes / l.dias}%;background:${C.COL.verde}"></span><span style="width:${100 * l.invisibles / l.dias}%;background:${C.COL.amarillo}"></span><span style="width:${100 * l.rojos / l.dias}%;background:${C.COL.rojo}"></span></div></td>
          <td class="n">${fmt(l.promedio)} <span class="muted small">µg/m³</span></td><td class="n" style="color:${l.pct_sobre_oms > 66 ? C.COL.rojo : l.pct_sobre_oms > 33 ? "#c5960a" : "#11a985"}">${fmt(l.pct_sobre_oms)} %</td></tr>`).join("")}
        </tbody></table></div></div>
    </div>`;
    C.mapa($("#mapa"), est);
    C.donut($("#dona"), [{ label: "Cumple OMS", value: r.dias_verdes, color: C.COL.verde }, { label: "Días invisibles", value: r.dias_invisibles, color: C.COL.amarillo }, { label: "Sobre norma", value: r.dias_rojos, color: C.COL.rojo }],
      `${fmt(r.pct_invisibles, 0)}%`, "días invisibles");
    const dibujaTend = t => C.line($("#tend"), {
      labels: t.map(x => x.mes), series: [{ name: "Promedio", color: C.COL.turquesa, values: t.map(x => x.promedio), area: true }],
      refs: [{ v: 15, label: "OMS 15", color: "#11a985" }, { v: 37, label: "Norma 37", color: C.COL.rojo }],
      fmtX: (m, i, largo) => { const [y, mm] = m.split("-"); return largo ? `${MESES[+mm - 1]} ${y}` : (+mm === 1 || i === 0 ? `${MESES[+mm - 1]} ${y.slice(2)}` : MESES[+mm - 1]); }, every: 2 });
    dibujaTend(ten);
    $("#tenLoc").onchange = async e => dibujaTend(await API.get("/api/tendencia", { localidad: e.target.value }));
  } catch (e) { error(v, e); }
}

// =====================================================================
// SEMÁFORO DEL DÍA
// =====================================================================
function pSemaforo(v) {
  const demo = API.modo === "demo";
  const min = demo ? window.DEMO_DATA.horario_desde : INFO.desde;
  const st = mem.get("av_sem", { tipo: "localidad", lugar: "Kennedy", fecha: INFO.hasta, perfil: "general" });
  if (demo) st.tipo = "localidad";
  v.innerHTML = `
  <div class="row"><div class="c-12 card"><div class="card-body">
    <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));align-items:end">
      <div><label class="f">Consultar por</label><div class="seg" id="tipo"><button data-v="localidad">Localidad</button>${demo ? "" : '<button data-v="estacion">Estación</button>'}</div></div>
      <div><label class="f">Lugar</label><select class="input" id="lugar"></select></div>
      <div><label class="f">Fecha</label><input class="input" type="date" id="fecha" min="${min}" max="${INFO.hasta}" value="${st.fecha < min ? INFO.hasta : st.fecha}"></div>
      <div><label class="f">Perfil</label><select class="input" id="perfil">${opciones(Object.entries(INFO.perfiles), st.perfil)}</select></div>
      <div><button class="btn block" id="ver">${ico("semaforo", 'width="16" height="16"')} Ver semáforo</button></div>
    </div>${demo ? `<p class="small muted mt mb0">En la demostración se puede consultar desde el ${min}. Con el servidor se consulta todo el histórico y también por estación.</p>` : ""}
  </div></div></div>
  <div id="res"></div>`;
  const llenarLugar = () => {
    $("#lugar").innerHTML = st.tipo === "estacion" ? opciones(INFO.estaciones.map(e => [e.estacion_id, `${e.nombre} (${e.localidad})`]), st.lugar) : opciones(LOCS(), st.lugar);
    $("#tipo").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === st.tipo));
  };
  $("#tipo").onclick = e => { if (!e.target.dataset.v) return; st.tipo = e.target.dataset.v; st.lugar = st.tipo === "estacion" ? 15 : "Kennedy"; llenarLugar(); };
  llenarLugar();
  const ver = async () => {
    Object.assign(st, { lugar: $("#lugar").value, fecha: $("#fecha").value, perfil: $("#perfil").value }); mem.set("av_sem", st);
    const res = $("#res"); cargando(res);
    try {
      const d = await API.get("/api/semaforo", { fecha: st.fecha, perfil: st.perfil, ...(st.tipo === "estacion" ? { estacion_id: st.lugar } : { localidad: st.lugar }) });
      const s = d.semaforo;
      res.innerHTML = `<div class="row fade">
        <div class="c-5 card"><div class="card-header"><h5>${d.lugar}</h5><div class="sub">${d.dia_semana}, ${fechaLarga(d.fecha)}</div></div>
          <div class="card-body"><div class="semaforo-wrap">
            <div class="traffic">${["rojo", "amarillo", "verde"].map(c => `<i class="${c} ${s.color === c ? "on" : ""}"></i>`).join("")}</div>
            <div class="lectura" style="flex:1;min-width:200px"><div class="valor">${fmt(d.promedio_24h)}<small> µg/m³</small></div>
              <span class="etq ${s.color}">${s.etiqueta}</span><p style="margin:0;line-height:1.55">${s.mensaje}</p></div>
          </div><div id="regla" class="mt"></div></div></div>
        <div class="c-7 card"><div class="card-header"><h5>Hora por hora</h5><div class="sub">Concentración horaria · líneas: OMS (15) y norma (37)</div></div>
          <div class="card-body">${d.horas.length ? '<div id="horas"></div>' : '<div class="empty">No hay mediciones para este día.</div>'}
          <div class="facts">
            <div class="fact"><b>${d.horas_validas}/24</b><span>horas válidas (mín. ${d.horas_minimas})</span></div>
            <div class="fact"><b>${d.veces_oms ? fmt(d.veces_oms, 2) + "×" : "—"}</b><span>la guía OMS</span></div>
            <div class="fact"><b>${d.pct_de_norma != null ? d.pct_de_norma + " %" : "—"}</b><span>del límite legal</span></div>
            <div class="fact"><b>${d.hora_pico ? d.hora_pico.hora + ":00" : "—"}</b><span>hora pico (${d.hora_pico ? fmt(d.hora_pico.valor) : "—"})</span></div>
            <div class="fact"><b>${d.hora_limpia ? d.hora_limpia.hora + ":00" : "—"}</b><span>hora más limpia (${d.hora_limpia ? fmt(d.hora_limpia.valor) : "—"})</span></div>
          </div></div></div></div>`;
      C.regla($("#regla"), d.promedio_24h);
      if (d.horas.length) C.barrasHora($("#horas"), d.horas);
    } catch (e) { error(res, e); }
  };
  $("#ver").onclick = ver; ver();
}

// =====================================================================
// CALENDARIO
// =====================================================================
function pCalendario(v) {
  const anios = []; for (let y = +INFO.hasta.slice(0, 4); y >= +INFO.desde.slice(0, 4); y--) anios.push(y);
  const st = mem.get("av_cal", { lugar: "Kennedy", anio: anios[1] || anios[0] });
  v.innerHTML = `<div class="row mb0"><div class="c-12 card">
    <div class="card-header"><h5>Calendario del semáforo</h5><div class="tools">
      <select class="input sm" id="cl">${opciones(LOCS(), st.lugar)}</select><select class="input sm" id="ca">${opciones(anios, st.anio)}</select></div>
      <div class="sub">Cada cuadro es un día: verde cumple la OMS, amarillo es un día invisible y rojo supera la norma.</div></div>
    <div class="card-body"><div id="cal" style="overflow-x:auto"></div><div id="calres"></div></div></div></div>`;
  const ver = async () => {
    st.lugar = $("#cl").value; st.anio = +$("#ca").value; mem.set("av_cal", st);
    try {
      const d = await API.get("/api/calendario", { anio: st.anio, localidad: st.lugar });
      C.calendario($("#cal"), d.dias, d.anio);
      const c = d.conteo, tot = (c.verde || 0) + (c.amarillo || 0) + (c.rojo || 0);
      $("#calres").innerHTML = `<div class="facts">
        <div class="fact" style="border-left:4px solid ${C.COL.verde}"><b>${c.verde || 0}</b><span>días que cumplen la OMS</span></div>
        <div class="fact" style="border-left:4px solid ${C.COL.amarillo}"><b>${c.amarillo || 0}</b><span>días invisibles</span></div>
        <div class="fact" style="border-left:4px solid ${C.COL.rojo}"><b>${c.rojo || 0}</b><span>días sobre la norma</span></div>
        <div class="fact"><b>${d.racha_max_sin_aire_oms}</b><span>días seguidos sin aire OMS (racha máxima)</span></div>
        <div class="fact"><b>${tot ? fmt(100 * (c.verde || 0) / tot, 0) : 0} %</b><span>del año con aire saludable</span></div></div>`;
    } catch (e) { error($("#cal"), e); }
  };
  $("#cl").onchange = ver; $("#ca").onchange = ver; ver();
}

// =====================================================================
// MI AIRE (exposición personal)
// =====================================================================
const TIPOS = [["estudio", "Estudio"], ["trabajo", "Trabajo"], ["ejercicio", "Ejercicio"]];
const DIAS_C = ["L", "M", "X", "J", "V", "S", "D"];
function pMiAire(v) {
  const p = mem.get("av_perfil", { alias: "", casa: "Kennedy", perfil: "general", actividad: "correr",
    rutina: [{ localidad: "Chapinero", tipo: "estudio", hora_inicio: 7, hora_fin: 13, dias: "01234" }, { localidad: "Kennedy", tipo: "ejercicio", hora_inicio: 18, hora_fin: 19, dias: "024" }] });
  v.innerHTML = `<div class="row mb0">
    <div class="c-5"><div class="card"><div class="card-header"><h5>Tu rutina</h5><div class="sub">Dinos dónde pasas el día y calculamos el aire que realmente respiras</div></div>
      <div class="card-body"><div class="form-grid">
        <div><label class="f">Tu nombre o alias</label><input class="input" id="alias" value="${p.alias}" placeholder="Ej.: Juan"></div>
        <div><label class="f">Vives en</label><select class="input" id="casa">${opciones(LOCS(), p.casa)}</select></div>
        <div><label class="f">Perfil de salud</label><select class="input" id="perfil">${opciones(Object.entries(INFO.perfiles), p.perfil)}</select></div>
        <div><label class="f">Actividad física</label><select class="input" id="act">${opciones([["caminar", "Caminar"], ["bici", "Bicicleta"], ["correr", "Correr"]], p.actividad)}</select></div>
        <div class="full"><label class="f">Fuera de casa</label><div id="bloques"></div>
          <button class="btn ghost" id="add" type="button">+ Agregar lugar</button></div>
        <div class="full"><button class="btn block" id="calc">${ico("rayo", 'width="16" height="16"')} Calcular mi exposición</button></div>
      </div></div></div></div>
    <div class="c-7" id="res"><div class="card"><div class="empty">${ico("yo")}<p>Completa tu rutina y presiona <b>Calcular</b>.<br>Verás cuánto PM2.5 respiras tú, no solo tu barrio.</p></div></div></div>
  </div>`;
  const pintarBloques = () => {
    $("#bloques").innerHTML = p.rutina.map((b, i) => `<div class="bloque" data-i="${i}">
      <div><label class="f">Lugar</label><select class="input" data-k="localidad">${opciones(LOCS(), b.localidad)}</select></div>
      <div><label class="f">Para</label><select class="input" data-k="tipo">${opciones(TIPOS, b.tipo)}</select></div>
      <button class="x" title="Quitar" data-del="${i}">×</button>
      <div><label class="f">Desde</label><select class="input" data-k="hora_inicio">${opciones([...Array(24).keys()].map(h => [h, h + ":00"]), b.hora_inicio)}</select></div>
      <div><label class="f">Hasta</label><select class="input" data-k="hora_fin">${opciones([...Array(24).keys()].map(h => [h + 1, (h + 1) + ":00"]), b.hora_fin)}</select></div><div></div>
      <div class="dias" style="align-items:center"><span class="small muted" style="margin-right:4px">Días:</span>${DIAS_C.map((d, k) => `<button type="button" data-dia="${k}" class="${b.dias.includes(k) ? "on" : ""}">${d}</button>`).join("")}</div></div>`).join("");
  };
  pintarBloques();
  $("#bloques").addEventListener("change", e => { const i = e.target.closest(".bloque").dataset.i, k = e.target.dataset.k; p.rutina[i][k] = k.startsWith("hora") ? +e.target.value : e.target.value; });
  $("#bloques").addEventListener("click", e => {
    if (e.target.dataset.del) { p.rutina.splice(+e.target.dataset.del, 1); pintarBloques(); }
    if (e.target.dataset.dia) { const b = p.rutina[e.target.closest(".bloque").dataset.i], k = e.target.dataset.dia;
      b.dias = b.dias.includes(k) ? b.dias.replace(k, "") : [...b.dias + k].sort().join(""); e.target.classList.toggle("on"); }
  });
  $("#add").onclick = () => { p.rutina.push({ localidad: LOCS()[0], tipo: "trabajo", hora_inicio: 8, hora_fin: 17, dias: "01234" }); pintarBloques(); };
  $("#calc").onclick = async () => {
    Object.assign(p, { alias: $("#alias").value.trim(), casa: $("#casa").value, perfil: $("#perfil").value, actividad: $("#act").value });
    const malos = p.rutina.filter(b => b.hora_fin <= b.hora_inicio);
    if (malos.length) { error($("#res"), "Revisa los horarios: la hora final debe ser mayor que la inicial."); return; }
    mem.set("av_perfil", p);
    const res = $("#res"), btn = $("#calc"); btn.disabled = true; cargando(res);
    try {
      const body = { casa: p.casa, rutina: p.rutina, perfil: p.perfil, actividad: p.actividad };
      const [e] = await Promise.all([API.post("/api/exposicion", body),
        p.alias && !mem.get("av_uid") ? API.post("/api/usuarios", { ...body, alias: p.alias }).then(u => mem.set("av_uid", u.usuario_id)).catch(() => {}) : null]);
      pintarExposicion(res, e, p);
    } catch (err) { error(res, err); }
    btn.disabled = false;
  };
  if (mem.get("av_calculado")) $("#calc").click();
}

function pintarExposicion(res, e, p) {
  mem.set("av_calculado", true);
  const nombre = p.alias ? p.alias.split(" ")[0] : "Tú";
  const colorTipo = { casa: "var(--g-purple)", estudio: "var(--g-blue)", trabajo: "var(--g-blue)", ejercicio: "var(--g-teal)" };
  const compar = [["Tú", e.promedio_personal, C.COL.turquesa], ["Si nunca salieras de casa", e.promedio_solo_casa, C.COL.morado], ["Promedio de Bogotá", e.promedio_ciudad, "#c3cbd6"],
    ["Norma anual Colombia", 25, C.COL.rojo], ["Guía anual OMS", 5, C.COL.verde]];
  const maxC = Math.max(...compar.map(c => c[1])) * 1.1;
  res.innerHTML = `<div class="fade">
    <div class="row" style="gap:20px;margin-bottom:20px">
      <div class="c-6 card stat g-teal">${ico("yo", 'class="ico"')}<h6>${nombre}, tu aire en un año</h6>
        <div class="num">${fmt(e.promedio_personal)}<small>µg/m³</small></div>
        <p><b>${fmt(e.veces_guia_anual_oms)}×</b> la guía anual de la OMS · ${e.supera_norma_anual ? "supera" : "cumple"} la norma anual colombiana (25)</p></div>
      <div class="c-6 card stat g-red">${ico("alerta", 'class="ico"')}<h6>Equivale a fumar</h6>
        <div class="num">${e.cigarrillos_anio}<small>cigarrillos/año</small></div>
        <p>≈ ${fmt(e.cigarrillos_dia, 2)} al día (aproximación divulgativa de Berkeley Earth: 22 µg/m³ ≈ 1 cigarrillo diario)</p>
        <div class="cigs">${"<i></i>".repeat(Math.min(60, Math.round(e.cigarrillos_anio / 10)))}</div></div>
    </div>
    <div class="row" style="gap:20px;margin-bottom:20px">
      <div class="c-4 card"><div class="card-body center"><div style="font-size:34px;color:var(--amarillo-txt);font-weight:300">${e.dias_invisibles}</div><div class="small">días invisibles que viviste</div></div></div>
      <div class="c-4 card"><div class="card-body center"><div style="font-size:34px;color:${C.COL.rojo};font-weight:300">${e.dias_rojos}</div><div class="small">días sobre la norma</div></div></div>
      <div class="c-4 card"><div class="card-body center"><div style="font-size:34px;color:var(--verde-txt);font-weight:300">${e.dias_verdes}</div><div class="small">días con aire OMS</div></div></div>
    </div>
    ${e.sugerencia ? `<div class="card stat g-purple" style="min-height:0;margin-bottom:20px">${ico("reloj", 'class="ico"')}<h6>Cambio fácil, gran efecto</h6>
      <p style="font-size:14.5px;margin-top:10px">Si entrenas a las <b>${e.sugerencia.hora_sugerida}:00</b> en lugar de las <b>${e.sugerencia.hora_actual}:00</b> en ${e.sugerencia.localidad},
      respirarías <b>${e.sugerencia.reduccion_pct} % menos PM2.5</b> durante el ejercicio (${fmt(e.sugerencia.valor_sugerido)} vs. ${fmt(e.sugerencia.valor_actual)} µg/m³ en promedio).
      Hoy el ejercicio aporta el ${fmt(e.pct_dosis_ejercicio)} % del aire contaminado que inhalas, aunque dura solo ${fmt(e.horas_ejercicio_dia)} h/día en promedio.</p></div>` : ""}
    <div class="card" style="margin-bottom:20px"><div class="card-header"><h5>Comparación</h5><div class="sub">Promedio anual de PM2.5 (µg/m³)</div></div>
      <div class="card-body tight">${compar.map(([t, val, col]) => `<div style="display:flex;align-items:center;gap:12px;margin:10px 0">
        <div style="width:190px;font-size:13px">${t}</div><div style="flex:1;background:#f4f7fa;border-radius:4px;height:14px"><div style="width:${100 * val / maxC}%;height:100%;background:${col};border-radius:4px"></div></div>
        <b style="width:44px;text-align:right;color:#111">${fmt(val)}</b></div>`).join("")}</div></div>
    <div class="row" style="gap:20px;margin-bottom:20px">
      <div class="c-6 card"><div class="card-header"><h5>Dónde respiras</h5></div><div class="card-body tight">
        ${e.lugares.map(l => `<div class="lugar"><div class="ic" style="background:${colorTipo[l.tipo]}">${ico(l.tipo)}</div>
          <div class="t"><b>${l.tipo[0].toUpperCase() + l.tipo.slice(1)} · ${l.localidad}</b><span class="small">${fmt(l.horas_dia)} h al día</span></div>
          <div class="v" style="color:${C.colorSem(l.promedio) === C.COL.verde ? "#11a985" : C.colorSem(l.promedio) === C.COL.amarillo ? "#c5960a" : C.COL.rojo}">${fmt(l.promedio)}<div class="small muted">µg/m³</div></div></div>`).join("")}</div></div>
      <div class="c-6 card"><div class="card-header"><h5>Recomendación para tu perfil</h5><div class="sub">${e.perfil}</div></div>
        <div class="card-body"><p style="margin:0 0 12px;line-height:1.6">${e.consejo}</p>
        <p class="small muted" style="margin:0;line-height:1.5">Dosis estimada: ~${fmt(e.dosis_diaria_ug, 0)} µg de PM2.5 inhalados al día (aire respirado según actividad, valores de referencia aproximados).
        Analizados ${e.dias_analizados} días: ${e.desde} a ${e.hasta}.</p></div></div>
    </div>
    <div class="card"><div class="card-header"><h5>Tu año, día por día</h5><div class="sub">Promedio diario de lo que respiraste según tu rutina</div></div>
      <div class="card-body" id="serie"></div></div></div>`;
  C.line($("#serie"), { labels: e.serie.map(s => s.fecha), series: [{ name: "Tu aire", color: C.COL.turquesa, values: e.serie.map(s => s.valor), area: true, width: 1.6 }],
    refs: [{ v: 15, label: "OMS 15", color: "#11a985" }, { v: 37, label: "Norma 37", color: C.COL.rojo }], height: 240,
    fmtX: (f, i, largo) => largo ? f : (f.slice(8) === "01" || i === 0 ? MESES[+f.slice(5, 7) - 1] : ""), every: 1 });
}

// =====================================================================
// MEJOR MOMENTO
// =====================================================================
function pMejor(v) {
  const st = mem.get("av_mm", { lugar: mem.get("av_perfil", {}).casa || "Kennedy" });
  v.innerHTML = `<div class="row"><div class="c-12 card"><div class="card-header"><h5>¿A qué hora conviene salir?</h5>
      <div class="tools"><select class="input sm" id="ml">${opciones(LOCS(), st.lugar)}</select></div>
      <div class="sub">Promedio histórico del último año por día de la semana y hora. Los recuadros marcados son las mejores horas entre 5:00 y 21:00.</div></div>
      <div class="card-body" style="overflow-x:auto"><div id="heat" style="min-width:640px"></div>
      <div class="legend mt"><span><i style="background:${C.escala(8)}"></i>≤ 15 cumple OMS</span><span><i style="background:${C.escala(26)}"></i>15–37 invisible</span><span><i style="background:${C.escala(45)}"></i>> 37 sobre norma</span></div></div></div></div>
    <div class="row mb0" id="mres"></div>`;
  const ver = async () => {
    st.lugar = $("#ml").value; mem.set("av_mm", st);
    try {
      const d = await API.get("/api/mejor-momento", { localidad: st.lugar });
      C.heat($("#heat"), d.matriz, d.dias, d.mejores);
      const lista = (arr, col) => arr.map((m, i) => `<div class="lugar"><div class="ic" style="background:${col}"><b style="font-size:14px">${i + 1}</b></div>
        <div class="t"><b>${m.dia}, ${m.hora}:00 – ${m.hora + 1}:00</b></div><div class="v">${fmt(m.valor)} <span class="small muted">µg/m³</span></div></div>`).join("");
      $("#mres").innerHTML = `
        <div class="c-4 card"><div class="card-header"><h5>Mejores horas</h5></div><div class="card-body tight">${lista(d.mejores, "var(--g-teal)")}</div></div>
        <div class="c-4 card"><div class="card-header"><h5>Horas a evitar</h5></div><div class="card-body tight">${lista(d.peores, "var(--g-red)")}</div></div>
        <div class="c-4 card stat g-purple">${ico("reloj", 'class="ico"')}<h6>Diferencia</h6><div class="num">${d.reduccion_pct}<small>% menos</small></div>
          <p>de PM2.5 al salir en la mejor hora en vez de la peor en ${d.localidad}. Elegir la hora pesa tanto como elegir el lugar.</p></div>`;
    } catch (e) { error($("#heat"), e); }
  };
  $("#ml").onchange = ver; ver();
}

// =====================================================================
// ALERTAS Y PRONÓSTICO
// =====================================================================
function pAlertas(v) {
  const st = mem.get("av_al", { lugar: mem.get("av_perfil", {}).casa || "Kennedy" });
  const uid = mem.get("av_uid");
  v.innerHTML = `<div class="row"><div class="c-12 card"><div class="card-header"><h5>Pronóstico de PM2.5</h5>
      <div class="tools"><select class="input sm" id="pl">${opciones(LOCS(), st.lugar)}</select></div>
      <div class="sub">Modelo CAMS de Copernicus vía Open-Meteo (gratuito). Es un modelo global, por eso el proyecto lo valida contra lo medido por el IDEAM.</div></div>
      <div class="card-body" id="pron"></div></div></div>
    <div class="row mb0">
      <div class="c-6 card"><div class="card-header"><h5>Recibe alertas por Telegram</h5></div><div class="card-body">
        <ol class="steps">
          <li>En Telegram, crea un bot con <b>@BotFather</b> y copia el token en la variable <code>TELEGRAM_TOKEN</code> del servidor.</li>
          <li>Escríbele al bot y obtén tu <b>chat id</b> (por ejemplo, con @userinfobot).</li>
          <li>Crea tu perfil en <a href="#mi-aire">Mi aire</a> con tu chat id. Cada tarde el servidor revisa el pronóstico de mañana para tus localidades.</li>
          <li>Si viene un día invisible o rojo, te llega un mensaje como este:</li></ol>
        <pre class="tg">🌫️ Aire Visible · Kennedy, mañana
Pronóstico PM2.5: 31.4 µg/m³ (2.1× la guía OMS).
Día invisible: la norma colombiana dice que está bien, pero supera la guía de la OMS.
Horas más limpias: 14:00, 15:00</pre>
        <div class="form-grid mt"><div><label class="f">Tu chat id de Telegram</label><input class="input" id="chat" placeholder="123456789"></div>
          <div style="align-self:end"><button class="btn purple block" id="guardarChat">Guardar y activar</button></div></div>
        <div id="chatMsg" class="mt"></div>
      </div></div>
      <div class="c-6"><div class="card" style="margin-bottom:30px"><div class="card-header"><h5>Revisión automática</h5></div><div class="card-body">
          <p style="margin-top:0;line-height:1.55">El servidor ejecuta <code>python -m app.alertas</code> una vez al día (cron o Programador de tareas). También puedes lanzarlo ahora:</p>
          <button class="btn" id="ejec">${ico("rayo", 'width="16" height="16"')} Ejecutar revisión ahora</button><div id="ejecMsg" class="mt"></div></div></div>
        <div class="card"><div class="card-header"><h5>¿Qué tan confiable es el pronóstico?</h5><div class="sub">Pronóstico guardado vs. promedio medido (Etapa 5)</div></div>
          <div class="card-body" id="valid"></div></div></div>
    </div>`;
  const ver = async () => {
    st.lugar = $("#pl").value; mem.set("av_al", st);
    const el = $("#pron"); cargando(el);
    try {
      const d = await API.get("/api/pronostico", { localidad: st.lugar });
      const g = { verde: "var(--g-teal)", amarillo: "var(--g-yellow)", rojo: "var(--g-red)", gris: "#ccc" };
      el.innerHTML = `<div class="forecast">${d.dias.map((x, i) => `<div class="fday" style="background:${g[x.semaforo.color]}">
          <h6>${i === 0 ? "Hoy" : i === 1 ? "Mañana" : fechaLarga(x.fecha).split(" de 20")[0]}</h6><b>${fmt(x.pm25_promedio)}</b><span class="small">µg/m³ · ${x.semaforo.etiqueta}</span></div>`).join("")}</div>
        <div id="pronH" class="mt"></div>`;
      const horas = d.dias.flatMap(x => x.horas.map(h => ({ ...h, fecha: x.fecha })));
      C.line($("#pronH"), { labels: horas.map(h => `${h.fecha} ${h.hora}:00`), series: [{ name: "Pronóstico", color: C.COL.morado, values: horas.map(h => h.valor), area: true, width: 2 }],
        refs: [{ v: 15, label: "OMS 15", color: "#11a985" }, { v: 37, label: "Norma 37", color: C.COL.rojo }], height: 220,
        fmtX: (l, i, largo) => largo ? l : (l.endsWith(" 0:00") ? l.slice(5, 10) : l.endsWith(" 12:00") ? "12h" : ""), every: 1 });
    } catch (e) {
      el.innerHTML = `<div class="alert-msg">No se pudo descargar el pronóstico ahora (${e.message}). ${API.modo === "demo" ? "En la demostración el navegador consulta Open-Meteo directamente y algunos entornos lo bloquean; con el servidor funciona normalmente." : "Revise la conexión a internet del servidor."}</div>`;
    }
  };
  $("#pl").onchange = ver; ver();
  $("#guardarChat").onclick = async () => {
    const p = mem.get("av_perfil", null), chat = $("#chat").value.trim(), msg = $("#chatMsg");
    if (!p) { msg.innerHTML = `<div class="alert-msg">Primero crea tu rutina en <a href="#mi-aire">Mi aire</a>.</div>`; return; }
    if (!/^-?\d{5,}$/.test(chat)) { msg.innerHTML = `<div class="alert-msg err">El chat id son solo números.</div>`; return; }
    try {
      const u = await API.post("/api/usuarios", { alias: p.alias || "Usuario", casa: p.casa, rutina: p.rutina, perfil: p.perfil, actividad: p.actividad, telegram_chat_id: chat });
      mem.set("av_uid", u.usuario_id);
      msg.innerHTML = `<div class="alert-msg ok">Listo. Recibirás alertas para ${[p.casa, ...p.rutina.map(b => b.localidad)].filter((x, i, a) => a.indexOf(x) === i).join(", ")}.</div>`;
    } catch (e) { error(msg, e); }
  };
  $("#ejec").onclick = async () => {
    const m = $("#ejecMsg"); cargando(m);
    try { const r = await API.post("/api/alertas/ejecutar"); m.innerHTML = `<div class="alert-msg ok">Usuarios revisados: ${r.usuarios_revisados} · alertas creadas: ${r.alertas_creadas} · enviadas por Telegram: ${r.enviadas_telegram}</div>`; }
    catch (e) { error(m, e); }
  };
  API.get("/api/validacion-pronostico").then(r => {
    $("#valid").innerHTML = r.n ? `<div class="facts" style="margin:0"><div class="fact"><b>${r.n}</b><span>días comparados</span></div>
      <div class="fact"><b>${fmt(r.error_medio_absoluto)}</b><span>error medio (µg/m³)</span></div><div class="fact"><b>${r.sesgo > 0 ? "+" : ""}${fmt(r.sesgo)}</b><span>sesgo</span></div>
      <div class="fact"><b>${fmt(r.acierto_semaforo_pct)} %</b><span>acierto del color</span></div></div>` : `<p class="muted" style="margin:0;line-height:1.55">${r.mensaje}</p>`;
  }).catch(e => error($("#valid"), e));
  void uid;
}

// =====================================================================
// METODOLOGÍA
// =====================================================================
async function pMetodologia(v) {
  let stats = { por_tipo: {}, semaforo: {}, usuarios: 0 };
  try { stats = await API.get("/api/estadisticas"); } catch { /* opcional */ }
  v.innerHTML = `
  <div class="row"><div class="c-12 card"><div class="card-header"><h5>Cómo funciona</h5></div><div class="card-body"><div class="flow">
    <div class="paso"><span class="k">ETAPA 1</span><b>Recolección</b>CSV del IDEAM (datos.gov.co) filtrado por Bogotá, PM2.5 y 3 años.</div>
    <div class="paso"><span class="k">ETAPA 2</span><b>Limpieza</b>Sin vacíos, negativos ni duplicados. Estación → localidad. Promedio diario solo con ≥ ${INFO.horas_minimas} h.</div>
    <div class="paso"><span class="k">ETAPA 3</span><b>Base de datos</b>SQL con 12 tablas: localidad, estación, medición, límites, usuario, rutina, consulta, pronóstico…</div>
    <div class="paso"><span class="k">ETAPA 4</span><b>Servidor + app</b>API REST (FastAPI) con los cálculos, este panel web y alertas por Telegram.</div>
    <div class="paso"><span class="k">ETAPA 5</span><b>Validación</b>Pruebas de cálculo a mano, pruebas con usuarios y validación del pronóstico.</div>
  </div></div></div></div>
  <div class="row">
    <div class="c-6 card"><div class="card-header"><h5>El semáforo</h5></div><div class="card-body"><table class="rank">
      <tr><td><span class="etq verde">Verde</span></td><td>≤ ${INFO.oms_24h} µg/m³</td><td>Cumple la guía de la OMS (2021)</td></tr>
      <tr><td><span class="etq amarillo">Invisible</span></td><td>${INFO.oms_24h}–${INFO.norma_24h} µg/m³</td><td>Cumple la Resolución 2254/2017, pero no la OMS</td></tr>
      <tr><td><span class="etq rojo">Rojo</span></td><td>&gt; ${INFO.norma_24h} µg/m³</td><td>Supera también la norma nacional</td></tr></table>
      <p class="small muted" style="line-height:1.55">Los umbrales se aplican al promedio de 24 horas. Para la exposición anual se compara con la guía anual OMS (5 µg/m³) y la norma anual colombiana (25 µg/m³).</p></div></div>
    <div class="c-6 card"><div class="card-header"><h5>Uso de la app</h5><div class="sub">Registrado en la tabla consulta_usuario</div></div><div class="card-body"><div class="facts" style="margin:0">
      <div class="fact"><b>${stats.por_tipo.semaforo || 0}</b><span>consultas de semáforo</span></div>
      <div class="fact"><b>${stats.por_tipo.exposicion || 0}</b><span>cálculos de exposición</span></div>
      <div class="fact"><b>${stats.usuarios}</b><span>usuarios registrados</span></div>
      <div class="fact"><b>${stats.semaforo.amarillo || 0}</b><span>consultas que dieron "invisible"</span></div></div></div></div>
  </div>
  <div class="row mb0"><div class="c-12 card"><div class="card-header"><h5>Fuentes y avisos</h5></div><div class="card-body" style="line-height:1.65">
    ${INFO.datos_simulados ? `<div class="alert-msg" style="margin-bottom:16px"><b>Datos simulados.</b> La versión actual usa un archivo de prueba con el mismo formato del IDEAM para validar el funcionamiento. Las cifras no son resultados reales; se reemplazan cargando el CSV oficial con <code>python scripts/cargar_datos_ideam.py archivo.csv</code>.</div>` : ""}
    <b>Datos:</b> IDEAM, «Calidad del Aire en Colombia», Portal Nacional de Datos Abiertos (g4t8-zkc3).<br>
    <b>Umbrales:</b> OMS (2021), Directrices mundiales de calidad del aire · MinAmbiente, Resolución 2254 de 2017.<br>
    <b>Pronóstico:</b> Open-Meteo Air Quality API (modelo CAMS, Copernicus).<br>
    <b>Equivalencia en cigarrillos:</b> aproximación divulgativa de Berkeley Earth (22 µg/m³ de PM2.5 ≈ 1 cigarrillo al día). Es una comparación orientativa, no un diagnóstico.<br>
    <b>Diferencia con el IBOCA:</b> el IBOCA de la Secretaría de Ambiente informa el estado del aire en tiempo real. Aire Visible complementa: compara contra la OMS y no solo contra la norma, personaliza la exposición según la rutina y recomienda horas.<br>
    <span class="muted small">Proyecto académico · Habilidades Investigativas · Ingeniería de Software, Universidad de La Salle.</span>
  </div></div></div>`;
}

iniciar();
