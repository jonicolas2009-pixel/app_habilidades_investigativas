"""
ETAPAS 1-2 DEL ANTEPROYECTO: carga y limpieza del CSV del IDEAM.

Toma el archivo descargado de datos.gov.co ("Calidad del Aire en Colombia",
g4t8-zkc3), lo filtra (Bogotá + PM2.5), lo limpia y lo guarda en la base de
datos. Al final recalcula los promedios de 24 h (solo días con >= 18 horas).

Uso:
    python scripts/cargar_datos_ideam.py ruta/al/archivo.csv

Limpieza aplicada (queda registrada en pantalla para el informe):
  1. Solo filas de la autoridad ambiental de Bogotá (NOMBRE_FGDA).
  2. Solo PM2.5 (MSFL_CODE).
  3. Fechas de texto -> fecha/hora real; filas con fecha inválida se descartan.
  4. Valores vacíos o negativos se descartan.
  5. Duplicados (misma estación + hora) se descartan.
  6. Cada estación se asocia a su localidad con data/estaciones_localidades.csv.
"""
import sys
import unicodedata
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db  # noqa: E402

COLUMNAS = ["NOMBRE_FGDA", "NOMBRE_EST", "MSFL_CODE",
            "MED_CONCENTRACION_ESTANDAR", "MED_FECHA_INICIO", "MED_FECHA_FINAL"]


def normalizar(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", str(txt)).encode("ascii", "ignore").decode()
    return "".join(c for c in txt.upper() if c.isalnum())


def main(ruta_csv: str) -> None:
    print(f"Leyendo {ruta_csv} ...")
    df = pd.read_csv(ruta_csv, dtype=str, encoding="utf-8")
    df.columns = [c.strip().upper() for c in df.columns]
    faltan = [c for c in COLUMNAS if c not in df.columns]
    if faltan:
        sys.exit(f"Faltan columnas en el CSV: {faltan}")
    reporte = {"filas_iniciales": len(df)}

    # 1-2. Filtros Bogotá y PM2.5
    autoridad = df["NOMBRE_FGDA"].map(normalizar)
    df = df[autoridad.str.contains("BOGOTA") | autoridad.str.contains("DISTRITALDEAMBIENTE")]
    reporte["tras_filtro_bogota"] = len(df)
    df = df[df["MSFL_CODE"].map(normalizar).isin({"PM25", "PM2"})]
    reporte["tras_filtro_pm25"] = len(df)

    # 3. Fechas
    df["inicio"] = pd.to_datetime(df["MED_FECHA_INICIO"], errors="coerce", format="mixed")
    df["fin"] = pd.to_datetime(df["MED_FECHA_FINAL"], errors="coerce", format="mixed")
    df = df.dropna(subset=["inicio"])

    # 4. Valores vacíos / negativos
    df["valor"] = pd.to_numeric(df["MED_CONCENTRACION_ESTANDAR"].str.replace(",", "."), errors="coerce")
    df = df[df["valor"].notna() & (df["valor"] >= 0)]
    reporte["tras_quitar_vacios_negativos"] = len(df)

    # 6. Estación -> localidad
    con = db.conectar()
    db.inicializar(con)
    estaciones = {normalizar(r["nombre"]): r["estacion_id"]
                  for r in con.execute("SELECT estacion_id, nombre FROM estacion")}
    df["clave"] = df["NOMBRE_EST"].map(normalizar)

    def buscar(clave: str):
        if clave in estaciones:
            return estaciones[clave]
        for nombre, eid in estaciones.items():      # coincidencia parcial
            if nombre in clave or clave in nombre:
                return eid
        return None

    mapa = {c: buscar(c) for c in df["clave"].unique()}
    sin_mapear = sorted(c for c, v in mapa.items() if v is None)
    if sin_mapear:
        print("⚠️  Estaciones sin localidad (agréguelas a data/estaciones_localidades.csv):", sin_mapear)
    df["estacion_id"] = df["clave"].map(mapa)
    df = df.dropna(subset=["estacion_id"])

    # 5. Duplicados
    df["fecha_hora"] = df["inicio"].dt.strftime("%Y-%m-%d %H:00")
    df = df.drop_duplicates(subset=["estacion_id", "fecha_hora"])
    reporte["filas_limpias"] = len(df)

    # ¿Los datos son horarios o ya vienen como promedio diario?
    duracion_h = ((df["fin"] - df["inicio"]).dt.total_seconds() / 3600).median()
    pm = db.id_contaminante(con)
    if pd.notna(duracion_h) and duracion_h >= 20:
        print("Los registros son promedios diarios: se cargan directo a promedio_diario.")
        con.executemany(
            "INSERT OR REPLACE INTO promedio_diario VALUES (?, ?, ?, ?, 24)",
            [(int(r.estacion_id), pm, r.inicio.strftime("%Y-%m-%d"), round(r.valor, 2))
             for r in df.itertuples()],
        )
        con.commit()
    else:
        con.executemany(
            "INSERT OR IGNORE INTO medicion(estacion_id, contaminante_id, fecha_hora, valor) VALUES (?, ?, ?, ?)",
            [(int(r.estacion_id), pm, r.fecha_hora, float(r.valor)) for r in df.itertuples()],
        )
        con.commit()
        reporte["dias_validos_(>=18h)"] = db.recalcular_promedios(con)

    con.execute("INSERT INTO carga_datos(archivo, filas_limpias, simulado) VALUES (?, ?, ?)",
                (Path(ruta_csv).name, len(df), int("simulado" in Path(ruta_csv).name.lower())))
    con.commit()

    print("\nReporte de limpieza")
    for k, v in reporte.items():
        print(f"  {k:<32} {v:>10,}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
