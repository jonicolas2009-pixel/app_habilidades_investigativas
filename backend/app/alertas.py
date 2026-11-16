"""
Pronóstico, alertas y validación del pronóstico.

- Descarga el pronóstico de PM2.5 de Open-Meteo (modelo CAMS de Copernicus,
  gratuito y sin API key) para el centro de cada localidad.
- Lo guarda en la tabla `pronostico` (así después se puede comparar con lo
  medido: ¿qué tan confiable es un pronóstico global para Bogotá?).
- Crea alertas para los usuarios cuya localidad tendrá un día amarillo/rojo y,
  si hay un token de Telegram configurado, se las envía.

Ejecutar una vez al día (cron, Programador de tareas de Windows o el botón
"Ejecutar ahora" de la app):
    python -m app.alertas
Variables de entorno opcionales:
    TELEGRAM_TOKEN   token del bot creado con @BotFather
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date

import requests

from . import db, services

OPEN_METEO = "https://air-quality-api.open-meteo.com/v1/air-quality"


def descargar_pronostico(lat: float, lon: float, dias: int = 4) -> list[dict]:
    """Devuelve [{fecha, pm25_promedio, horas:[...]}] para los próximos días."""
    r = requests.get(OPEN_METEO, params={
        "latitude": lat, "longitude": lon, "hourly": "pm2_5",
        "timezone": "America/Bogota", "forecast_days": dias,
    }, timeout=20)
    r.raise_for_status()
    datos = r.json()["hourly"]
    por_dia = defaultdict(list)
    for t, v in zip(datos["time"], datos["pm2_5"]):
        if v is not None:
            por_dia[t[:10]].append((int(t[11:13]), v))
    return [{"fecha": f, "pm25_promedio": round(sum(v for _, v in hs) / len(hs), 1),
             "horas": [{"hora": h, "valor": v} for h, v in hs]}
            for f, hs in sorted(por_dia.items()) if len(hs) >= db.HORAS_MINIMAS]


def pronostico_localidad(con, localidad: str, guardar: bool = True) -> dict:
    loc = next((l for l in services.localidades(con) if l["nombre"] == localidad), None)
    if not loc:
        raise ValueError(f"Localidad desconocida: {localidad}")
    dias = descargar_pronostico(loc["lat"], loc["lon"])
    hoy = date.today().isoformat()
    if guardar:
        for d in dias:
            con.execute("""INSERT OR REPLACE INTO pronostico(localidad_id, fecha_objetivo, fecha_emision, pm25_promedio)
                           VALUES (?, ?, ?, ?)""", (loc["localidad_id"], d["fecha"], hoy, d["pm25_promedio"]))
        con.commit()
    for d in dias:
        d["semaforo"] = services.semaforo(d["pm25_promedio"])
    return {"localidad": localidad, "fuente": "Open-Meteo (CAMS, Copernicus)", "dias": dias}


def enviar_telegram(chat_id: str, texto: str) -> bool:
    token = os.environ.get("TELEGRAM_TOKEN")
    if not token or not chat_id:
        return False
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat_id, "text": texto}, timeout=15)
    return r.ok


def generar_alertas(con) -> dict:
    """Revisa el pronóstico de mañana para cada usuario y crea/envía alertas."""
    usuarios = con.execute("SELECT usuario_id FROM usuario").fetchall()
    cache, creadas, enviadas = {}, 0, 0
    for (uid,) in usuarios:
        u = services.obtener_usuario(con, uid)
        lugares = {u["casa"]} | {b["localidad"] for b in u["rutina"]}
        for loc in lugares:
            if loc not in cache:
                cache[loc] = pronostico_localidad(con, loc)
            for d in cache[loc]["dias"][1:2]:            # mañana
                v = d["pm25_promedio"]
                sensible = u["perfil_salud"] != "general"
                umbral = db.OMS_24H if sensible else db.NORMA_24H * 0.8
                if v <= umbral:
                    continue
                nivel = "rojo" if v > db.NORMA_24H else "amarillo"
                horas_limpias = sorted(d["horas"], key=lambda h: h["valor"])[:2]
                texto = (f"🌫️ Aire Visible · {loc}, {d['fecha']}\n"
                         f"Pronóstico PM2.5: {v} µg/m³ ({v / db.OMS_24H:.1f}× la guía OMS).\n"
                         f"{services.semaforo(v, u['perfil_salud'])['mensaje']}\n"
                         f"Horas más limpias: " + ", ".join(f"{h['hora']}:00" for h in horas_limpias))
                ya = con.execute("SELECT 1 FROM alerta WHERE usuario_id=? AND fecha_objetivo=? AND mensaje=?",
                                 (uid, d["fecha"], texto)).fetchone()
                if ya:
                    continue
                ok = enviar_telegram(u["telegram_chat_id"], texto)
                con.execute("INSERT INTO alerta(usuario_id, fecha_objetivo, nivel, mensaje, enviada) VALUES (?,?,?,?,?)",
                            (uid, d["fecha"], nivel, texto, int(ok)))
                creadas += 1
                enviadas += int(ok)
    con.commit()
    return {"usuarios_revisados": len(usuarios), "alertas_creadas": creadas, "enviadas_telegram": enviadas}


def validar_pronostico(con) -> dict:
    """Compara los pronósticos guardados con los promedios medidos (Etapa 5)."""
    filas = con.execute("""
        WITH medido AS (
            SELECT e.localidad_id, p.fecha, AVG(p.promedio) v
            FROM promedio_diario p JOIN estacion e USING(estacion_id) GROUP BY e.localidad_id, p.fecha)
        SELECT l.nombre localidad, pr.fecha_objetivo fecha, pr.pm25_promedio pronostico, m.v medido
        FROM pronostico pr JOIN medido m ON m.localidad_id = pr.localidad_id AND m.fecha = pr.fecha_objetivo
        JOIN localidad l ON l.localidad_id = pr.localidad_id""").fetchall()
    if not filas:
        return {"n": 0, "mensaje": "Aún no hay pronósticos que coincidan con días medidos. "
                                   "Ejecute las alertas a diario y cargue los datos nuevos del IDEAM."}
    n = len(filas)
    errores = [f["pronostico"] - f["medido"] for f in filas]
    acierto = sum(1 for f in filas if services._color(f["pronostico"]) == services._color(f["medido"]))
    return {"n": n, "error_medio_absoluto": round(sum(abs(e) for e in errores) / n, 1),
            "sesgo": round(sum(errores) / n, 1), "acierto_semaforo_pct": round(100 * acierto / n, 1),
            "pares": [dict(f) for f in filas[-60:]]}


if __name__ == "__main__":
    con = db.conectar()
    db.inicializar(con)
    print(generar_alertas(con))
