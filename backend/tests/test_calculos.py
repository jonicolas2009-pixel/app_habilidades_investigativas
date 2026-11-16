"""
ETAPA 5 DEL ANTEPROYECTO: verificación de los cálculos "a mano".

Se crea una base de datos pequeña con valores conocidos y se comprueba que la
app calcula exactamente lo que daría una calculadora.

Ejecutar desde backend/:   python -m pytest tests -v     (o: python tests/test_calculos.py)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db, services  # noqa: E402


def base_prueba():
    con = db.conectar(":memory:")
    db.inicializar(con)
    pm = db.id_contaminante(con)
    filas = []
    # Día 1 (Kennedy, est. 8214): 24 horas con valor 20 -> promedio 20 -> amarillo (día invisible)
    filas += [(8214, pm, f"2026-01-05 {h:02d}:00", 20.0) for h in range(24)]
    # Día 2: 12 horas a 10 y 12 horas a 50 -> promedio 30 -> amarillo
    filas += [(8214, pm, f"2026-01-06 {h:02d}:00", 10.0 if h < 12 else 50.0) for h in range(24)]
    # Día 3: solo 17 horas válidas -> NO se calcula promedio (regla de 18 horas)
    filas += [(8214, pm, f"2026-01-07 {h:02d}:00", 80.0) for h in range(17)]
    # Día 4: 18 horas a 40 -> promedio 40 -> rojo
    filas += [(8214, pm, f"2026-01-08 {h:02d}:00", 40.0) for h in range(18)]
    # Día 5: 24 horas a 12 -> verde
    filas += [(8214, pm, f"2026-01-09 {h:02d}:00", 12.0) for h in range(24)]
    # Carvajal (est. 8218, también Kennedy) el día 1: 24 h a 30 -> localidad = (20 + 30) / 2 = 25
    filas += [(8218, pm, f"2026-01-05 {h:02d}:00", 30.0) for h in range(24)]
    con.executemany("INSERT INTO medicion(estacion_id, contaminante_id, fecha_hora, valor) VALUES (?,?,?,?)", filas)
    db.recalcular_promedios(con)
    return con


def test_semaforo_umbrales():
    assert services.semaforo(15.0)["color"] == "verde"      # 15 exacto cumple la OMS
    assert services.semaforo(15.1)["color"] == "amarillo"
    assert services.semaforo(37.0)["color"] == "amarillo"   # 37 exacto cumple la norma
    assert services.semaforo(37.1)["color"] == "rojo"
    assert services.semaforo(None)["color"] == "gris"


def test_promedio_24h():
    con = base_prueba()
    assert services.consulta_dia(con, "2026-01-05", estacion_id=8214)["promedio_24h"] == 20.0
    assert services.consulta_dia(con, "2026-01-06", estacion_id=8214)["promedio_24h"] == 30.0


def test_regla_18_horas():
    con = base_prueba()
    d3 = services.consulta_dia(con, "2026-01-07", estacion_id=8214)
    assert d3["horas_validas"] == 17 and d3["promedio_24h"] is None
    d4 = services.consulta_dia(con, "2026-01-08", estacion_id=8214)
    assert d4["horas_validas"] == 18 and d4["promedio_24h"] == 40.0
    assert d4["semaforo"]["color"] == "rojo"


def test_promedio_localidad_combina_estaciones():
    con = base_prueba()
    assert services.consulta_dia(con, "2026-01-05", localidad="Kennedy")["promedio_24h"] == 25.0


def test_conteo_dias_invisibles():
    con = base_prueba()
    r = services.resumen(con, "2026-01-01", "2026-01-31")
    # días-estación válidos: est8214 -> 5, 6, 8, 9 ; est8218 -> 5  => 5 en total
    assert r["dias_estacion"] == 5
    assert r["dias_verdes"] == 1        # 12
    assert r["dias_invisibles"] == 3    # 20, 30, 30(Carvajal)
    assert r["dias_rojos"] == 1         # 40


def test_registro_de_consultas():
    con = base_prueba()
    services.consulta_dia(con, "2026-01-05", estacion_id=8214)
    n = con.execute("SELECT COUNT(*) FROM consulta_usuario").fetchone()[0]
    assert n == 1


if __name__ == "__main__":
    for nombre, f in list(globals().items()):
        if nombre.startswith("test_"):
            f()
            print("✔", nombre)
    print("Todas las pruebas pasaron.")
