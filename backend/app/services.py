"""
Lógica de negocio de AIRE VISIBLE.

Todas las funciones reciben una conexión SQLite y devuelven diccionarios
listos para enviarse como JSON. No dependen de FastAPI, así se pueden probar
por separado (ver tests/test_calculos.py).
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, timedelta

from .db import HORAS_MINIMAS, NORMA_24H, OMS_24H

DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

# Volumen de aire inhalado por hora según actividad (m³/h), valores típicos
# de referencia de la EPA (Exposure Factors Handbook) redondeados.
VENTILACION = {"descanso": 0.5, "caminar": 1.2, "bici": 2.0, "correr": 3.2}

# Aproximación divulgativa de Berkeley Earth: respirar 22 µg/m³ de PM2.5
# durante un día equivale, en daño estimado, a fumar ~1 cigarrillo.
UG_POR_CIGARRILLO = 22.0

PERFILES = {
    "general": "Población general",
    "asma": "Asma o enfermedad respiratoria",
    "nino": "Niño o niña",
    "adulto_mayor": "Adulto mayor",
    "embarazo": "Embarazo",
}


# ---------------------------------------------------------------------------
# Semáforo
# ---------------------------------------------------------------------------
def semaforo(valor: float | None, perfil: str = "general") -> dict:
    """Clasifica un promedio de 24 h de PM2.5.

    verde    -> <= 15 µg/m³ (cumple la guía OMS)
    amarillo -> 15 a 37 µg/m³: cumple la norma colombiana pero NO la OMS
                (lo llamamos "día invisible")
    rojo     -> > 37 µg/m³: supera también la norma nacional
    """
    if valor is None:
        return {"color": "gris", "etiqueta": "Sin datos suficientes",
                "mensaje": f"Hubo menos de {HORAS_MINIMAS} horas válidas ese día."}
    sensible = perfil != "general"
    if valor <= OMS_24H:
        return {"color": "verde", "etiqueta": "Aire saludable",
                "mensaje": "Cumple la guía de la OMS. Buen día para actividades al aire libre."}
    if valor <= NORMA_24H:
        msg = ("Día invisible: la norma colombiana dice que está bien, pero supera la guía de la OMS "
               f"({valor / OMS_24H:.1f} veces).")
        msg += (" Con tu perfil, evita el ejercicio intenso al aire libre en horas pico."
                if sensible else " Si haces ejercicio, prefiere las horas de menor contaminación.")
        return {"color": "amarillo", "etiqueta": "Día invisible", "mensaje": msg}
    msg = "Supera la norma nacional (Res. 2254/2017) y la guía OMS."
    msg += (" Con tu perfil, evita actividades al aire libre y ten a mano tu tratamiento."
            if sensible else " Evita el ejercicio al aire libre; considera usar tapabocas N95 en la calle.")
    return {"color": "rojo", "etiqueta": "Aire dañino", "mensaje": msg}


def _color(valor: float) -> str:
    return "verde" if valor <= OMS_24H else "amarillo" if valor <= NORMA_24H else "rojo"


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def rango_datos(con: sqlite3.Connection) -> tuple[str, str]:
    r = con.execute("SELECT MIN(fecha), MAX(fecha) FROM promedio_diario").fetchone()
    return r[0], r[1]


def _ultimo_anio(con) -> tuple[str, str]:
    _, fin = rango_datos(con)
    ini = (date.fromisoformat(fin) - timedelta(days=364)).isoformat()
    return ini, fin


def datos_simulados(con) -> bool:
    r = con.execute("SELECT simulado FROM carga_datos ORDER BY carga_id DESC LIMIT 1").fetchone()
    return bool(r[0]) if r else False


def localidades(con) -> list[dict]:
    filas = con.execute("""
        SELECT l.localidad_id, l.nombre, l.zona,
               AVG(e.latitud) lat, AVG(e.longitud) lon, COUNT(e.estacion_id) estaciones
        FROM localidad l JOIN estacion e USING(localidad_id)
        GROUP BY l.localidad_id ORDER BY l.nombre""").fetchall()
    return [dict(f) for f in filas]


def estaciones(con) -> list[dict]:
    filas = con.execute("""
        SELECT e.estacion_id, e.nombre, e.latitud, e.longitud, l.nombre AS localidad, l.zona
        FROM estacion e JOIN localidad l USING(localidad_id) ORDER BY e.nombre""").fetchall()
    return [dict(f) for f in filas]


def _id_localidad(con, nombre: str) -> int:
    r = con.execute("SELECT localidad_id FROM localidad WHERE nombre = ?", (nombre,)).fetchone()
    if not r:
        raise ValueError(f"Localidad desconocida: {nombre}")
    return r[0]


def registrar_consulta(con, tipo: str, parametros: dict, resultado: str, usuario_id: int | None = None):
    con.execute(
        "INSERT INTO consulta_usuario(usuario_id, tipo, parametros, resultado) VALUES (?, ?, ?, ?)",
        (usuario_id, tipo, json.dumps(parametros, ensure_ascii=False), resultado),
    )
    con.commit()


# ---------------------------------------------------------------------------
# 1. Panorama de la ciudad (responde la 1.ª parte de la pregunta de investigación)
# ---------------------------------------------------------------------------
def resumen(con, desde: str | None = None, hasta: str | None = None) -> dict:
    if not desde or not hasta:
        desde, hasta = _ultimo_anio(con)
    r = con.execute("""
        SELECT COUNT(*) n, AVG(promedio) prom,
               SUM(promedio <= ?) verdes,
               SUM(promedio > ? AND promedio <= ?) invisibles,
               SUM(promedio > ?) rojos
        FROM promedio_diario WHERE fecha BETWEEN ? AND ?""",
        (OMS_24H, OMS_24H, NORMA_24H, NORMA_24H, desde, hasta)).fetchone()
    ranking = ranking_estaciones(con, desde, hasta)
    # Día típico: promedio de la ciudad por día
    ciudad = con.execute("""
        SELECT fecha, AVG(promedio) p FROM promedio_diario
        WHERE fecha BETWEEN ? AND ? GROUP BY fecha""", (desde, hasta)).fetchall()
    dias_ciudad = len(ciudad)
    dias_ciudad_invisibles = sum(1 for f in ciudad if OMS_24H < f["p"] <= NORMA_24H)
    peor_dia = max(ciudad, key=lambda f: f["p"]) if ciudad else None
    return {
        "desde": desde, "hasta": hasta,
        "dias_estacion": r["n"],
        "promedio": round(r["prom"] or 0, 1),
        "pct_sobre_oms": round(100 * (r["invisibles"] + r["rojos"]) / r["n"], 1) if r["n"] else 0,
        "pct_invisibles": round(100 * r["invisibles"] / r["n"], 1) if r["n"] else 0,
        "dias_verdes": r["verdes"], "dias_invisibles": r["invisibles"], "dias_rojos": r["rojos"],
        "dias_ciudad": dias_ciudad, "dias_ciudad_invisibles": dias_ciudad_invisibles,
        "veces_guia_oms": round((r["prom"] or 0) / 5.0, 1),  # vs. guía anual OMS (5 µg/m³)
        "estacion_critica": ranking[0] if ranking else None,
        "estacion_limpia": ranking[-1] if ranking else None,
        "peor_dia": {"fecha": peor_dia["fecha"], "promedio": round(peor_dia["p"], 1)} if peor_dia else None,
    }


def ranking_estaciones(con, desde: str | None = None, hasta: str | None = None) -> list[dict]:
    if not desde or not hasta:
        desde, hasta = _ultimo_anio(con)
    filas = con.execute("""
        SELECT e.estacion_id, e.nombre, l.nombre AS localidad, l.zona, e.latitud, e.longitud,
               COUNT(*) dias, ROUND(AVG(p.promedio), 1) promedio,
               SUM(p.promedio <= ?) verdes,
               SUM(p.promedio > ? AND p.promedio <= ?) invisibles,
               SUM(p.promedio > ?) rojos
        FROM promedio_diario p JOIN estacion e USING(estacion_id) JOIN localidad l USING(localidad_id)
        WHERE p.fecha BETWEEN ? AND ?
        GROUP BY e.estacion_id ORDER BY promedio DESC""",
        (OMS_24H, OMS_24H, NORMA_24H, NORMA_24H, desde, hasta)).fetchall()
    out = []
    for f in filas:
        d = dict(f)
        d["pct_sobre_oms"] = round(100 * (d["invisibles"] + d["rojos"]) / d["dias"], 1)
        out.append(d)
    return out


def ranking_localidades(con, desde: str | None = None, hasta: str | None = None) -> list[dict]:
    if not desde or not hasta:
        desde, hasta = _ultimo_anio(con)
    # Promedio diario de la localidad = promedio de sus estaciones ese día
    filas = con.execute("""
        WITH diario AS (
            SELECT l.nombre localidad, l.zona, p.fecha, AVG(p.promedio) v
            FROM promedio_diario p JOIN estacion e USING(estacion_id) JOIN localidad l USING(localidad_id)
            WHERE p.fecha BETWEEN ? AND ? GROUP BY l.localidad_id, p.fecha)
        SELECT localidad, zona, COUNT(*) dias, ROUND(AVG(v), 1) promedio,
               SUM(v <= ?) verdes, SUM(v > ? AND v <= ?) invisibles, SUM(v > ?) rojos
        FROM diario GROUP BY localidad ORDER BY promedio DESC""",
        (desde, hasta, OMS_24H, OMS_24H, NORMA_24H, NORMA_24H)).fetchall()
    out = []
    for f in filas:
        d = dict(f)
        d["pct_sobre_oms"] = round(100 * (d["invisibles"] + d["rojos"]) / d["dias"], 1)
        out.append(d)
    return out


def tendencia_mensual(con, localidad: str | None = None) -> list[dict]:
    filtro, params = "", []
    if localidad:
        filtro = "WHERE e.localidad_id = ?"
        params = [_id_localidad(con, localidad)]
    filas = con.execute(f"""
        SELECT substr(p.fecha, 1, 7) mes, ROUND(AVG(p.promedio), 1) promedio,
               ROUND(MAX(p.promedio), 1) maximo,
               SUM(p.promedio > ? AND p.promedio <= ?) invisibles, SUM(p.promedio > ?) rojos, COUNT(*) n
        FROM promedio_diario p JOIN estacion e USING(estacion_id) {filtro}
        GROUP BY mes ORDER BY mes""", [OMS_24H, NORMA_24H, NORMA_24H, *params]).fetchall()
    return [dict(f) for f in filas]


# ---------------------------------------------------------------------------
# 2. Semáforo de un día (objetivo específico 3 del anteproyecto)
# ---------------------------------------------------------------------------
def consulta_dia(con, fecha: str, estacion_id: int | None = None, localidad: str | None = None,
                 perfil: str = "general", usuario_id: int | None = None) -> dict:
    if estacion_id:
        filtro, param = "m.estacion_id = ?", estacion_id
        nombre = con.execute("SELECT nombre FROM estacion WHERE estacion_id = ?", (estacion_id,)).fetchone()
        lugar = f"Estación {nombre[0]}" if nombre else "Estación"
    elif localidad:
        filtro, param = "e.localidad_id = ?", _id_localidad(con, localidad)
        lugar = f"Localidad {localidad}"
    else:
        raise ValueError("Indique estacion_id o localidad")

    horas = con.execute(f"""
        SELECT CAST(substr(m.fecha_hora, 12, 2) AS INTEGER) hora, AVG(m.valor) v, COUNT(*) n
        FROM medicion m JOIN estacion e USING(estacion_id)
        WHERE {filtro} AND substr(m.fecha_hora, 1, 10) = ?
        GROUP BY hora ORDER BY hora""", (param, fecha)).fetchall()
    serie = [{"hora": h["hora"], "valor": round(h["v"], 1)} for h in horas]
    horas_validas = len(serie)
    promedio = round(sum(h["valor"] for h in serie) / horas_validas, 1) if horas_validas >= HORAS_MINIMAS else None
    s = semaforo(promedio, perfil)
    res = {
        "lugar": lugar, "fecha": fecha, "dia_semana": DIAS[date.fromisoformat(fecha).weekday()],
        "promedio_24h": promedio, "horas_validas": horas_validas, "horas_minimas": HORAS_MINIMAS,
        "oms": OMS_24H, "norma": NORMA_24H,
        "veces_oms": round(promedio / OMS_24H, 2) if promedio else None,
        "pct_de_norma": round(100 * promedio / NORMA_24H, 0) if promedio else None,
        "cumple_oms": promedio is not None and promedio <= OMS_24H,
        "cumple_norma": promedio is not None and promedio <= NORMA_24H,
        "semaforo": s, "horas": serie,
        "hora_pico": max(serie, key=lambda h: h["valor"]) if serie else None,
        "hora_limpia": min(serie, key=lambda h: h["valor"]) if serie else None,
    }
    registrar_consulta(con, "semaforo", {"fecha": fecha, "estacion_id": estacion_id, "localidad": localidad},
                       s["color"], usuario_id)
    return res


def calendario(con, anio: int, estacion_id: int | None = None, localidad: str | None = None) -> dict:
    """Semáforo de todos los días de un año (calendario tipo 'GitHub')."""
    if estacion_id:
        filas = con.execute("""SELECT fecha, promedio FROM promedio_diario
                               WHERE estacion_id = ? AND substr(fecha,1,4) = ? ORDER BY fecha""",
                            (estacion_id, str(anio))).fetchall()
    else:
        filas = con.execute("""SELECT p.fecha, AVG(p.promedio) promedio
                               FROM promedio_diario p JOIN estacion e USING(estacion_id)
                               WHERE e.localidad_id = ? AND substr(p.fecha,1,4) = ?
                               GROUP BY p.fecha ORDER BY p.fecha""",
                            (_id_localidad(con, localidad), str(anio))).fetchall()
    dias = [{"fecha": f["fecha"], "valor": round(f["promedio"], 1), "color": _color(f["promedio"])} for f in filas]
    conteo = defaultdict(int)
    for d in dias:
        conteo[d["color"]] += 1
    racha, mejor = 0, 0
    for d in dias:
        racha = racha + 1 if d["color"] != "verde" else 0
        mejor = max(mejor, racha)
    return {"anio": anio, "dias": dias, "conteo": dict(conteo), "racha_max_sin_aire_oms": mejor}


# ---------------------------------------------------------------------------
# 3. Mejor momento para salir: mapa de calor día de la semana x hora
# ---------------------------------------------------------------------------
def mejor_momento(con, localidad: str, meses: list[int] | None = None) -> dict:
    loc = _id_localidad(con, localidad)
    desde, hasta = _ultimo_anio(con)
    filas = con.execute("""
        SELECT m.fecha_hora, AVG(m.valor) v
        FROM medicion m JOIN estacion e USING(estacion_id)
        WHERE e.localidad_id = ? AND substr(m.fecha_hora,1,10) BETWEEN ? AND ?
        GROUP BY m.fecha_hora""", (loc, desde, hasta)).fetchall()
    suma = [[0.0] * 24 for _ in range(7)]
    n = [[0] * 24 for _ in range(7)]
    for f in filas:
        d = date.fromisoformat(f["fecha_hora"][:10])
        if meses and d.month not in meses:
            continue
        h = int(f["fecha_hora"][11:13])
        suma[d.weekday()][h] += f["v"]
        n[d.weekday()][h] += 1
    matriz = [[round(suma[d][h] / n[d][h], 1) if n[d][h] else None for h in range(24)] for d in range(7)]

    # Ventanas de 1 hora entre 5:00 y 21:00 (horario realista para ejercicio)
    ventanas = [(matriz[d][h], d, h) for d in range(7) for h in range(5, 21) if matriz[d][h] is not None]
    ventanas.sort()
    mejores = [{"dia": DIAS[d], "hora": h, "valor": v} for v, d, h in ventanas[:3]]
    peores = [{"dia": DIAS[d], "hora": h, "valor": v} for v, d, h in ventanas[-3:][::-1]]
    por_hora = []
    for h in range(24):
        vals = [matriz[d][h] for d in range(7) if matriz[d][h] is not None]
        por_hora.append(round(sum(vals) / len(vals), 1) if vals else None)
    return {"localidad": localidad, "desde": desde, "hasta": hasta, "dias": DIAS,
            "matriz": matriz, "por_hora": por_hora, "mejores": mejores, "peores": peores,
            "reduccion_pct": round(100 * (1 - mejores[0]["valor"] / peores[0]["valor"])) if ventanas else None}


# ---------------------------------------------------------------------------
# 4. Mi exposición personal (lo innovador frente al IBOCA)
# ---------------------------------------------------------------------------
def _serie_horaria_localidad(con, loc_id: int, desde: str, hasta: str) -> dict[str, float]:
    filas = con.execute("""
        SELECT m.fecha_hora, AVG(m.valor) v FROM medicion m JOIN estacion e USING(estacion_id)
        WHERE e.localidad_id = ? AND substr(m.fecha_hora,1,10) BETWEEN ? AND ?
        GROUP BY m.fecha_hora""", (loc_id, desde, hasta)).fetchall()
    return {f["fecha_hora"]: f["v"] for f in filas}


def exposicion(con, casa: str, rutina: list[dict], perfil: str = "general",
               actividad: str = "caminar", usuario_id: int | None = None) -> dict:
    """Calcula la exposición personal del último año según la rutina.

    `casa`   : localidad donde vive (cubre todas las horas no asignadas).
    `rutina` : lista de bloques {localidad, tipo, hora_inicio, hora_fin, dias}
               tipo = estudio | trabajo | ejercicio ; dias = "01234" (0 = lunes).
    """
    desde, hasta = _ultimo_anio(con)
    lugares = {casa} | {b["localidad"] for b in rutina}
    series = {l: _serie_horaria_localidad(con, _id_localidad(con, l), desde, hasta) for l in lugares}

    def ubicacion(dia_semana: int, hora: int) -> tuple[str, str]:
        for b in rutina:
            if str(dia_semana) in b.get("dias", "0123456") and b["hora_inicio"] <= hora < b["hora_fin"]:
                return b["localidad"], b["tipo"]
        return casa, "casa"

    d0, d1 = date.fromisoformat(desde), date.fromisoformat(hasta)
    dias_personales, dias_casa = [], []
    dosis_total, horas_dosis = 0.0, 0
    horas_por_lugar = defaultdict(lambda: [0.0, 0])
    dosis_ejercicio, horas_ejercicio = 0.0, 0
    d = d0
    while d <= d1:
        vals, vals_casa = [], []
        for h in range(24):
            clave = f"{d.isoformat()} {h:02d}:00"
            loc, tipo = ubicacion(d.weekday(), h)
            v = series[loc].get(clave)
            vc = series[casa].get(clave)
            if vc is not None:
                vals_casa.append(vc)
            if v is None:
                continue
            vals.append(v)
            horas_por_lugar[(loc, tipo)][0] += v
            horas_por_lugar[(loc, tipo)][1] += 1
            vent = VENTILACION[actividad] if tipo == "ejercicio" else VENTILACION["descanso"] if h < 6 or h >= 22 else 0.8
            dosis_total += v * vent
            horas_dosis += 1
            if tipo == "ejercicio":
                dosis_ejercicio += v * vent
                horas_ejercicio += 1
        if len(vals) >= HORAS_MINIMAS:
            dias_personales.append((d.isoformat(), sum(vals) / len(vals)))
        if len(vals_casa) >= HORAS_MINIMAS:
            dias_casa.append(sum(vals_casa) / len(vals_casa))
        d += timedelta(days=1)

    if not dias_personales:
        raise ValueError("No hay datos suficientes para esta rutina.")
    prom = sum(v for _, v in dias_personales) / len(dias_personales)
    prom_casa = sum(dias_casa) / len(dias_casa) if dias_casa else prom
    n = len(dias_personales)
    invisibles = sum(1 for _, v in dias_personales if OMS_24H < v <= NORMA_24H)
    rojos = sum(1 for _, v in dias_personales if v > NORMA_24H)
    ciudad = resumen(con, desde, hasta)["promedio"]

    lugares_out = [{"localidad": l, "tipo": t, "promedio": round(s / c, 1), "horas_dia": round(c / n, 1)}
                   for (l, t), (s, c) in horas_por_lugar.items()]
    lugares_out.sort(key=lambda x: -x["horas_dia"])

    # Sugerencia: mover el ejercicio a la mejor hora de su localidad
    sugerencia = None
    ej = next((b for b in rutina if b["tipo"] == "ejercicio"), None)
    if ej:
        mm = mejor_momento(con, ej["localidad"])
        dur = ej["hora_fin"] - ej["hora_inicio"]
        actual = [mm["por_hora"][h] for h in range(ej["hora_inicio"], ej["hora_fin"]) if mm["por_hora"][h]]
        opciones = []
        for h0 in range(5, 21 - dur + 1):
            vals = [mm["por_hora"][h] for h in range(h0, h0 + dur) if mm["por_hora"][h]]
            if vals:
                opciones.append((sum(vals) / len(vals), h0))
        if actual and opciones:
            mejor_v, mejor_h = min(opciones)
            act_v = sum(actual) / len(actual)
            if mejor_h != ej["hora_inicio"] and mejor_v < act_v:
                sugerencia = {"hora_actual": ej["hora_inicio"], "hora_sugerida": mejor_h,
                              "valor_actual": round(act_v, 1), "valor_sugerido": round(mejor_v, 1),
                              "reduccion_pct": round(100 * (1 - mejor_v / act_v)),
                              "localidad": ej["localidad"]}

    res = {
        "desde": desde, "hasta": hasta, "perfil": PERFILES.get(perfil, perfil), "actividad": actividad,
        "dias_analizados": n, "promedio_personal": round(prom, 1), "promedio_solo_casa": round(prom_casa, 1),
        "promedio_ciudad": ciudad,
        "dias_invisibles": invisibles, "dias_rojos": rojos, "dias_verdes": n - invisibles - rojos,
        "pct_sobre_oms": round(100 * (invisibles + rojos) / n, 1),
        "cigarrillos_anio": round(prom / UG_POR_CIGARRILLO * 365),
        "cigarrillos_dia": round(prom / UG_POR_CIGARRILLO, 2),
        "dosis_diaria_ug": round(dosis_total / horas_dosis * 24, 0) if horas_dosis else 0,
        "pct_dosis_ejercicio": round(100 * dosis_ejercicio / dosis_total, 1) if dosis_total else 0,
        "horas_ejercicio_dia": round(horas_ejercicio / n, 1),
        "lugares": lugares_out, "sugerencia": sugerencia,
        "serie": [{"fecha": f, "valor": round(v, 1)} for f, v in dias_personales],
        # Comparación anual: guía OMS 5 µg/m³ y norma colombiana 25 µg/m³ (promedio anual)
        "veces_guia_anual_oms": round(prom / 5.0, 1),
        "supera_norma_anual": prom > 25.0,
        "consejo": semaforo(prom, perfil)["mensaje"].split(". ", 1)[-1],
    }
    registrar_consulta(con, "exposicion", {"casa": casa, "rutina": rutina, "perfil": perfil},
                       f"{res['promedio_personal']} µg/m³", usuario_id)
    return res


# ---------------------------------------------------------------------------
# 5. Usuarios
# ---------------------------------------------------------------------------
def crear_usuario(con, alias: str, casa: str, rutina: list[dict], perfil: str = "general",
                  actividad: str = "caminar", telegram_chat_id: str | None = None) -> int:
    cur = con.execute(
        "INSERT INTO usuario(alias, perfil_salud, actividad, telegram_chat_id) VALUES (?, ?, ?, ?)",
        (alias, perfil, actividad, telegram_chat_id))
    uid = cur.lastrowid
    bloques = [{"localidad": casa, "tipo": "casa", "hora_inicio": 0, "hora_fin": 24, "dias": "0123456"}, *rutina]
    for b in bloques:
        con.execute("""INSERT INTO rutina(usuario_id, localidad_id, tipo, hora_inicio, hora_fin, dias)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (uid, _id_localidad(con, b["localidad"]), b["tipo"], b["hora_inicio"], b["hora_fin"],
                     b.get("dias", "0123456")))
    con.commit()
    return uid


