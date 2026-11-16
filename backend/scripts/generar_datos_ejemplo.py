"""
Genera un CSV DE EJEMPLO con el mismo formato que el conjunto
"Calidad del Aire en Colombia" del IDEAM (datos.gov.co, g4t8-zkc3).

⚠️  Estos datos son SIMULADOS. Sirven para probar la app mientras se descarga
    el archivo real. Imitan patrones conocidos de Bogotá (más PM2.5 en el
    suroccidente, picos en la hora pico de la mañana, temporada seca de
    febrero-marzo, domingos más limpios), pero NO son mediciones reales y no
    deben usarse como resultado de la investigación.

Incluye a propósito "suciedad" (vacíos, negativos, duplicados y filas de otra
autoridad ambiental) para comprobar que el script de limpieza funciona.

Uso:  python scripts/generar_datos_ejemplo.py  [salida.csv]
"""
import csv
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent.parent
SALIDA = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "data" / "ideam_ejemplo_simulado.csv"

INICIO = datetime(2023, 11, 1)
FIN = datetime(2026, 11, 1)          # 3 años de datos horarios

# Nivel medio anual simulado por estación (µg/m³)
NIVEL = {
    "Guaymaral": 10, "Usaquén": 13, "Suba": 15, "Colina": 12, "Las Ferias": 15,
    "Bolivia": 14, "Centro de Alto Rendimiento": 13, "Móvil 7ma": 19, "MinAmbiente": 13,
    "Fontibón": 18, "Móvil Fontibón": 21, "Puente Aranda": 19, "Jazmín": 18,
    "Kennedy": 23, "Carvajal - Sevillana": 28, "Bosa": 20, "Tunal": 20,
    "San Cristóbal": 12, "Ciudad Bolívar": 18, "Usme": 14,
}
MES = [1.15, 1.35, 1.40, 1.05, 0.95, 0.80, 0.75, 0.80, 0.90, 1.00, 1.00, 0.95]
HORA = [0.85, 0.80, 0.78, 0.78, 0.82, 0.95, 1.25, 1.50, 1.50, 1.35, 1.15, 0.95,
        0.85, 0.75, 0.70, 0.70, 0.78, 0.92, 1.08, 1.12, 1.05, 0.98, 0.92, 0.88]
DIA_SEMANA = [1.05, 1.05, 1.05, 1.05, 1.08, 0.95, 0.78]   # lunes..domingo


def main() -> None:
    rng = np.random.default_rng(2026)
    estaciones = list(csv.DictReader(open(BASE / "data" / "estaciones_localidades.csv", encoding="utf-8")))
    n_dias = (FIN - INICIO).days

    # Anomalía meteorológica diaria compartida por toda la ciudad (AR(1))
    clima = np.zeros(n_dias)
    for d in range(1, n_dias):
        clima[d] = 0.65 * clima[d - 1] + rng.normal(0, 0.22)
    # Episodios de incendios / temporada seca (feb-mar): días con aire muy cargado
    for d in range(n_dias):
        fecha = INICIO + timedelta(days=d)
        if fecha.month in (2, 3) and rng.random() < 0.06:
            clima[d: d + rng.integers(2, 5)] += 0.55

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ESTACION_ID", "NOMBRE_FGDA", "NOMBRE_EST", "MSFL_CODE",
                    "MED_CONCENTRACION_ESTANDAR", "MED_FECHA_INICIO", "MED_FECHA_FINAL",
                    "LATITUD", "LONGITUD"])
        filas = 0
        for est in estaciones:
            nivel = NIVEL[est["nombre"]]
            ruido_est = np.zeros(n_dias)
            for d in range(1, n_dias):
                ruido_est[d] = 0.5 * ruido_est[d - 1] + rng.normal(0, 0.12)
            caida = set(rng.choice(n_dias, size=int(n_dias * 0.012), replace=False))  # días con equipo fuera
            for d in range(n_dias):
                fecha = INICIO + timedelta(days=d)
                factor_dia = MES[fecha.month - 1] * DIA_SEMANA[fecha.weekday()] * np.exp(clima[d] + ruido_est[d])
                horas_perdidas = 10 if d in caida else 0
                for h in range(24):
                    if h < horas_perdidas or rng.random() < 0.035:
                        if rng.random() < 0.3:     # a veces viene la fila con valor vacío
                            valor = ""
                        else:
                            continue
                    else:
                        valor = round(float(nivel * factor_dia * HORA[h] * rng.lognormal(0, 0.18)), 1)
                        if rng.random() < 0.0008:
                            valor = -round(valor, 1)          # error de equipo
                    ini = fecha + timedelta(hours=h)
                    fila = [f"BOG{int(est['estacion_id']):02d}", "SECRETARIA DISTRITAL DE AMBIENTE - BOGOTA D.C.",
                            est["nombre"].upper(), "PM2.5", valor,
                            ini.strftime("%Y/%m/%d %H:%M:%S"),
                            (ini + timedelta(hours=1)).strftime("%Y/%m/%d %H:%M:%S"),
                            est["latitud"], est["longitud"]]
                    w.writerow(fila)
                    filas += 1
                    if rng.random() < 0.002:         # duplicado
                        w.writerow(fila)
                        filas += 1
        # Filas de otra autoridad ambiental, que el filtro debe descartar
        for h in range(200):
            ini = INICIO + timedelta(hours=h)
            w.writerow(["CAR01", "CORPORACION AUTONOMA REGIONAL DE CUNDINAMARCA", "SOACHA", "PM2.5",
                        25.0, ini.strftime("%Y/%m/%d %H:%M:%S"),
                        (ini + timedelta(hours=1)).strftime("%Y/%m/%d %H:%M:%S"), 4.58, -74.21])
    print(f"CSV simulado: {SALIDA}  ({filas:,} filas)")


if __name__ == "__main__":
    main()
