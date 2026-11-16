# 🌫️ Aire Visible: los días que la norma no ve

Aplicación web con servidor para analizar el **PM2.5 en Bogotá** por estación y localidad.
Compara cada día con la **guía de la OMS (15 µg/m³)** y con la **norma colombiana (37 µg/m³, Res. 2254/2017)**,
y calcula la **exposición personal** de cada usuario según su rutina.

> Proyecto de Habilidades Investigativas · Ingeniería de Software · Universidad de La Salle
> Joan Nicolás Rey Gómez · Juan Ángel Gutiérrez Barreto

---

## ¿Qué hace?

| Módulo | Qué muestra | Responde a… |
|---|---|---|
| **Panorama** | Mapa de estaciones, ranking de localidades, tendencia mensual y la "brecha invisible" | 1.ª parte de la pregunta de investigación |
| **Semáforo del día** | Promedio de 24 h (solo con ≥ 18 h válidas), semáforo, regla OMS/norma y gráfico hora por hora | Objetivo específico 3 |
| **Calendario** | Todo un año en colores (verde / invisible / rojo) y rachas | Análisis exploratorio |
| **Mi aire** ⭐ | Exposición personal según dónde vive, estudia y entrena; días invisibles vividos; equivalencia en cigarrillos; sugerencia de mejor hora para entrenar | Lo innovador frente al IBOCA |
| **Mejor momento** | Mapa de calor día × hora con las horas más limpias | Toma de decisiones |
| **Alertas** | Pronóstico de PM2.5 (Open-Meteo / CAMS), alertas por Telegram y validación del pronóstico | Evaluación |
| **Metodología** | Etapas, umbrales, fuentes y estadísticas de uso | Trazabilidad |

**Día invisible** = día que **cumple la norma colombiana pero supera la guía de la OMS** (15 < PM2.5 ≤ 37 µg/m³).

---

## Arquitectura

```
Navegador (HTML + CSS + JavaScript, gráficos SVG propios)
        │  fetch /api/...
        ▼
Servidor FastAPI (Python)  ──►  Open-Meteo (pronóstico)  ──►  Telegram (alertas)
        │  SQL
        ▼
Base de datos SQLite (12 tablas)  ◄──  CSV del IDEAM (datos.gov.co)
```

```
airevisible/
├── backend/
│   ├── app/
│   │   ├── main.py          ← API REST (endpoints)
│   │   ├── services.py      ← cálculos: promedios, semáforo, exposición, mejor hora
│   │   ├── alertas.py       ← pronóstico, Telegram y validación
│   │   ├── db.py            ← conexión y umbrales
│   │   └── schema.sql       ← modelo entidad-relación
│   ├── scripts/
│   │   ├── cargar_datos_ideam.py    ← Etapas 1-2: filtra y limpia el CSV real
│   │   ├── generar_datos_ejemplo.py ← datos SIMULADOS para pruebas
│   │   └── exportar_demo.py         ← versión de un solo archivo (sin servidor)
│   ├── data/estaciones_localidades.csv  ← tabla de apoyo estación → localidad
│   ├── tests/test_calculos.py   ← Etapa 5: verificación de cálculos a mano
│   └── requirements.txt
└── frontend/  (index.html, css/, js/)
```

---

## Cómo ejecutarla (Windows, Mac o Linux)