def obtener_usuario(con, usuario_id: int) -> dict | None:
    u = con.execute("SELECT * FROM usuario WHERE usuario_id = ?", (usuario_id,)).fetchone()
    if not u:
        return None
    bloques = con.execute("""SELECT l.nombre localidad, r.tipo, r.hora_inicio, r.hora_fin, r.dias
                             FROM rutina r JOIN localidad l USING(localidad_id)
                             WHERE r.usuario_id = ? ORDER BY r.rutina_id""", (usuario_id,)).fetchall()
    bloques = [dict(b) for b in bloques]
    casa = next(b["localidad"] for b in bloques if b["tipo"] == "casa")
    return {**dict(u), "casa": casa, "rutina": [b for b in bloques if b["tipo"] != "casa"]}


def estadisticas_consultas(con) -> dict:
    tipos = con.execute("SELECT tipo, COUNT(*) n FROM consulta_usuario GROUP BY tipo").fetchall()
    colores = con.execute("""SELECT resultado, COUNT(*) n FROM consulta_usuario
                             WHERE tipo = 'semaforo' GROUP BY resultado""").fetchall()
    return {"por_tipo": {t["tipo"]: t["n"] for t in tipos},
            "semaforo": {c["resultado"]: c["n"] for c in colores},
            "usuarios": con.execute("SELECT COUNT(*) FROM usuario").fetchone()[0]}
