-- Seed Data: CEA Locations and Colonias for find_nearest_locations tool
-- Coordinates sourced from Google Maps / CEA official site for Querétaro, Mexico
-- Run after 001_cea_locations.sql
-- Idempotent: uses ON CONFLICT DO UPDATE
--
-- NOTE: Oficina Central at Av. 5 de Febrero 35 CLOSED to public Feb 2023.
-- All public services moved to the 5 metropolitan branch offices below.
-- Coordinates should be verified against Google Maps before production.

-- ============================================
-- CEA OFFICES (Sucursales) — 5 active branches
-- ============================================

INSERT INTO cea_locations (slug, name, tipo, address_street, colonia, municipio, codigo_postal, geom, horario, telefono, servicios, notas)
VALUES
    ('plaza-escobedo', 'Sucursal Plaza Escobedo', 'oficina',
     'Calle Vicente Guerrero Sur 81, Local 24-25, Plaza Escobedo', 'Centro', 'Queretaro', '76000',
     ST_MakePoint(-100.3942, 20.5908)::geography,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Zona Centro, cerca del Mercado Escobedo'),

    ('plaza-candiles', 'Sucursal Plaza Candiles', 'oficina',
     'Av. Prolongación Candiles 204, Local B1-B4, Plaza Candiles', 'Camino Real', 'Corregidora', '76190',
     ST_MakePoint(-100.3987, 20.5498)::geography,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Junto a Cinépolis, zona Corregidora sur'),

    ('plaza-vanne', 'Sucursal Plaza Vanne', 'oficina',
     'Av. Paseo de la Constitución 290, Local 6, Plaza Vanne', 'San Pablo', 'Queretaro', '76125',
     ST_MakePoint(-100.4074, 20.6292)::geography,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Rumbo a UTEQ, zona poniente-norte'),

    ('plaza-altamira', 'Sucursal Plaza Altamira', 'oficina',
     'Av. de la Luz 1610, Local 13, Plaza Altamira', 'Vistas del Valle', 'Queretaro', '76116',
     ST_MakePoint(-100.4489, 20.6378)::geography,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0066',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Zona norte, Geovillas/Vistas del Valle'),

    ('pabellon-campestre', 'Sucursal Pabellón Campestre', 'oficina',
     'Prolongación Zaragoza 10, Local 12, Pabellón Campestre', 'Villas Campestre', 'Corregidora', '76902',
     ST_MakePoint(-100.4253, 20.5339)::geography,
     '{"lun_vie":"08:00-17:00","sab":null,"dom":null}',
     '442-211-0600',
     '["pagos","tramites","consultas","contratos","convenios","reportes"]',
     'Frente a instalaciones deportivas ITQ, Corregidora')

ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    tipo = EXCLUDED.tipo,
    address_street = EXCLUDED.address_street,
    colonia = EXCLUDED.colonia,
    municipio = EXCLUDED.municipio,
    codigo_postal = EXCLUDED.codigo_postal,
    geom = EXCLUDED.geom,
    horario = EXCLUDED.horario,
    telefono = EXCLUDED.telefono,
    servicios = EXCLUDED.servicios,
    notas = EXCLUDED.notas,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- CEA CAJEROS / CEAMáticos (Automated Payment Kiosks)
-- ============================================

INSERT INTO cea_locations (slug, name, tipo, address_street, colonia, municipio, codigo_postal, geom, horario, telefono, servicios, notas)
VALUES
    ('ceamatico-sostenes-rocha', 'CEAmático Sostenes Rocha', 'cajero',
     'Sostenes Rocha 29', 'Centro', 'Queretaro', '76000',
     ST_MakePoint(-100.3960, 20.5943)::geography,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL,
     '["pagos"]',
     'Pago con tarjeta débito/crédito, consulta de saldo'),

    ('ceamatico-fernando-tapia', 'CEAmático Fernando de Tapia', 'cajero',
     'Fernando de Tapia 46', 'Centro', 'Queretaro', '76000',
     ST_MakePoint(-100.3945, 20.5932)::geography,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL,
     '["pagos"]',
     'Pago con tarjeta débito/crédito, consulta de saldo'),

    ('ceamatico-plaza-escobedo', 'CEAmático Plaza Escobedo', 'cajero',
     'Calle Vicente Guerrero Sur 81, Plaza Escobedo', 'Centro', 'Queretaro', '76000',
     ST_MakePoint(-100.3942, 20.5908)::geography,
     '{"lun_vie":"08:00-19:00","sab":"08:00-19:00","dom":"08:00-19:00"}',
     NULL,
     '["pagos"]',
     'Dentro de Plaza Escobedo, junto a sucursal'),

    ('ceamatico-plaza-vanne', 'CEAmático Plaza Vanne', 'cajero',
     'Av. Paseo de la Constitución 290, Plaza Vanne', 'San Pablo', 'Queretaro', '76125',
     ST_MakePoint(-100.4074, 20.6292)::geography,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL,
     '["pagos"]',
     'Dentro de Plaza Vanne, junto a sucursal'),

    ('ceamatico-plaza-sol', 'CEAmático Plaza del Sol', 'cajero',
     'Plaza El Sol, Local R', 'El Sol', 'Queretaro', '76113',
     ST_MakePoint(-100.3750, 20.5750)::geography,
     '{"lun_vie":"08:00-20:00","sab":"08:00-20:00","dom":"08:00-20:00"}',
     NULL,
     '["pagos"]',
     'Pago con tarjeta débito/crédito, consulta de saldo')

ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    tipo = EXCLUDED.tipo,
    address_street = EXCLUDED.address_street,
    colonia = EXCLUDED.colonia,
    municipio = EXCLUDED.municipio,
    codigo_postal = EXCLUDED.codigo_postal,
    geom = EXCLUDED.geom,
    horario = EXCLUDED.horario,
    telefono = EXCLUDED.telefono,
    servicios = EXCLUDED.servicios,
    notas = EXCLUDED.notas,
    updated_at = CURRENT_TIMESTAMP;

-- Deactivate the old Oficina Central (5 de Febrero) if it was previously inserted
UPDATE cea_locations SET is_active = false, notas = 'CERRADA al público desde febrero 2023. Servicios trasladados a las 5 sucursales metropolitanas.'
WHERE slug = 'oficina-central';

-- ============================================
-- COLONIAS / ZONES (for colonia-based location search)
-- Coordinates are approximate geographic centers
-- ============================================

INSERT INTO colonias_zones (name, name_normalized, aliases, zona, municipio, center)
VALUES
    ('Centro', 'centro', '["centro historico","centro qro"]', 'centro', 'Queretaro',
     ST_MakePoint(-100.3881, 20.5881)::geography),

    ('Juriquilla', 'juriquilla', '["juriquilla qro"]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4557, 20.7128)::geography),

    ('El Pueblito', 'el pueblito', '["pueblito"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4411, 20.5397)::geography),

    ('Milenio III', 'milenio iii', '["milenio 3","milenio tercera seccion"]', 'este', 'Queretaro',
     ST_MakePoint(-100.3400, 20.5964)::geography),

    ('Arboledas', 'arboledas', '[]', 'centro', 'Queretaro',
     ST_MakePoint(-100.3980, 20.6050)::geography),

    ('Corregidora Centro', 'corregidora centro', '["corregidora"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4411, 20.5397)::geography),

    ('San Pablo', 'san pablo', '[]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4074, 20.6292)::geography),

    ('Villas del Sol', 'villas del sol', '[]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3750, 20.5750)::geography),

    ('Candiles', 'candiles', '["fracc candiles"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4047, 20.5439)::geography),

    ('Real de Juriquilla', 'real de juriquilla', '[]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4656, 20.7208)::geography),

    ('Plaza del Sol', 'plaza del sol', '["plazas del sol"]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3690, 20.5730)::geography),

    ('Zibatá', 'zibata', '["zibata","residencial zibata"]', 'norte', 'El Marques',
     ST_MakePoint(-100.3219, 20.6758)::geography),

    ('La Pradera', 'la pradera', '[]', 'norte', 'El Marques',
     ST_MakePoint(-100.3422, 20.6589)::geography),

    ('Bernardo Quintana', 'bernardo quintana', '["fracc bernardo quintana"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4200, 20.5480)::geography),

    ('Lomas de Casa Blanca', 'lomas de casa blanca', '["casa blanca"]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4100, 20.5780)::geography),

    ('Constituyentes', 'constituyentes', '[]', 'centro', 'Queretaro',
     ST_MakePoint(-100.4060, 20.6026)::geography),

    ('Villas del Mesón', 'villas del meson', '["meson"]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4611, 20.7081)::geography),

    ('El Marqués Centro', 'el marques centro', '["el marques","la canada"]', 'norte', 'El Marques',
     ST_MakePoint(-100.3250, 20.6680)::geography),

    ('Santa Rosa Jáuregui', 'santa rosa jauregui', '["santa rosa"]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4472, 20.7418)::geography),

    ('Loma Dorada', 'loma dorada', '[]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3950, 20.5750)::geography),

    ('Álamos 3ra Sección', 'alamos 3ra seccion', '["alamos","alamos tercera"]', 'centro', 'Queretaro',
     ST_MakePoint(-100.3850, 20.6020)::geography),

    ('Quintas del Marqués', 'quintas del marques', '[]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3667, 20.5842)::geography),

    ('Peñuelas', 'penuelas', '[]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4000, 20.6333)::geography),

    ('Satélite', 'satelite', '["satelite qro"]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4200, 20.5750)::geography),

    ('Cimatario', 'cimatario', '[]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3800, 20.5650)::geography),

    ('Hércules', 'hercules', '[]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4250, 20.5900)::geography),

    ('San Francisquito', 'san francisquito', '[]', 'centro', 'Queretaro',
     ST_MakePoint(-100.3850, 20.5880)::geography),

    ('Vista Alegre', 'vista alegre', '[]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4150, 20.5800)::geography),

    ('Cerro de las Campanas', 'cerro de las campanas', '["campanas","las campanas"]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4130, 20.5950)::geography),

    ('Colinas del Cimatario', 'colinas del cimatario', '["colinas"]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3900, 20.5500)::geography),

    ('Tejeda', 'tejeda', '[]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4200, 20.5419)::geography),

    ('Felipe Carrillo Puerto', 'felipe carrillo puerto', '["carrillo puerto"]', 'poniente', 'Queretaro',
     ST_MakePoint(-100.4358, 20.6083)::geography),

    ('Vistas del Valle', 'vistas del valle', '["vistas"]', 'norte', 'Queretaro',
     ST_MakePoint(-100.4489, 20.6378)::geography),

    ('Villas Campestre', 'villas campestre', '["campestre","san jose de los olvera"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.4253, 20.5339)::geography),

    ('El Sol', 'el sol', '[]', 'sur', 'Queretaro',
     ST_MakePoint(-100.3750, 20.5750)::geography),

    ('Camino Real', 'camino real', '["camino real residencial"]', 'sur', 'Corregidora',
     ST_MakePoint(-100.3987, 20.5498)::geography)

ON CONFLICT DO NOTHING;
