-- Migration: Remove PostGIS dependency — use plain lat/lng columns
-- The AWS database doesn't have PostGIS installed. This migration:
-- 1. Recreates tables with lat/lng DOUBLE PRECISION columns instead of GEOGRAPHY
-- 2. Re-seeds all location data
-- 3. Keeps pg_trgm for fuzzy colonia matching (no PostGIS needed)
--
-- IMPORTANT: Run this INSTEAD of 001 + 002 on fresh AWS installs.
-- On existing installs with PostGIS tables, drop them first:
--   DROP TABLE IF EXISTS cea_locations CASCADE;
--   DROP TABLE IF EXISTS colonias_zones CASCADE;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- CEA LOCATIONS (offices, kiosks)
-- ============================================

CREATE TABLE IF NOT EXISTS cea_locations (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    address_street VARCHAR(255) NOT NULL,
    colonia VARCHAR(100) NOT NULL,
    municipio VARCHAR(100) DEFAULT 'Queretaro',
    codigo_postal VARCHAR(10),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    horario JSONB NOT NULL DEFAULT '{}',
    telefono VARCHAR(20),
    servicios JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cea_locations_tipo ON cea_locations(tipo) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cea_locations_lat_lng ON cea_locations(lat, lng);

-- ============================================
-- COLONIAS / ZONES
-- ============================================

CREATE TABLE IF NOT EXISTS colonias_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    name_normalized VARCHAR(150) NOT NULL,
    aliases JSONB DEFAULT '[]',
    zona VARCHAR(50),
    municipio VARCHAR(100) DEFAULT 'Queretaro',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_colonias_name_norm ON colonias_zones(name_normalized);
CREATE INDEX IF NOT EXISTS idx_colonias_name_trgm ON colonias_zones USING GIN(name_normalized gin_trgm_ops);

-- ============================================
-- SEED: CEA Offices
-- ============================================

INSERT INTO cea_locations (slug, name, tipo, address_street, colonia, municipio, codigo_postal, lat, lng, horario, telefono, servicios, notas)
VALUES
    ('plaza-escobedo', 'Sucursal Plaza Escobedo', 'oficina',
     'Calle Vicente Guerrero Sur 81, Local 24-25, Plaza Escobedo', 'Centro', 'Queretaro', '76000',
     20.5908, -100.3942,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Zona Centro, cerca del Mercado Escobedo'),

    ('plaza-candiles', 'Sucursal Plaza Candiles', 'oficina',
     'Av. Prolongación Candiles 204, Local B1-B4, Plaza Candiles', 'Camino Real', 'Corregidora', '76190',
     20.5498, -100.3987,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Junto a Cinépolis, zona Corregidora sur'),

    ('plaza-vanne', 'Sucursal Plaza Vanne', 'oficina',
     'Av. Paseo de la Constitución 290, Local 6, Plaza Vanne', 'San Pablo', 'Queretaro', '76125',
     20.6292, -100.4074,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Rumbo a UTEQ, zona poniente-norte'),

    ('plaza-altamira', 'Sucursal Plaza Altamira', 'oficina',
     'Av. de la Luz 1610, Local 13, Plaza Altamira', 'Vistas del Valle', 'Queretaro', '76116',
     20.6378, -100.4489,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Zona norte, Geovillas/Vistas del Valle'),

    ('pabellon-campestre', 'Sucursal Pabellon Campestre', 'oficina',
     'Prolongación Zaragoza 10, Local 12, Pabellon Campestre', 'Villas Campestre', 'Corregidora', '76902',
     20.5339, -100.4253,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0600',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Frente a instalaciones deportivas ITQ, Corregidora')

ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, tipo = EXCLUDED.tipo, address_street = EXCLUDED.address_street,
    colonia = EXCLUDED.colonia, municipio = EXCLUDED.municipio, codigo_postal = EXCLUDED.codigo_postal,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, horario = EXCLUDED.horario,
    telefono = EXCLUDED.telefono, servicios = EXCLUDED.servicios, notas = EXCLUDED.notas,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- SEED: CEAmáticos (Automated Payment Kiosks)
-- ============================================

INSERT INTO cea_locations (slug, name, tipo, address_street, colonia, municipio, codigo_postal, lat, lng, horario, telefono, servicios, notas)
VALUES
    ('ceamatico-sostenes-rocha', 'CEAmatico Sostenes Rocha', 'cajero',
     'Sostenes Rocha 29', 'Centro', 'Queretaro', '76000',
     20.5943, -100.3960,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL, '["pagos"]', 'Pago con tarjeta debito/credito, consulta de saldo'),

    ('ceamatico-fernando-tapia', 'CEAmatico Fernando de Tapia', 'cajero',
     'Fernando de Tapia 46', 'Centro', 'Queretaro', '76000',
     20.5932, -100.3945,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL, '["pagos"]', 'Pago con tarjeta debito/credito, consulta de saldo'),

    ('ceamatico-plaza-escobedo', 'CEAmatico Plaza Escobedo', 'cajero',
     'Calle Vicente Guerrero Sur 81, Plaza Escobedo', 'Centro', 'Queretaro', '76000',
     20.5908, -100.3942,
     '{"lun_vie":"08:00-19:00","sab":"08:00-19:00","dom":"08:00-19:00"}',
     NULL, '["pagos"]', 'Dentro de Plaza Escobedo, junto a sucursal'),

    ('ceamatico-plaza-vanne', 'CEAmatico Plaza Vanne', 'cajero',
     'Av. Paseo de la Constitucion 290, Plaza Vanne', 'San Pablo', 'Queretaro', '76125',
     20.6292, -100.4074,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL, '["pagos"]', 'Dentro de Plaza Vanne, junto a sucursal'),

    ('ceamatico-plaza-sol', 'CEAmatico Plaza del Sol', 'cajero',
     'Plaza El Sol, Local R', 'El Sol', 'Queretaro', '76113',
     20.5750, -100.3750,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL, '["pagos"]', 'Pago con tarjeta debito/credito, consulta de saldo')

ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, tipo = EXCLUDED.tipo, address_street = EXCLUDED.address_street,
    colonia = EXCLUDED.colonia, municipio = EXCLUDED.municipio, codigo_postal = EXCLUDED.codigo_postal,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, horario = EXCLUDED.horario,
    telefono = EXCLUDED.telefono, servicios = EXCLUDED.servicios, notas = EXCLUDED.notas,
    updated_at = CURRENT_TIMESTAMP;

UPDATE cea_locations SET is_active = false, notas = 'CERRADA al publico desde febrero 2023.'
WHERE slug = 'oficina-central';

-- ============================================
-- SEED: Colonias
-- ============================================

INSERT INTO colonias_zones (name, name_normalized, aliases, zona, municipio, lat, lng)
VALUES
    ('Centro', 'centro', '["centro historico","centro qro"]', 'centro', 'Queretaro', 20.5881, -100.3881),
    ('Juriquilla', 'juriquilla', '["juriquilla qro"]', 'norte', 'Queretaro', 20.7128, -100.4557),
    ('El Pueblito', 'el pueblito', '["pueblito"]', 'sur', 'Corregidora', 20.5397, -100.4411),
    ('Milenio III', 'milenio iii', '["milenio 3","milenio tercera seccion"]', 'este', 'Queretaro', 20.5964, -100.3400),
    ('Arboledas', 'arboledas', '[]', 'centro', 'Queretaro', 20.6050, -100.3980),
    ('Corregidora Centro', 'corregidora centro', '["corregidora"]', 'sur', 'Corregidora', 20.5397, -100.4411),
    ('San Pablo', 'san pablo', '[]', 'poniente', 'Queretaro', 20.6292, -100.4074),
    ('Villas del Sol', 'villas del sol', '[]', 'sur', 'Queretaro', 20.5750, -100.3750),
    ('Candiles', 'candiles', '["fracc candiles"]', 'sur', 'Corregidora', 20.5439, -100.4047),
    ('Real de Juriquilla', 'real de juriquilla', '[]', 'norte', 'Queretaro', 20.7208, -100.4656),
    ('Plaza del Sol', 'plaza del sol', '["plazas del sol"]', 'sur', 'Queretaro', 20.5730, -100.3690),
    ('Zibata', 'zibata', '["zibata","residencial zibata"]', 'norte', 'El Marques', 20.6758, -100.3219),
    ('La Pradera', 'la pradera', '[]', 'norte', 'El Marques', 20.6589, -100.3422),
    ('Bernardo Quintana', 'bernardo quintana', '["fracc bernardo quintana"]', 'sur', 'Corregidora', 20.5480, -100.4200),
    ('Lomas de Casa Blanca', 'lomas de casa blanca', '["casa blanca"]', 'poniente', 'Queretaro', 20.5780, -100.4100),
    ('Constituyentes', 'constituyentes', '[]', 'centro', 'Queretaro', 20.6026, -100.4060),
    ('Villas del Meson', 'villas del meson', '["meson"]', 'norte', 'Queretaro', 20.7081, -100.4611),
    ('El Marques Centro', 'el marques centro', '["el marques","la canada"]', 'norte', 'El Marques', 20.6680, -100.3250),
    ('Santa Rosa Jauregui', 'santa rosa jauregui', '["santa rosa"]', 'norte', 'Queretaro', 20.7418, -100.4472),
    ('Loma Dorada', 'loma dorada', '[]', 'sur', 'Queretaro', 20.5750, -100.3950),
    ('Alamos 3ra Seccion', 'alamos 3ra seccion', '["alamos","alamos tercera"]', 'centro', 'Queretaro', 20.6020, -100.3850),
    ('Quintas del Marques', 'quintas del marques', '[]', 'sur', 'Queretaro', 20.5842, -100.3667),
    ('Penuelas', 'penuelas', '[]', 'norte', 'Queretaro', 20.6333, -100.4000),
    ('Satelite', 'satelite', '["satelite qro"]', 'poniente', 'Queretaro', 20.5750, -100.4200),
    ('Cimatario', 'cimatario', '[]', 'sur', 'Queretaro', 20.5650, -100.3800),
    ('Hercules', 'hercules', '[]', 'poniente', 'Queretaro', 20.5900, -100.4250),
    ('San Francisquito', 'san francisquito', '[]', 'centro', 'Queretaro', 20.5880, -100.3850),
    ('Vista Alegre', 'vista alegre', '[]', 'poniente', 'Queretaro', 20.5800, -100.4150),
    ('Cerro de las Campanas', 'cerro de las campanas', '["campanas","las campanas"]', 'poniente', 'Queretaro', 20.5950, -100.4130),
    ('Colinas del Cimatario', 'colinas del cimatario', '["colinas"]', 'sur', 'Queretaro', 20.5500, -100.3900),
    ('Tejeda', 'tejeda', '[]', 'sur', 'Corregidora', 20.5419, -100.4200),
    ('Felipe Carrillo Puerto', 'felipe carrillo puerto', '["carrillo puerto"]', 'poniente', 'Queretaro', 20.6083, -100.4358),
    ('Vistas del Valle', 'vistas del valle', '["vistas"]', 'norte', 'Queretaro', 20.6378, -100.4489),
    ('Villas Campestre', 'villas campestre', '["campestre","san jose de los olvera"]', 'sur', 'Corregidora', 20.5339, -100.4253),
    ('El Sol', 'el sol', '[]', 'sur', 'Queretaro', 20.5750, -100.3750),
    ('Camino Real', 'camino real', '["camino real residencial"]', 'sur', 'Corregidora', 20.5498, -100.3987)

ON CONFLICT DO NOTHING;
