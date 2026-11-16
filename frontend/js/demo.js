/* =====================================================================
   MODO DEMOSTRACIÓN (sin servidor)
   Si la página no encuentra el servidor, usa datos precalculados
   (window.DEMO_DATA) y repite en JavaScript los mismos cálculos que hace
   el servidor en Python (app/services.py). Solo se usa para mostrar la app
   en línea; la versión oficial del proyecto es la del servidor.
   ===================================================================== */
const Demo = (() => {
  const OMS = 15, NORMA = 37, HMIN = 18, D = () => window.DEMO_DATA;
  const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const VENT = { descanso: 0.5, caminar: 1.2, bici: 2.0, correr: 3.2 };
  const r1 = v => Math.round(v * 10) / 10;
  const ms = iso => Date.parse(iso + "T00:00:00Z");
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const wd = isoDate => (new Date(ms(isoDate)).getUTCDay() + 6) % 7;
  const colorDe = v => v <= OMS ? "verde" : v <= NORMA ? "amarillo" : "rojo";
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  function semaforo(v, perfil = "general") {
    if (v == null) return { color: "gris", etiqueta: "Sin datos suficientes", mensaje: `Hubo menos de ${HMIN} horas válidas ese día.` };
    const s = perfil !== "general";
    if (v <= OMS) return { color: "verde", etiqueta: "Aire saludable", mensaje: "Cumple la guía de la OMS. Buen día para actividades al aire libre." };
    if (v <= NORMA) return { color: "amarillo", etiqueta: "Día invisible",
      mensaje: `Día invisible: la norma colombiana dice que está bien, pero supera la guía de la OMS (${(v / OMS).toFixed(1)} veces).` +
        (s ? " Con tu perfil, evita el ejercicio intenso al aire libre en horas pico." : " Si haces ejercicio, prefiere las horas de menor contaminación.") };
    return { color: "rojo", etiqueta: "Aire dañino", mensaje: "Supera la norma nacional (Res. 2254/2017) y la guía OMS." +
      (s ? " Con tu perfil, evita actividades al aire libre y ten a mano tu tratamiento." : " Evita el ejercicio al aire libre; considera usar tapabocas N95 en la calle.") };
  }

  // valor horario de una localidad (o null)
  function hora(loc, fecha, h) {
    const s = D().horario[loc]; if (!s) return null;
    const i = Math.round((ms(fecha) - ms(s.inicio)) / 864e5) * 24 + h;
    const v = s.v[i];
    return v == null || v < 0 ? null : v / 10;
  }
  const rango = () => [D().horario_desde, D().info.hasta];

  function registrar(tipo, res) {
    const st = store.get("av_stats", {}); st[tipo] = (st[tipo] || 0) + 1;
    if (tipo === "semaforo") { st["c_" + res] = (st["c_" + res] || 0) + 1; }
    store.set("av_stats", st);
  }

  function consultaDia({ fecha, localidad, perfil = "general" }) {
    if (!localidad) throw new Error("En la demostración se consulta por localidad.");
    const serie = [];
    for (let h = 0; h < 24; h++) { const v = hora(localidad, fecha, h); if (v != null) serie.push({ hora: h, valor: r1(v) }); }
    const n = serie.length, p = n >= HMIN ? r1(serie.reduce((a, b) => a + b.valor, 0) / n) : null;
    const s = semaforo(p, perfil);
    registrar("semaforo", s.color);
    return { lugar: `Localidad ${localidad}`, fecha, dia_semana: DIAS[wd(fecha)], promedio_24h: p, horas_validas: n, horas_minimas: HMIN,
      oms: OMS, norma: NORMA, veces_oms: p ? Math.round(p / OMS * 100) / 100 : null, pct_de_norma: p ? Math.round(100 * p / NORMA) : null,
      cumple_oms: p != null && p <= OMS, cumple_norma: p != null && p <= NORMA, semaforo: s, horas: serie,
      hora_pico: n ? serie.reduce((a, b) => b.valor > a.valor ? b : a) : null, hora_limpia: n ? serie.reduce((a, b) => b.valor < a.valor ? b : a) : null };
  }

  function calendario({ anio, localidad }) {
    const s = D().diario[localidad]; anio = +anio;
    const dias = []; const conteo = {};
    s.v.forEach((v, i) => {
      if (v < 0) return;
      const f = iso(ms(s.inicio) + i * 864e5);
      if (+f.slice(0, 4) !== anio) return;
      const c = colorDe(v / 10); conteo[c] = (conteo[c] || 0) + 1;
      dias.push({ fecha: f, valor: v / 10, color: c });
    });
    let racha = 0, mejor = 0;
    dias.forEach(d => { racha = d.color !== "verde" ? racha + 1 : 0; mejor = Math.max(mejor, racha); });
    return { anio, dias, conteo, racha_max_sin_aire_oms: mejor };
  }

  function mejorMomento({ localidad }) {
    const [desde, hasta] = rango();
    const suma = DIAS.map(() => Array(24).fill(0)), n = DIAS.map(() => Array(24).fill(0));
    for (let t = ms(desde); t <= ms(hasta); t += 864e5) {
      const f = iso(t), d = wd(f);
      for (let h = 0; h < 24; h++) { const v = hora(localidad, f, h); if (v != null) { suma[d][h] += v; n[d][h]++; } }
    }
    const matriz = suma.map((f, d) => f.map((s, h) => n[d][h] ? r1(s / n[d][h]) : null));
    const vent = [];
    matriz.forEach((f, d) => f.forEach((v, h) => { if (h >= 5 && h < 21 && v != null) vent.push([v, d, h]); }));
    vent.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const mejores = vent.slice(0, 3).map(([v, d, h]) => ({ dia: DIAS[d], hora: h, valor: v }));
    const peores = vent.slice(-3).reverse().map(([v, d, h]) => ({ dia: DIAS[d], hora: h, valor: v }));
    const por_hora = Array.from({ length: 24 }, (_, h) => { const vs = matriz.map(f => f[h]).filter(v => v != null); return vs.length ? r1(vs.reduce((a, b) => a + b, 0) / vs.length) : null; });
    return { localidad, desde, hasta, dias: DIAS, matriz, por_hora, mejores, peores,
      reduccion_pct: vent.length ? Math.round(100 * (1 - mejores[0].valor / peores[0].valor)) : null };
  }

  function exposicion({ casa, rutina = [], perfil = "general", actividad = "caminar" }) {
    const [desde, hasta] = rango();
    const ubic = (d, h) => { for (const b of rutina) if ((b.dias ?? "0123456").includes(String(d)) && b.hora_inicio <= h && h < b.hora_fin) return [b.localidad, b.tipo]; return [casa, "casa"]; };
    const dias = [], diasCasa = [], lug = {};
    let dosis = 0, hd = 0, dEj = 0, hEj = 0;
    for (let t = ms(desde); t <= ms(hasta); t += 864e5) {
      const f = iso(t), d = wd(f); const vals = [], vc = [];
      for (let h = 0; h < 24; h++) {
        const [loc, tipo] = ubic(d, h), v = hora(loc, f, h), c = hora(casa, f, h);
        if (c != null) vc.push(c);
        if (v == null) continue;
        vals.push(v);
        const k = loc + "|" + tipo; lug[k] = lug[k] || [0, 0]; lug[k][0] += v; lug[k][1]++;
        const vent = tipo === "ejercicio" ? VENT[actividad] : (h < 6 || h >= 22) ? VENT.descanso : 0.8;
        dosis += v * vent; hd++;
        if (tipo === "ejercicio") { dEj += v * vent; hEj++; }
      }
      if (vals.length >= HMIN) dias.push([f, vals.reduce((a, b) => a + b, 0) / vals.length]);
      if (vc.length >= HMIN) diasCasa.push(vc.reduce((a, b) => a + b, 0) / vc.length);
    }
    if (!dias.length) throw new Error("No hay datos suficientes para esta rutina.");
    const n = dias.length, prom = dias.reduce((a, b) => a + b[1], 0) / n;
    const promCasa = diasCasa.length ? diasCasa.reduce((a, b) => a + b, 0) / diasCasa.length : prom;
    const inv = dias.filter(([, v]) => v > OMS && v <= NORMA).length, rojos = dias.filter(([, v]) => v > NORMA).length;
    const lugares = Object.entries(lug).map(([k, [s, c]]) => { const [localidad, tipo] = k.split("|"); return { localidad, tipo, promedio: r1(s / c), horas_dia: r1(c / n) }; })
      .sort((a, b) => b.horas_dia - a.horas_dia);
    let sugerencia = null;
    const ej = rutina.find(b => b.tipo === "ejercicio");
    if (ej) {
      const mm = mejorMomento({ localidad: ej.localidad }), dur = ej.hora_fin - ej.hora_inicio;
      const prom_ = a => a.reduce((x, y) => x + y, 0) / a.length;
      const act = mm.por_hora.slice(ej.hora_inicio, ej.hora_fin).filter(Boolean);
      const ops = [];
      for (let h0 = 5; h0 <= 21 - dur; h0++) { const vs = mm.por_hora.slice(h0, h0 + dur).filter(Boolean); if (vs.length) ops.push([prom_(vs), h0]); }
      if (act.length && ops.length) {
        ops.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [mv, mh] = ops[0], av = prom_(act);
        if (mh !== ej.hora_inicio && mv <= av * 0.9) sugerencia = { hora_actual: ej.hora_inicio, hora_sugerida: mh, valor_actual: r1(av), valor_sugerido: r1(mv), reduccion_pct: Math.round(100 * (1 - mv / av)), localidad: ej.localidad };
      }
    }
    registrar("exposicion");
    const perfiles = D().info.perfiles;
    return { desde, hasta, perfil: perfiles[perfil] || perfil, actividad, dias_analizados: n, promedio_personal: r1(prom), promedio_solo_casa: r1(promCasa),
      promedio_ciudad: D().resumen.promedio, dias_invisibles: inv, dias_rojos: rojos, dias_verdes: n - inv - rojos,
      pct_sobre_oms: r1(100 * (inv + rojos) / n), cigarrillos_anio: Math.round(prom / 22 * 365), cigarrillos_dia: Math.round(prom / 22 * 100) / 100,
      dosis_diaria_ug: hd ? Math.round(dosis / hd * 24) : 0, pct_dosis_ejercicio: dosis ? r1(100 * dEj / dosis) : 0, horas_ejercicio_dia: r1(hEj / n),
      lugares, sugerencia, serie: dias.map(([fecha, v]) => ({ fecha, valor: r1(v) })),
      veces_guia_anual_oms: r1(prom / 5), supera_norma_anual: prom > 25, consejo: semaforo(prom, perfil).mensaje.split(". ").slice(1).join(". ") };
  }

  function tendencia({ localidad }) { return D().tendencia[localidad || ""]; }

  async function pronostico({ localidad }) {
    const l = D().info.localidades.find(x => x.nombre === localidad);
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${l.lat}&longitude=${l.lon}&hourly=pm2_5&timezone=America%2FBogota&forecast_days=4`;
    const r = await fetch(url); if (!r.ok) throw new Error("Open-Meteo no respondió");
    const j = await r.json(), por = {};
    j.hourly.time.forEach((t, i) => { const v = j.hourly.pm2_5[i]; if (v != null) (por[t.slice(0, 10)] = por[t.slice(0, 10)] || []).push({ hora: +t.slice(11, 13), valor: v }); });
    const dias = Object.entries(por).filter(([, hs]) => hs.length >= HMIN).map(([fecha, horas]) => { const p = r1(horas.reduce((a, b) => a + b.valor, 0) / horas.length); return { fecha, pm25_promedio: p, horas, semaforo: semaforo(p) }; });
    return { localidad, fuente: "Open-Meteo (CAMS, Copernicus)", dias };
  }

  function crearUsuario(body) { const u = { usuario_id: Date.now(), ...body, perfil_salud: body.perfil }; store.set("av_usuario_demo", u); registrar("usuario"); return u; }
  function estadisticas() { const st = store.get("av_stats", {}); return { por_tipo: { semaforo: st.semaforo || 0, exposicion: st.exposicion || 0 },
    semaforo: { verde: st.c_verde || 0, amarillo: st.c_amarillo || 0, rojo: st.c_rojo || 0 }, usuarios: st.usuario || 0 }; }

  async function manejar(metodo, ruta, datos = {}) {
    const d = D();
    switch (ruta) {
      case "/api/info": return d.info;
      case "/api/resumen": return d.resumen;
      case "/api/ranking/estaciones": return d.ranking_estaciones;
      case "/api/ranking/localidades": return d.ranking_localidades;
      case "/api/tendencia": return tendencia(datos);
      case "/api/semaforo": return consultaDia(datos);
      case "/api/calendario": return calendario(datos);
      case "/api/mejor-momento": return mejorMomento(datos);
      case "/api/exposicion": return exposicion(datos);
      case "/api/usuarios": return crearUsuario(datos);
      case "/api/pronostico": return pronostico(datos);
      case "/api/estadisticas": return estadisticas();
      case "/api/validacion-pronostico": return { n: 0, mensaje: "La validación del pronóstico necesita el servidor: guarda el pronóstico cada día y luego lo compara con lo medido por el IDEAM." };
      case "/api/alertas/ejecutar": throw new Error("Las alertas por Telegram se ejecutan en el servidor.");
      default: throw new Error("Ruta no disponible en la demostración: " + ruta);
    }
  }
  return { manejar };
})();
