"""
ETAPAS 1-2 DEL ANTEPROYECTO: carga, limpieza y control de calidad del CSV del IDEAM.

Toma el archivo descargado de datos.gov.co ("Calidad del Aire en Colombia",
g4t8-zkc3), lo filtra (Bogotá + PM2.5), lo limpia, aplica un control de
calidad y lo guarda en la base de datos. Al final recalcula los promedios de
24 h (solo días con >= 18 horas válidas).

Uso:
    python scripts/cargar_datos_ideam.py ruta/al/archivo.csv [--desde 2024-01-01] [--hasta 2025-12-31]

Limpieza aplicada (queda registrada en pantalla y en data/reporte_calidad.csv):
  1. Solo filas de Bogotá: código de municipio 11001 o autoridad SDA
     (Secretaría Distrital de Ambiente).
  2. Solo PM2.5 (MSFL_CODE).
  3. Fechas de texto -> fecha/hora real; filas con fecha inválida se descartan.
  4. Valores vacíos o negativos se descartan.
  5. Duplicados (misma estación + hora) se descartan.
  6. Cada estación se asocia a su localidad con data/estaciones_localidades.csv
     (por ESTACION_ID y, si no coincide, por nombre).
  7. Control de calidad: se descartan los meses de una estación cuya mediana
     horaria supera 60 µg/m³. Es un valor físicamente inverosímil para el
     PM2.5 de Bogotá (cerca de 4 veces lo habitual) y delata errores de
     registro. En el archivo de 2026 esto ocurre en 2020-2023, donde varias
     estaciones muestran valores unas 10 veces más altos, con saltos abruptos
     de un mes a otro y sin decimales, mientras desde 2024 los datos son
     coherentes.
"""
import argparse
import sys
import unicodedata
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db  # noqa: E402

COLUMNAS = ["NOMBRE_EST", "MSFL_CODE", "MED_CONCENTRACION_ESTANDAR", "MED_FECHA_INICIO", "MED_FECHA_FINAL"]
MEDIANA_MENSUAL_MAX = 60.0   # µg/m³, umbral del control de calidad


