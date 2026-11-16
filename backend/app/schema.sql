-- =====================================================================
--  AIRE VISIBLE — Modelo relacional (SQLite; compatible con PostgreSQL
--  cambiando INTEGER PRIMARY KEY AUTOINCREMENT por SERIAL PRIMARY KEY)
-- =====================================================================

-- 1. Localidades de Bogotá que tienen al menos una estación RMCAB
CREATE TABLE IF NOT EXISTS localidad (
    localidad_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT NOT NULL UNIQUE,
    zona           TEXT                      -- Norte, Sur, Centro, Occidente...
);

-- 2. Estaciones de monitoreo (tabla de apoyo estación → localidad)
CREATE TABLE IF NOT EXISTS estacion (
    estacion_id    INTEGER PRIMARY KEY,
    nombre         TEXT NOT NULL,
    localidad_id   INTEGER NOT NULL REFERENCES localidad(localidad_id),
    latitud        REAL,
    longitud       REAL
);

-- 3. Contaminantes (el proyecto usa PM2.5, pero el modelo admite otros)
CREATE TABLE IF NOT EXISTS contaminante (
    contaminante_id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo          TEXT NOT NULL UNIQUE,   -- MSFL_CODE en el CSV del IDEAM
    nombre          TEXT NOT NULL,
    unidad          TEXT NOT NULL DEFAULT 'µg/m³'
);

-- 4. Mediciones horarias ya limpias (sin nulos, negativos ni duplicados)
CREATE TABLE IF NOT EXISTS medicion (
    medicion_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    estacion_id     INTEGER NOT NULL REFERENCES estacion(estacion_id),
    contaminante_id INTEGER NOT NULL REFERENCES contaminante(contaminante_id),
    fecha_hora      TEXT NOT NULL,          -- 'YYYY-MM-DD HH:00'
    valor           REAL NOT NULL CHECK (valor >= 0),
    UNIQUE (estacion_id, contaminante_id, fecha_hora)
);
CREATE INDEX IF NOT EXISTS ix_medicion_est_fecha ON medicion(estacion_id, fecha_hora);

-- 5. Promedios diarios precalculados (solo días con >= 18 horas válidas)
CREATE TABLE IF NOT EXISTS promedio_diario (
    estacion_id     INTEGER NOT NULL REFERENCES estacion(estacion_id),
    contaminante_id INTEGER NOT NULL REFERENCES contaminante(contaminante_id),
    fecha           TEXT NOT NULL,          -- 'YYYY-MM-DD'
    promedio        REAL NOT NULL,
    horas_validas   INTEGER NOT NULL,
    PRIMARY KEY (estacion_id, contaminante_id, fecha)
);

-- 6. Límites de referencia: OMS 2021 y Resolución 2254 de 2017
CREATE TABLE IF NOT EXISTS limite_referencia (
    limite_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    contaminante_id INTEGER NOT NULL REFERENCES contaminante(contaminante_id),
    fuente          TEXT NOT NULL,          -- 'OMS 2021' / 'Res. 2254/2017'
    periodo         TEXT NOT NULL,          -- '24h' / 'anual'
    valor           REAL NOT NULL,
    color_semaforo  TEXT NOT NULL           -- color que se activa al superarlo
);

-- 7. Usuarios de la app (perfil para personalizar la exposición)
CREATE TABLE IF NOT EXISTS usuario (
    usuario_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    alias             TEXT NOT NULL,
    perfil_salud      TEXT NOT NULL DEFAULT 'general', -- general, asma, nino, adulto_mayor, embarazo
    actividad         TEXT NOT NULL DEFAULT 'caminar', -- caminar, correr, bici
    telegram_chat_id  TEXT,
    creado_en         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Rutina del usuario: dónde está a cada franja del día
CREATE TABLE IF NOT EXISTS rutina (
    rutina_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
    localidad_id    INTEGER NOT NULL REFERENCES localidad(localidad_id),
    tipo            TEXT NOT NULL,          -- casa, estudio, trabajo, ejercicio
    hora_inicio     INTEGER NOT NULL CHECK (hora_inicio BETWEEN 0 AND 23),
    hora_fin        INTEGER NOT NULL CHECK (hora_fin BETWEEN 1 AND 24),
    dias            TEXT NOT NULL DEFAULT '0123456' -- 0=lunes ... 6=domingo
);

-- 9. Historial de consultas (requisito del anteproyecto)
CREATE TABLE IF NOT EXISTS consulta_usuario (
    consulta_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuario(usuario_id),
    tipo            TEXT NOT NULL,          -- semaforo, exposicion, mejor_hora...
    parametros      TEXT NOT NULL,          -- JSON con lo consultado
    resultado       TEXT,                   -- color o resumen
    fecha_consulta  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Pronósticos guardados (para validar el pronóstico contra lo medido)
CREATE TABLE IF NOT EXISTS pronostico (
    localidad_id    INTEGER NOT NULL REFERENCES localidad(localidad_id),
    fecha_objetivo  TEXT NOT NULL,          -- día pronosticado
    fecha_emision   TEXT NOT NULL,          -- cuándo se descargó
    pm25_promedio   REAL NOT NULL,
    fuente          TEXT NOT NULL DEFAULT 'Open-Meteo / CAMS',
    PRIMARY KEY (localidad_id, fecha_objetivo, fecha_emision)
);

-- 11. Alertas enviadas a usuarios
CREATE TABLE IF NOT EXISTS alerta (
    alerta_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
    fecha_objetivo  TEXT NOT NULL,
    nivel           TEXT NOT NULL,          -- amarillo / rojo
    mensaje         TEXT NOT NULL,
    enviada         INTEGER NOT NULL DEFAULT 0,
    creada_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. Registro de cargas de datos (trazabilidad de la fuente, Etapa 1)
CREATE TABLE IF NOT EXISTS carga_datos (
    carga_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    archivo         TEXT NOT NULL,
    fecha_carga     TEXT NOT NULL DEFAULT (datetime('now')),
    filas_limpias   INTEGER NOT NULL,
    simulado        INTEGER NOT NULL DEFAULT 0
);
