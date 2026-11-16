"""
AIRE VISIBLE — Servidor (API REST con FastAPI)

Ejecutar desde la carpeta backend/:
    uvicorn app.main:app --reload
Luego abrir:
    http://localhost:8000          -> la aplicación
    http://localhost:8000/docs     -> documentación interactiva de la API (Swagger)
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import alertas, db, services

app = FastAPI(
    title="Aire Visible API",
    description="PM2.5 en Bogotá: semáforo OMS vs. norma nacional, días invisibles y exposición personal.",
    version="1.0.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

con = db.conectar()
db.inicializar(con)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def _err(e: Exception):
    raise HTTPException(status_code=400, detail=str(e))


# ----------------------------- Modelos de entrada -----------------------------
class Bloque(BaseModel):
    localidad: str
    tipo: str = Field(description="estudio | trabajo | ejercicio")
    hora_inicio: int = Field(ge=0, le=23)
    hora_fin: int = Field(ge=1, le=24)
    dias: str = Field(default="01234", description="0=lunes ... 6=domingo")


class Perfil(BaseModel):
    casa: str
    rutina: list[Bloque] = []
    perfil: str = "general"
    actividad: str = "caminar"


class NuevoUsuario(Perfil):
    alias: str
    telegram_chat_id: Optional[str] = None


# --------------------------------- Endpoints ---------------------------------
@app.get("/api/info", tags=["General"])
def info():
    desde, hasta = services.rango_datos(con)
    return {"desde": desde, "hasta": hasta, "oms_24h": db.OMS_24H, "norma_24h": db.NORMA_24H,
            "horas_minimas": db.HORAS_MINIMAS, "datos_simulados": services.datos_simulados(con), "perfiles": services.PERFILES,
            "localidades": services.localidades(con), "estaciones": services.estaciones(con)}


@app.get("/api/resumen", tags=["Panorama"])
def resumen(desde: Optional[str] = None, hasta: Optional[str] = None):
    return services.resumen(con, desde, hasta)


@app.get("/api/ranking/estaciones", tags=["Panorama"])
def ranking_estaciones(desde: Optional[str] = None, hasta: Optional[str] = None):
    return services.ranking_estaciones(con, desde, hasta)


@app.get("/api/ranking/localidades", tags=["Panorama"])
def ranking_localidades(desde: Optional[str] = None, hasta: Optional[str] = None):
    return services.ranking_localidades(con, desde, hasta)


@app.get("/api/tendencia", tags=["Panorama"])
def tendencia(localidad: Optional[str] = None):
    try:
        return services.tendencia_mensual(con, localidad)
    except ValueError as e:
        _err(e)


@app.get("/api/semaforo", tags=["Semáforo"])
def semaforo(fecha: str, estacion_id: Optional[int] = None, localidad: Optional[str] = None,
             perfil: str = "general", usuario_id: Optional[int] = None):
    try:
        return services.consulta_dia(con, fecha, estacion_id, localidad, perfil, usuario_id)
    except ValueError as e:
        _err(e)


@app.get("/api/calendario", tags=["Semáforo"])
def calendario(anio: int, estacion_id: Optional[int] = None, localidad: Optional[str] = None):
    try:
        return services.calendario(con, anio, estacion_id, localidad)
    except ValueError as e:
        _err(e)


@app.get("/api/mejor-momento", tags=["Mi aire"])
def mejor_momento(localidad: str):
    try:
        return services.mejor_momento(con, localidad)
    except ValueError as e:
        _err(e)


@app.post("/api/exposicion", tags=["Mi aire"])
def exposicion(p: Perfil):
    try:
        return services.exposicion(con, p.casa, [b.model_dump() for b in p.rutina], p.perfil, p.actividad)
    except ValueError as e:
        _err(e)


@app.post("/api/usuarios", tags=["Usuarios"])
def crear_usuario(u: NuevoUsuario):
    try:
        uid = services.crear_usuario(con, u.alias, u.casa, [b.model_dump() for b in u.rutina],
                                     u.perfil, u.actividad, u.telegram_chat_id)
    except ValueError as e:
        _err(e)
    return services.obtener_usuario(con, uid)


@app.get("/api/usuarios/{usuario_id}", tags=["Usuarios"])
def ver_usuario(usuario_id: int):
    u = services.obtener_usuario(con, usuario_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    return u


@app.get("/api/usuarios/{usuario_id}/alertas", tags=["Alertas"])
def alertas_usuario(usuario_id: int):
    filas = con.execute("SELECT * FROM alerta WHERE usuario_id = ? ORDER BY alerta_id DESC LIMIT 20",
                        (usuario_id,)).fetchall()
    return [dict(f) for f in filas]


@app.get("/api/pronostico", tags=["Alertas"])
def pronostico(localidad: str):
    try:
        return alertas.pronostico_localidad(con, localidad)
    except ValueError as e:
        _err(e)
    except Exception as e:  # sin internet o Open-Meteo caído
        raise HTTPException(503, "sin conexión con Open-Meteo")


@app.post("/api/alertas/ejecutar", tags=["Alertas"])
def ejecutar_alertas():
    try:
        return alertas.generar_alertas(con)
    except Exception as e:
        raise HTTPException(503, "no se pudo consultar el pronóstico (sin conexión con Open-Meteo)")


@app.get("/api/validacion-pronostico", tags=["Alertas"])
def validacion():
    return alertas.validar_pronostico(con)


@app.get("/api/estadisticas", tags=["General"])
def estadisticas():
    return services.estadisticas_consultas(con)


# ------------------------- Frontend (archivos estáticos) -------------------------
# Se monta al final para que las rutas /api/... tengan prioridad.
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
