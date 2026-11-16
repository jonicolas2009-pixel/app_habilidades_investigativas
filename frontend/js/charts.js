/* =====================================================================
   Gráficos SVG hechos a mano (sin librerías externas)
   ===================================================================== */
const C = (() => {
  const OMS = 15, NORMA = 37;
  const COL = { verde: "#1de9b6", amarillo: "#f4c22b", rojo: "#f44236", gris: "#d5dbe3",
                azul: "#04a9f5", morado: "#a389d4", turquesa: "#1dc4e9", texto: "#9aa3b1", linea: "#eef1f5" };

  const fmt = (v, d = 1) => v == null ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: 0 });

  // Mezcla de colores para escalas continuas
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };
  function escala(v) {
    if (v == null) return "#eef1f5";
    if (v <= OMS) return mix("#c9fbee", "#1de9b6", Math.min(1, v / OMS));
    if (v <= NORMA) return mix("#ffe089", "#f4a62b", (v - OMS) / (NORMA - OMS));
    return mix("#f86a5e", "#b3170d", Math.min(1, (v - NORMA) / 25));
  }
  const colorSem = v => v == null ? COL.gris : v <= OMS ? COL.verde : v <= NORMA ? COL.amarillo : COL.rojo;

  // Tooltip global: cualquier elemento con data-tip lo muestra
  function initTip() {
    const tip = document.getElementById("tip");
    document.addEventListener("mousemove", e => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) { tip.classList.remove("show"); return; }
      tip.innerHTML = t.getAttribute("data-tip");
      tip.classList.add("show");
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = x + "px"; tip.style.top = y + "px";
    });
  }

  const svg = (w, h, inner, cls = "chart") => `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  // ------------------------------------------------------------------ línea
  function line(el, { labels, series, refs = [], height = 280, yMax, fmtX = x => x, every }) {
    const W = 820, H = height, m = { l: 44, r: 16, t: 16, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = labels.length;
    const maxV = yMax || Math.ceil(Math.max(...series.flatMap(s => s.values.filter(v => v != null)), ...refs.map(r => r.v)) * 1.12 / 5) * 5;
    const X = i => m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1));
    const Y = v => m.t + ih - (v / maxV) * ih;
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = maxV * k / 4, y = Y(v);
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${COL.linea}"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${COL.texto}">${fmt(v, 0)}</text>`;
    }
    const step = every || Math.max(1, Math.ceil(n / 12));
    labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${COL.texto}">${fmtX(l, i)}</text>`; });
    refs.forEach(r => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(r.v)}" y2="${Y(r.v)}" stroke="${r.color}" stroke-width="1.5" stroke-dasharray="6 5"/>
            <text x="${W - m.r - 4}" y="${Y(r.v) - 6}" text-anchor="end" font-size="11" font-weight="600" fill="${r.color}">${r.label}</text>`;
    });
    series.forEach((s, si) => {
      let d = "", started = false;
      s.values.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; started = true; });
      if (s.area) {
        const id = "ga" + Math.random().toString(36).slice(2, 8);
        g += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
              <path d="${d}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#${id})"/>`;
      }
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 40) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"/>`; });
    });
    // zonas invisibles para tooltip
    const bw = iw / Math.max(1, n - 1);
    labels.forEach((l, i) => {
      const txt = `<b>${fmtX(l, i, true)}</b><br>` + series.map(s => `<span style="color:${s.color}">●</span> ${s.name}: <b>${fmt(s.values[i])}</b> µg/m³`).join("<br>");
      g += `<rect x="${X(i) - bw / 2}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent" data-tip='${txt}'/>`;
    });
    el.innerHTML = svg(W, H, g);
  }

  // ------------------------------------------------------------------ dona
  function donut(el, parts, centro, sub) {
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    const R = 80, r = 56, cx = 100, cy = 100;
    let a0 = -Math.PI / 2, g = "";
    parts.forEach(p => {
      const a1 = a0 + 2 * Math.PI * p.value / total, big = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      if (p.value > 0) g += `<path d="M${pt(a0, R)}A${R},${R} 0 ${big} 1 ${pt(a1, R)}L${pt(a1, r)}A${r},${r} 0 ${big} 0 ${pt(a0, r)}Z" fill="${p.color}" data-tip="<b>${p.label}</b><br>${fmt(p.value, 0)} (${fmt(100 * p.value / total)} %)"/>`;
      a0 = a1;
    });
    g += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="26" font-weight="300" fill="#111">${centro}</text><text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="${COL.texto}">${sub}</text>`;
    el.innerHTML = svg(200, 200, g);
  }

  // ------------------------------------------------------------------ mapa
  function mapa(el, estaciones, campo = "promedio") {
    const W = 520, H = 600, pad = 40;
    const lats = estaciones.map(e => e.latitud), lons = estaciones.map(e => e.longitud);
    const [la0, la1, lo0, lo1] = [Math.min(...lats) - .02, Math.max(...lats) + .02, Math.min(...lons) - .02, Math.max(...lons) + .02];
    // Escala ligeramente estirada en longitud para que las estaciones del centro no se amontonen
    const ky = (H - 2 * pad) / (la1 - la0), kx = Math.min((W - 2 * pad - 60) / (lo1 - lo0), ky * 1.5);
    const X = lo => pad + 20 + (lo - lo0) * kx;
    const Y = la => H - pad - (la - la0) * ky;
    let g = `<defs><pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#eef1f5"/></pattern>
             <filter id="sh"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".18"/></filter></defs>
             <rect width="${W}" height="${H}" rx="8" fill="url(#grid)"/>`;
    // Cerros orientales (referencia)
    g += `<path d="M${W - 40},20 C${W - 70},150 ${W - 95},300 ${W - 70},${H - 20}" stroke="#d9e8d9" stroke-width="22" fill="none" stroke-linecap="round" opacity=".7"/>
          <text x="${W - 40}" y="${H / 2}" font-size="11" fill="#9bb59b" transform="rotate(-80 ${W - 40} ${H / 2})" text-anchor="middle">Cerros Orientales</text>
          <g transform="translate(36,40)"><circle r="16" fill="#fff" stroke="#e3e8ef"/><path d="M0,-10 L5,4 L0,1 L-5,4Z" fill="#3f4d67"/><text y="-20" text-anchor="middle" font-size="10" fill="#9aa3b1">N</text></g>`;
    const maxV = Math.max(...estaciones.map(e => e[campo]));
    [...estaciones].sort((a, b) => a[campo] - b[campo]).forEach(e => {
      const r = 8 + 10 * (e[campo] / maxV), x = X(e.longitud), y = Y(e.latitud);
      const tip = `<b>${e.nombre}</b> · ${e.localidad}<br>Promedio: <b>${fmt(e.promedio)} µg/m³</b><br>Días sobre OMS: <b>${fmt(e.pct_sobre_oms)} %</b><br><span style='color:#f4c22b'>●</span> Invisibles: ${e.invisibles} · <span style='color:#f44236'>●</span> Sobre norma: ${e.rojos}`;
      g += `<g data-tip="${tip}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${r + 7}" fill="${escala(e.promedio)}" opacity=".18"/>
            <circle cx="${x}" cy="${y}" r="${r}" fill="${escala(e.promedio)}" stroke="#fff" stroke-width="2.5" filter="url(#sh)"/>
            <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${Math.round(e.promedio)}</text>
            <text x="${x}" y="${y + r + 14}" text-anchor="middle" font-size="9.5" fill="#5b6575">${e.nombre.replace("Centro de Alto Rendimiento", "C. A. Rendimiento").replace("Carvajal - Sevillana", "Carvajal")}</text></g>`;
    });
    el.innerHTML = svg(W, H, g);
  }

  // ------------------------------------------------- mapa de calor día x hora
  function heat(el, matriz, dias, mejores = []) {
    const W = 840, cw = 30, ch = 34, l = 80, t = 26;
    const H = t + 7 * ch + 10;
    let g = "";
    for (let h = 0; h < 24; h++) g += `<text x="${l + h * cw + cw / 2}" y="16" text-anchor="middle" font-size="10.5" fill="${COL.texto}">${h}</text>`;
    matriz.forEach((fila, d) => {
      g += `<text x="${l - 10}" y="${t + d * ch + ch / 2 + 4}" text-anchor="end" font-size="12" fill="#555">${dias[d]}</text>`;
      fila.forEach((v, h) => {
        const best = mejores.some(m => m.dia === dias[d] && m.hora === h);
        g += `<rect x="${l + h * cw + 1.5}" y="${t + d * ch + 1.5}" width="${cw - 3}" height="${ch - 3}" rx="4" fill="${escala(v)}" ${best ? 'stroke="#3f4d67" stroke-width="2.5"' : ""}
              data-tip="<b>${dias[d]} ${h}:00–${h + 1}:00</b><br>Promedio histórico: <b>${fmt(v)} µg/m³</b>${best ? "<br>⭐ De las mejores horas" : ""}"/>`;
      });
    });
    el.innerHTML = svg(W, H, g);
  }

  // ------------------------------------------------ calendario (tipo GitHub)
  function calendario(el, dias, anio) {
    const cs = 15, l = 34, t = 22;
    const ini = new Date(Date.UTC(anio, 0, 1)), off = (ini.getUTCDay() + 6) % 7;
    const mapa = Object.fromEntries(dias.map(d => [d.fecha, d]));
    const W = l + 54 * cs + 10, H = t + 7 * cs + 8;
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    let g = "";
    ["L", "", "M", "", "V", "", "D"].forEach((d, i) => g += `<text x="${l - 8}" y="${t + i * cs + 11}" text-anchor="end" font-size="10" fill="${COL.texto}">${d}</text>`);
    for (let i = 0; i < 366; i++) {
      const f = new Date(ini.getTime() + i * 864e5);
      if (f.getUTCFullYear() !== anio) break;
      const iso = f.toISOString().slice(0, 10), k = i + off, sem = Math.floor(k / 7), dia = k % 7;
      if (f.getUTCDate() === 1) g += `<text x="${l + sem * cs}" y="12" font-size="10.5" fill="${COL.texto}">${meses[f.getUTCMonth()]}</text>`;
      const d = mapa[iso];
      g += `<rect x="${l + sem * cs}" y="${t + dia * cs}" width="${cs - 3}" height="${cs - 3}" rx="3" fill="${d ? colorSem(d.valor) : "#eef1f5"}"
            data-tip="<b>${iso}</b><br>${d ? `Promedio 24 h: <b>${fmt(d.valor)} µg/m³</b>` : "Sin datos válidos"}"/>`;
    }
    el.innerHTML = svg(W, H, g);
  }

  // ------------------------------------------------------- regla / medidor
  function regla(el, v) {
    const W = 420, H = 66, l = 10, r = 10, max = 60, iw = W - l - r;
    const X = x => l + Math.min(x, max) / max * iw;
    let g = `<rect x="${X(0)}" y="22" width="${X(OMS) - X(0)}" height="14" rx="3" fill="${COL.verde}"/>
             <rect x="${X(OMS)}" y="22" width="${X(NORMA) - X(OMS)}" height="14" fill="${COL.amarillo}"/>
             <rect x="${X(NORMA)}" y="22" width="${X(max) - X(NORMA)}" height="14" rx="3" fill="${COL.rojo}"/>
             <text x="${X(OMS)}" y="54" text-anchor="middle" font-size="11" fill="#555">15 · OMS</text>
             <text x="${X(NORMA)}" y="54" text-anchor="middle" font-size="11" fill="#555">37 · Norma</text>
             <text x="${X(0)}" y="54" font-size="11" fill="${COL.texto}">0</text><text x="${X(max)}" y="54" text-anchor="end" font-size="11" fill="${COL.texto}">60+</text>`;
    if (v != null) g += `<g transform="translate(${X(v)},0)"><path d="M-8,4 L8,4 L0,18Z" fill="#3f4d67"/><line y1="18" y2="40" stroke="#3f4d67" stroke-width="2.5"/></g>`;
    el.innerHTML = svg(W, H, g);
  }

  // ------------------------------------------------------- barras por hora
  function barrasHora(el, horas, refs = true) {
    const W = 820, H = 240, m = { l: 40, r: 10, t: 14, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(45, ...horas.map(h => h.valor)) * 1.08, bw = iw / 24;
    const Y = v => m.t + ih - v / max * ih;
    let g = "";
    [0, 15, 37].forEach(v => g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v ? (v === 15 ? COL.verde : COL.rojo) : COL.linea}" ${v ? 'stroke-dasharray="5 5"' : ""}/>
      <text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${COL.texto}">${v}</text>`);
    horas.forEach(h => {
      const x = m.l + h.hora * bw + 3;
      g += `<rect x="${x}" y="${Y(h.valor)}" width="${bw - 6}" height="${Y(0) - Y(h.valor)}" rx="3" fill="${colorSem(h.valor)}" data-tip="<b>${h.hora}:00</b><br>${fmt(h.valor)} µg/m³"/>`;
    });
    for (let h = 0; h < 24; h += 2) g += `<text x="${m.l + h * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="13" fill="${COL.texto}">${h}h</text>`;
    el.innerHTML = svg(W, H, g);
  }

  return { OMS, NORMA, COL, fmt, escala, colorSem, initTip, line, donut, mapa, heat, calendario, regla, barrasHora };
})();