def normalizar(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", str(txt)).encode("ascii", "ignore").decode()
    return "".join(c for c in txt.upper() if c.isalnum())


def main(ruta_csv: str, desde: str | None, hasta: str | None) -> None:
    print(f"Leyendo {ruta_csv} ...")
    df = pd.read_csv(ruta_csv, dtype=str, encoding="utf-8")
    df.columns = [c.strip().upper() for c in df.columns]
    faltan = [c for c in COLUMNAS if c not in df.columns]
    if faltan:
        sys.exit(f"Faltan columnas en el CSV: {faltan}")
    reporte = {"filas_iniciales": len(df)}

    # 1. Bogotá
    es_bogota = pd.Series(False, index=df.index)
    if "CODIGO_MUNICIPIO" in df.columns:
        es_bogota |= df["CODIGO_MUNICIPIO"].str.strip() == "11001"
    if "MUNICIPIO" in df.columns:
        es_bogota |= df["MUNICIPIO"].map(normalizar).str.startswith("BOGOTA")
    if "NOMBRE_FGDA" in df.columns:
        aut = df["NOMBRE_FGDA"].map(normalizar)
        es_bogota |= (aut == "SDA") | aut.str.contains("BOGOTA") | aut.str.contains("DISTRITALDEAMBIENTE")
    df = df[es_bogota]
    reporte["tras_filtro_bogota"] = len(df)

    # 2. PM2.5
    df = df[df["MSFL_CODE"].map(normalizar).isin({"PM25"})]
    reporte["tras_filtro_pm25"] = len(df)

    # 3. Fechas
    df = df.assign(inicio=pd.to_datetime(df["MED_FECHA_INICIO"], errors="coerce", format="mixed"),
                   fin=pd.to_datetime(df["MED_FECHA_FINAL"], errors="coerce", format="mixed"))
    df = df.dropna(subset=["inicio"])
    if desde:
        df = df[df["inicio"] >= pd.Timestamp(desde)]
    if hasta:
        df = df[df["inicio"] < pd.Timestamp(hasta) + pd.Timedelta(days=1)]
    reporte["tras_filtro_fechas"] = len(df)

    # 4. Valores vacíos / negativos
    df = df.assign(valor=pd.to_numeric(df["MED_CONCENTRACION_ESTANDAR"].str.replace(",", "."), errors="coerce"))
    df = df[df["valor"].notna() & (df["valor"] >= 0)]
    reporte["tras_quitar_vacios_negativos"] = len(df)

    # 6. Estación -> localidad
    con = db.conectar()
    db.inicializar(con)
    por_id = {str(r["estacion_id"]): r["estacion_id"] for r in con.execute("SELECT estacion_id FROM estacion")}
    por_nombre = {normalizar(r["nombre"]): r["estacion_id"] for r in con.execute("SELECT estacion_id, nombre FROM estacion")}

    def buscar(est_id: str, nombre: str):
        if est_id in por_id:
            return por_id[est_id]
        clave = normalizar(nombre)
        if clave in por_nombre:
            return por_nombre[clave]
        for n, eid in por_nombre.items():
            if n in clave or clave in n:
                return eid
        return None

    ids = df["ESTACION_ID"].astype(str).str.strip() if "ESTACION_ID" in df.columns else pd.Series("", index=df.index)
    pares = pd.DataFrame({"id": ids, "nombre": df["NOMBRE_EST"]}).drop_duplicates()
    mapa = {(p.id, p.nombre): buscar(p.id, p.nombre) for p in pares.itertuples()}
    sin_mapear = sorted({n for (i, n), v in mapa.items() if v is None})
    if sin_mapear:
        print("⚠️  Estaciones sin localidad (agréguelas a data/estaciones_localidades.csv):", sin_mapear)
    df = df.assign(estacion_id=[mapa[(i, n)] for i, n in zip(ids, df["NOMBRE_EST"])])
    df = df.dropna(subset=["estacion_id"])
    df["estacion_id"] = df["estacion_id"].astype(int)

    # 5. Duplicados
    df["fecha_hora"] = df["inicio"].dt.strftime("%Y-%m-%d %H:00")
    df = df.drop_duplicates(subset=["estacion_id", "fecha_hora"])
    reporte["tras_quitar_duplicados"] = len(df)

    # 7. Control de calidad por estación-mes
    df["mes"] = df["inicio"].dt.strftime("%Y-%m")
    mediana = df.groupby(["estacion_id", "mes"])["valor"].median().rename("mediana").reset_index()
    malos = mediana[mediana["mediana"] > MEDIANA_MENSUAL_MAX]
    if len(malos):
        nombres = dict(con.execute("SELECT estacion_id, nombre FROM estacion").fetchall())
        malos = malos.assign(estacion=malos["estacion_id"].map(nombres))
        salida = db.BASE_DIR / "data" / "reporte_calidad.csv"
        malos[["estacion", "estacion_id", "mes", "mediana"]].to_csv(salida, index=False, encoding="utf-8")
        print(f"⚠️  Control de calidad: {len(malos)} meses-estación descartados (mediana > {MEDIANA_MENSUAL_MAX:g} µg/m³). "
              f"Detalle en {salida.name}")
        df = df.merge(malos[["estacion_id", "mes"]], how="left", indicator=True)
        df = df[df["_merge"] == "left_only"].drop(columns="_merge")
    reporte["meses_estacion_descartados"] = len(malos)
    reporte["filas_limpias"] = len(df)

    # ¿Los datos son horarios o ya vienen como promedio diario?
    duracion_h = ((df["fin"] - df["inicio"]).dt.total_seconds() / 3600).median()
    pm = db.id_contaminante(con)
    if pd.notna(duracion_h) and duracion_h >= 20:
        print("Los registros son promedios diarios: se cargan directo a promedio_diario.")
        con.executemany(
            "INSERT OR REPLACE INTO promedio_diario VALUES (?, ?, ?, ?, 24)",
            [(int(r.estacion_id), pm, r.inicio.strftime("%Y-%m-%d"), round(r.valor, 2)) for r in df.itertuples()],
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
    r = con.execute("SELECT MIN(fecha), MAX(fecha) FROM promedio_diario").fetchone()
    print(f"  {'periodo con datos':<32} {r[0]} a {r[1]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--desde", help="fecha inicial AAAA-MM-DD (opcional)")
    ap.add_argument("--hasta", help="fecha final AAAA-MM-DD (opcional)")
    a = ap.parse_args()
    main(a.csv, a.desde, a.hasta)
