"""
Genera una versión de DEMOSTRACIÓN de un solo archivo (sin servidor) para
mostrar la app en línea: frontend + datos precalculados en un único HTML.

Uso:  python scripts/exportar_demo.py  [salida.html]
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db, services  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
FRONT = RAIZ / "frontend"
SALIDA = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "dist" / "aire-visible-demo.html"


def main():
    con = db.conectar()
    db.inicializar(con)
    desde, hasta = services.rango_datos(con)
    ini_anio, _ = services._ultimo_anio(con)
    locs = services.localidades(con)
    info = {"desde": desde, "hasta": hasta, "oms_24h": db.OMS_24H, "norma_24h": db.NORMA_24H,
            "horas_minimas": db.HORAS_MINIMAS, "datos_simulados": services.datos_simulados(con),
            "perfiles": services.PERFILES, "localidades": locs, "estaciones": services.estaciones(con)}

    d0 = date.fromisoformat(desde)
    n_dias = (date.fromisoformat(hasta) - d0).days + 1
    diario, horario, tendencia = {}, {}, {"": services.tendencia_mensual(con)}
    a0 = date.fromisoformat(ini_anio)
    n_h = ((date.fromisoformat(hasta) - a0).days + 1) * 24
    for l in locs:
        nombre, lid = l["nombre"], l["localidad_id"]
        tendencia[nombre] = services.tendencia_mensual(con, nombre)
        v = [-1] * n_dias
        for f in con.execute("""SELECT p.fecha, AVG(p.promedio) FROM promedio_diario p JOIN estacion e USING(estacion_id)
                                WHERE e.localidad_id = ? GROUP BY p.fecha""", (lid,)):
            v[(date.fromisoformat(f[0]) - d0).days] = round(f[1] * 10)
        diario[nombre] = {"inicio": desde, "v": v}
        h = [-1] * n_h
        for fh, val in services._serie_horaria_localidad(con, lid, ini_anio, hasta).items():
            i = (date.fromisoformat(fh[:10]) - a0).days * 24 + int(fh[11:13])
            h[i] = round(val * 10)
        horario[nombre] = {"inicio": ini_anio, "v": h}

    data = {"info": info, "resumen": services.resumen(con), "ranking_estaciones": services.ranking_estaciones(con),
            "ranking_localidades": services.ranking_localidades(con), "tendencia": tendencia,
            "diario": diario, "horario": horario, "horario_desde": ini_anio}
    con.rollback()  # las funciones registran consultas; no guardar las de la exportación

    html = (FRONT / "index.html").read_text(encoding="utf-8")
    css = (FRONT / "css" / "styles.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/styles.css">', f"<style>\n{css}\n</style>")
    datos = "window.DEMO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    scripts = f"<script>{datos}</script>\n"
    for js in ["charts.js", "demo.js", "app.js"]:
        scripts += f"<script>\n{(FRONT / 'js' / js).read_text(encoding='utf-8')}\n</script>\n"
    html = re.sub(r'\s*<script src="js/charts.js"></script>\s*<script src="js/demo.js"></script>\s*<script src="js/app.js"></script>',
                  lambda m: "\n" + scripts, html)
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(html, encoding="utf-8")
    print(f"Demo: {SALIDA} ({SALIDA.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