Necesitan **Python 3.10 o superior** (https://www.python.org/downloads/ — en Windows marquen *Add Python to PATH*).

```bash
cd airevisible/backend
pip install -r requirements.txt
```

**1. Cargar datos.** Opción A: datos de prueba (simulados):
```bash
python scripts/generar_datos_ejemplo.py
python scripts/cargar_datos_ideam.py data/ideam_ejemplo_simulado.csv
```
Opción B: **datos reales del IDEAM** (lo que va en la entrega final):
1. Entren a https://www.datos.gov.co/Ambiente-y-Desarrollo-Sostenible/Calidad-del-Aire-en-Colombia/g4t8-zkc3
2. Filtren por Bogotá, PM2.5 y los últimos 3 años, y exporten en **CSV**.
3. Borren `data/airevisible.db` si existe y ejecuten:
```bash
python scripts/cargar_datos_ideam.py ruta/al/archivo_descargado.csv --desde 2024-01-01
```
> **Control de calidad (hallazgo del proyecto).** En el archivo descargado el 15/11/2026, entre 2020 y 2023 varias estaciones
> (Kennedy, Puente Aranda, Fontibón, Bolivia, Usme, entre otras) reportan valores de 100–250 µg/m³, unas 10 veces lo normal,
> con saltos abruptos de un mes a otro y todos sin decimales; desde 2024 los valores traen decimales y son coherentes.
> Por eso el análisis usa **2024–2025**. Sin `--desde`, el script descarta automáticamente los meses-estación con mediana
> mayor a 60 µg/m³ y los lista en `data/reporte_calidad.csv` (300 meses, todos de 2020–2023).
El script imprime un **reporte de limpieza** (filas iniciales, tras filtros, tras quitar vacíos/negativos/duplicados), que pueden pegar en el informe.
Si dice que alguna estación no tiene localidad, agréguenla a `data/estaciones_localidades.csv` y verifiquen ahí las coordenadas, que son aproximadas.

**2. Encender el servidor:**
```bash
uvicorn app.main:app --reload
```
**3. Abrir** http://localhost:8000 (la app) y http://localhost:8000/docs (documentación automática de la API, ideal para la sustentación).

**4. Probar los cálculos:**
```bash
python tests/test_calculos.py
```

### Alertas por Telegram (opcional)
1. En Telegram hablen con **@BotFather**, `/newbot`, y copien el token.
2. Antes de encender el servidor: `set TELEGRAM_TOKEN=el_token` (Windows) o `export TELEGRAM_TOKEN=el_token` (Mac/Linux).
3. En la app: *Mi aire* → crear perfil, luego *Alertas* → poner el chat id.
4. Una vez al día: `python -m app.alertas` (o el botón *Ejecutar revisión ahora*).

### Publicarla en internet (opcional)
El backend corre en cualquier servicio que acepte Python (por ejemplo Render o Railway) con el comando
`uvicorn app.main:app --host 0.0.0.0 --port $PORT` desde la carpeta `backend`.
Para producción se puede cambiar SQLite por PostgreSQL (el `schema.sql` indica el único cambio necesario).

---

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/resumen` | Indicadores de la ciudad (último año) |
| GET | `/api/ranking/localidades` | Días verdes / invisibles / rojos por localidad |
| GET | `/api/semaforo?fecha=2026-03-10&localidad=Kennedy` | Promedio 24 h + semáforo |
| GET | `/api/calendario?anio=2025&localidad=Bosa` | Semáforo de todo un año |
| GET | `/api/mejor-momento?localidad=Suba` | Mapa de calor día × hora |
| POST | `/api/exposicion` | Exposición personal según la rutina |
| POST | `/api/usuarios` | Crear usuario con rutina |
| GET | `/api/pronostico?localidad=Kennedy` | Pronóstico de 4 días |
| GET | `/api/validacion-pronostico` | Error del pronóstico vs. lo medido |

---

## ⚠️ Sobre los datos de ejemplo
`generar_datos_ejemplo.py` crea datos **simulados** con el formato del IDEAM para poder programar y probar.
Imitan patrones conocidos (más contaminación en el suroccidente, pico en la mañana, temporada seca), pero **no son mediciones reales**.
La app muestra la etiqueta "Datos simulados de prueba" mientras se usen. Los resultados del informe deben salir del CSV real.

## Fuentes
- IDEAM (2026). *Calidad del Aire en Colombia* [conjunto de datos]. datos.gov.co (g4t8-zkc3).
- OMS (2021). *Directrices mundiales de la OMS sobre la calidad del aire.*
- MinAmbiente (2017). *Resolución 2254 de 2017.*
- Open-Meteo. *Air Quality API* (modelo CAMS de Copernicus).
- Berkeley Earth. Equivalencia aproximada PM2.5–cigarrillos (22 µg/m³ ≈ 1 cigarrillo/día).
