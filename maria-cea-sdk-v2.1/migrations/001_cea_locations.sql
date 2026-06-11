-- Migration: CEA Locations + Colonias for find_nearest_locations tool
-- Requires: PostGIS extension

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS cea_locations (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    tipo VARCHAR(20) NOT NULL,           -- 'oficina' | 'cajero' | 'autopago'
    address_street VARCHAR(255) NOT NULL,
    colonia VARCHAR(100) NOT NULL,
    municipio VARCHAR(100) DEFAULT 'Queretaro',
    codigo_postal VARCHAR(10),
    geom GEOGRAPHY(POINT, 4326) NOT NULL,
    horario JSONB NOT NULL DEFAULT '{}', -- {"lun_vie":"08:00-17:00","sab":"09:00-16:00","dom":null}
    telefono VARCHAR(20),
    servicios JSONB NOT NULL DEFAULT '[]', -- ["pagos","tramites","consultas"]
    is_active BOOLEAN DEFAULT true,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cea_locations_geom ON cea_locations USING GIST(geom);
CREATE INDEX idx_cea_locations_tipo ON cea_locations(tipo) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS colonias_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    name_normalized VARCHAR(150) NOT NULL,
    aliases JSONB DEFAULT '[]',
    zona VARCHAR(50),
    municipio VARCHAR(100) DEFAULT 'Queretaro',
    center GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_colonias_name_norm ON colonias_zones(name_normalized);
CREATE INDEX idx_colonias_name_trgm ON colonias_zones USING GIN(name_normalized gin_trgm_ops);
CREATE INDEX idx_colonias_center ON colonias_zones USING GIST(center);
