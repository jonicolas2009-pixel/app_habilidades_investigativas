"""Conexión a la base de datos SQLite y carga de tablas de referencia."""
import csv
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("AIRE_DB", BASE_DIR / "data" / "airevisible.db"))
SCHEMA = Path(__file__).with_name("schema.sql")
ESTACIONES_CSV = BASE_DIR / "data" / "estaciones_localidades.csv"

# Umbrales del semáforo (µg/m³, promedio de 24 horas)
OMS_24H = 15.0          # Guía OMS 2021
NORMA_24H = 37.0        # Resolución 2254 de 2017
HORAS_MINIMAS = 18      # horas válidas para aceptar un promedio diario
PM25 = "PM2.5"


def conectar(path: Path | str = DB_PATH) -> sqlite3.Connection:
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def inicializar(con: sqlite3.Connection) -> None:
    """Crea las tablas y carga localidades, estaciones, contaminante y límites."""
    con.executescript(SCHEMA.read_text(encoding="utf-8"))

    with open(ESTACIONES_CSV, encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            con.execute(
                "INSERT OR IGNORE INTO localidad(nombre, zona) VALUES (?, ?)",
                (fila["localidad"], fila["zona"]),
            )
            loc_id = con.execute(
                "SELECT localidad_id FROM localidad WHERE nombre = ?", (fila["localidad"],)
            ).fetchone()[0]
            con.execute(
                """INSERT OR IGNORE INTO estacion(estacion_id, nombre, localidad_id, latitud, longitud)
                   VALUES (?, ?, ?, ?, ?)""",
                (int(fila["estacion_id"]), fila["nombre"], loc_id,
                 float(fila["latitud"]), float(fila["longitud"])),
            )

    con.execute(
        "INSERT OR IGNORE INTO contaminante(codigo, nombre) VALUES (?, ?)",
        (PM25, "Material particulado fino"),
    )
    pm = id_contaminante(con)
    if not con.execute("SELECT 1 FROM limite_referencia LIMIT 1").fetchone():
        con.executemany(
            """INSERT INTO limite_referencia(contaminante_id, fuente, periodo, valor, color_semaforo)
               VALUES (?, ?, ?, ?, ?)""",
            [
                (pm, "OMS 2021", "24h", OMS_24H, "amarillo"),
                (pm, "Res. 2254/2017", "24h", NORMA_24H, "rojo"),
                (pm, "OMS 2021", "anual", 5.0, "info"),
                (pm, "Res. 2254/2017", "anual", 25.0, "info"),
            ],
        )
    con.commit()


def id_contaminante(con: sqlite3.Connection, codigo: str = PM25) -> int:
    return con.execute(
        "SELECT contaminante_id FROM contaminante WHERE codigo = ?", (codigo,)
    ).fetchone()[0]


def recalcular_promedios(con: sqlite3.Connection) -> int:
    """Calcula el promedio de 24 h por estación y día, solo con >= 18 horas válidas."""
    con.execute("DELETE FROM promedio_diario")
    con.execute(
        """
        INSERT INTO promedio_diario(estacion_id, contaminante_id, fecha, promedio, horas_validas)
        SELECT estacion_id, contaminante_id, substr(fecha_hora, 1, 10) AS fecha,
               ROUND(AVG(valor), 2), COUNT(*)
        FROM medicion
        GROUP BY estacion_id, contaminante_id, fecha
        HAVING COUNT(*) >= ?
        """,
        (HORAS_MINIMAS,),
    )
    con.commit()
    return con.execute("SELECT COUNT(*) FROM promedio_diario").fetchone()[0]
