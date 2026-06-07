-- Diesel & Gasoline margin automation — Wave 1: source-table validation seeds.
--
-- Just enough CEPEA + production data to validate recompute_dg_margins() over the
-- 2026 window NOW. Wave 2 scrapers backfill the full history and keep these current.
-- data_semana is the Saturday (ISO week last day) of the quoted week, derived from
-- the unpadded "W/YYYY" key via to_date('IYYY-IW') + 5 days.

-- ---------------------------------------------------------------------------
-- cepea_etanol_anidro — weekly anhydrous ethanol price (R$/L).
-- ---------------------------------------------------------------------------
INSERT INTO public.cepea_etanol_anidro (data_semana, week, preco_rs_litro, fonte)
SELECT
  to_date(split_part(week, '/', 2) || '-' || split_part(week, '/', 1), 'IYYY-IW') + 5 AS data_semana,
  week,
  preco_rs_litro,
  'CEPEA/ESALQ (back-test seed)'
FROM (VALUES
  ('45/2025', 3.2094),
  ('50/2025', 3.3256),
  ('1/2026',  3.3688),
  ('2/2026',  3.4170),
  ('9/2026',  3.2256),
  ('13/2026', 3.3255),
  ('14/2026', 3.3095),
  ('15/2026', 3.1948),
  ('16/2026', 2.9575),
  ('17/2026', 2.8546),
  ('18/2026', 2.6956),
  ('19/2026', 2.6015),
  ('20/2026', 2.5681),
  ('21/2026', 2.5493),
  ('22/2026', 2.5650)
) AS v(week, preco_rs_litro)
ON CONFLICT (data_semana) DO UPDATE
  SET week = EXCLUDED.week, preco_rs_litro = EXCLUDED.preco_rs_litro, fonte = EXCLUDED.fonte;

-- ---------------------------------------------------------------------------
-- anp_producao_derivados — national monthly refined-product production (m3).
-- ---------------------------------------------------------------------------
INSERT INTO public.anp_producao_derivados (ano, mes, produto, volume_m3, fonte) VALUES
  (2025,  1, 'GASOLINA A', 2627996, 'back-test seed'),
  (2025,  1, 'OLEO DIESEL', 3823878, 'back-test seed'),
  (2025,  2, 'GASOLINA A', 2290597, 'back-test seed'),
  (2025,  2, 'OLEO DIESEL', 3560480, 'back-test seed'),
  (2025,  3, 'GASOLINA A', 2584932, 'back-test seed'),
  (2025,  3, 'OLEO DIESEL', 3995103, 'back-test seed'),
  (2025,  4, 'GASOLINA A', 2420219, 'back-test seed'),
  (2025,  4, 'OLEO DIESEL', 3825240, 'back-test seed'),
  (2025,  5, 'GASOLINA A', 2620754, 'back-test seed'),
  (2025,  5, 'OLEO DIESEL', 3806856, 'back-test seed'),
  (2025,  6, 'GASOLINA A', 2499213, 'back-test seed'),
  (2025,  6, 'OLEO DIESEL', 3957043, 'back-test seed'),
  (2025,  7, 'GASOLINA A', 2595920, 'back-test seed'),
  (2025,  7, 'OLEO DIESEL', 4161299, 'back-test seed'),
  (2025,  8, 'GASOLINA A', 2662769, 'back-test seed'),
  (2025,  8, 'OLEO DIESEL', 4339012, 'back-test seed'),
  (2025,  9, 'GASOLINA A', 2451201, 'back-test seed'),
  (2025,  9, 'OLEO DIESEL', 4257655, 'back-test seed'),
  (2025, 10, 'GASOLINA A', 2464806, 'back-test seed'),
  (2025, 10, 'OLEO DIESEL', 4017043, 'back-test seed'),
  (2025, 11, 'GASOLINA A', 2371354, 'back-test seed'),
  (2025, 11, 'OLEO DIESEL', 3727115, 'back-test seed'),
  (2025, 12, 'GASOLINA A', 2550165, 'back-test seed'),
  (2025, 12, 'OLEO DIESEL', 3879001, 'back-test seed'),
  (2026,  1, 'GASOLINA A', 2250472, 'back-test seed'),
  (2026,  1, 'OLEO DIESEL', 3693092, 'back-test seed'),
  (2026,  2, 'GASOLINA A', 2100388, 'back-test seed'),
  (2026,  2, 'OLEO DIESEL', 3756403, 'back-test seed'),
  (2026,  3, 'GASOLINA A', 2493981, 'back-test seed'),
  (2026,  3, 'OLEO DIESEL', 4441173, 'back-test seed'),
  (2026,  4, 'GASOLINA A', 2428777, 'back-test seed'),
  (2026,  4, 'OLEO DIESEL', 4227391, 'back-test seed')
ON CONFLICT (ano, mes, produto) DO UPDATE
  SET volume_m3 = EXCLUDED.volume_m3, fonte = EXCLUDED.fonte;
