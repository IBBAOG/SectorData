-- ============================================================================
-- Alerts Product — Seed alert_sources catalog
--
-- Inserts 20 rows (18 sources from PRD + 1 synthetic 'system_confirmation'
-- + 1 reserved 'system_meta' for canary alerts).
--
-- - is_active=TRUE for sources with a detector ready (or to be ready in v1).
-- - detection_module is the Python import path of the detector class.
--
-- See docs/alerts/PRD.md § Detection layer for the canonical detector list.
-- See docs/app/alerts.md § Source catalog for the user-facing display.
-- ============================================================================

-- Fuel Distribution (11 sources) ----------------------------------------------

INSERT INTO public.alert_sources (
  source_slug, category, display_name, description, frequency_hint,
  detection_module, metadata, is_active
) VALUES
('anp_ppi', 'Fuel Distribution',
 'ANP Import Parity Prices (PPI)',
 'Weekly Petrobras Internal Prices / parity prices by product and port location.',
 'Weekly (Mon ~12h UTC)',
 'scripts.alerts.detection.anp_ppi:AnpPpiDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-ppi'),
 TRUE),

('anp_precos_produtores', 'Fuel Distribution',
 'ANP Producer Prices',
 'Weekly weighted-average producer/importer prices by region.',
 'Weekly (Mon ~12h UTC)',
 'scripts.alerts.detection.anp_precos_produtores:AnpPrecosProdutoresDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-precos-produtores'),
 TRUE),

('anp_glp', 'Fuel Distribution',
 'ANP GLP Sales',
 'Monthly LPG sales by distributor and recipient category (P13 / Outros).',
 'Weekly check (Mon ~12h UTC); data is monthly',
 'scripts.alerts.detection.anp_glp:AnpGlpDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-glp'),
 TRUE),

('anp_lpc', 'Fuel Distribution',
 'ANP Retail Fuel Prices (LPC)',
 'Weekly resale fuel prices at gas stations by product and UF.',
 'Weekly (Wed ~14:30 UTC)',
 'scripts.alerts.detection.anp_lpc:AnpLpcDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-lpc'),
 TRUE),

('anp_precos_distribuicao', 'Fuel Distribution',
 'ANP Distribution Prices',
 'Weekly + monthly distribution prices by distributor, product, UF.',
 'Weekly Tue + Monthly 5th',
 'scripts.alerts.detection.anp_precos_distribuicao:AnpPrecosDistribuicaoDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-precos-distribuicao'),
 TRUE),

('anp_sintese_semanal', 'Fuel Distribution',
 'ANP Weekly Synthesis',
 'Weekly synthesis PDFs published by ANP (no DB table — PDF only).',
 'Weekly',
 'scripts.alerts.detection.anp_sintese_semanal:AnpSinteseSemanalDetector',
 jsonb_build_object('coalesce_above', 5),
 TRUE),

('anp_painel_combustiveis', 'Fuel Distribution',
 'ANP Fuel Panel',
 'Monthly ANP Power BI panel — sales, deliveries, distributor imports.',
 'Monthly (~1-2 weeks before ZIP)',
 'scripts.alerts.detection.anp_painel_combustiveis:AnpPainelCombustiveisDetector',
 jsonb_build_object('coalesce_above', 5),
 TRUE),

('anp_dados_abertos_ie', 'Fuel Distribution',
 'ANP Open Data (Imports & Exports)',
 'ANP open datasets for petroleum + derivatives (CSV updates).',
 'Variable',
 'scripts.alerts.detection.anp_dados_abertos_ie:AnpDadosAbertosIEDetector',
 jsonb_build_object('coalesce_above', 5),
 TRUE),

('anp_desembaracos_daie', 'Fuel Distribution',
 'ANP DAIE + Customs Clearances',
 'Monthly imports/exports of petroleum derivatives + customs clearances by NCM and importer.',
 'Monthly (1st of month ~13h UTC)',
 'scripts.alerts.detection.anp_desembaracos_daie:AnpDesembaracosDaieDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/imports-exports'),
 TRUE),

('mdic_comex', 'Fuel Distribution',
 'MDIC Comex (Crude Oil, Gasoline, Diesel)',
 'Daily MDIC API poll for 3 fixed NCMs: crude oil, gasoline, diesel imports/exports.',
 'Daily (~14h UTC)',
 'scripts.alerts.detection.mdic_comex:MdicComexDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/imports-exports'),
 TRUE),

('sindicom', 'Fuel Distribution',
 'SINDICOM Distribution Sector',
 'Monthly fuel sales by SINDICOM-affiliated distributor, product, UF, segment.',
 'Monthly (5th of month ~15h UTC)',
 'scripts.alerts.detection.sindicom:SindicomDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/sindicom'),
 TRUE),

-- Oil & Gas (3 sources) -------------------------------------------------------

('anp_cdp_producao', 'Oil & Gas',
 'ANP CDP Well Production',
 'Monthly oil/gas/water production per well; alerts when new fields appear (M/S/T environments).',
 'Monthly (~mid-month publication, ~2h fallback cron)',
 'scripts.alerts.detection.anp_cdp_producao:AnpCdpProducaoDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/anp-cdp'),
 TRUE),

('anp_cdp_diaria', 'Oil & Gas',
 'ANP CDP Daily Production',
 'Daily oil/gas production by field via ANP Power BI API.',
 '3×/day (~10h, 15h, 20h UTC)',
 'scripts.alerts.detection.anp_cdp_diaria:AnpCdpDiariaDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/anp-cdp-diaria'),
 TRUE),

('anp_voip', 'Oil & Gas',
 'ANP VOIP (Reserve Bulletin)',
 'Annual VOIP/VGIP reserve report by field, basin, state.',
 'Annual (May 1st ~12h UTC)',
 'scripts.alerts.detection.anp_voip:AnpVoipDetector',
 jsonb_build_object('coalesce_above', 5),
 TRUE),

-- Vessels (3 sources) ---------------------------------------------------------

('navios_diesel', 'Vessels',
 'Diesel Vessels Lineup (5 ports)',
 'Vessel lineups at Santos, Itaqui, Paranaguá, São Sebastião, Suape ports — every 6h snapshot.',
 'Every 6h',
 'scripts.alerts.detection.navios_diesel:NaviosDieselDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/navios-diesel'),
 TRUE),

('ais_positions', 'Vessels',
 'AIS Vessel Positions',
 'Real-time AIS positions of tracked vessels (port arrivals trigger alerts).',
 'Every 6h + WebSocket',
 'scripts.alerts.detection.ais_positions:AisPositionsDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/navios-diesel'),
 TRUE),

('ais_candidates', 'Vessels',
 'AIS Import Candidates (Early Warning)',
 'High-score tanker candidates heading to Brazilian ports — scored 0-100 by AIS scan.',
 'Every 4h',
 'scripts.alerts.detection.ais_candidates:AisCandidatesDetector',
 jsonb_build_object('coalesce_above', 10, 'frontend_route', '/navios-diesel'),
 TRUE),

-- Proprietary (3 sources) -----------------------------------------------------

('d_g_margins', 'Proprietary',
 'Diesel & Gasoline Margins',
 'Weekly proprietary margins data uploaded manually (D&G margins Excel).',
 'Weekly (Mon ~10h UTC)',
 'scripts.alerts.detection.d_g_margins:DGMarginsDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/diesel-gasoline-margins'),
 TRUE),

('price_bands', 'Proprietary',
 'Price Bands (Import/Export Parity)',
 'BBA/IBBA proprietary price bands data: import parity, export parity, Petrobras price.',
 'Ad-hoc (manual upload)',
 'scripts.alerts.detection.price_bands:PriceBandsDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/price-bands'),
 TRUE),

('anp_subsidy', 'Proprietary',
 'ANP Subsidy Diesel Reference',
 'Daily ANP diesel reference price (regional) extracted from ANP PDFs.',
 'Daily (~11:30 UTC)',
 'scripts.alerts.detection.anp_subsidy:AnpSubsidyDetector',
 jsonb_build_object('coalesce_above', 5, 'frontend_route', '/subsidy-tracker'),
 TRUE),

-- System / synthetic sources --------------------------------------------------

('system_confirmation', 'Proprietary',
 'System — Confirmation Emails',
 'Synthetic source used by the subscription system to enqueue double opt-in confirmation emails. NEVER user-visible.',
 'On-demand',
 'scripts.alerts.detection.system:SystemConfirmationDetector',
 jsonb_build_object('coalesce_above', 1, 'hidden_from_catalog', TRUE),
 FALSE),     -- is_active=false so list_alert_sources() hides it from UI

('system_meta', 'Proprietary',
 'System — Meta Alerts (Canary)',
 'Synthetic source for admin meta-alerts (stale base detection, send rate alarms). NEVER user-visible.',
 'Daily',
 'scripts.alerts.detection.system:SystemMetaDetector',
 jsonb_build_object('hidden_from_catalog', TRUE),
 FALSE)

ON CONFLICT (source_slug) DO UPDATE SET
  category         = EXCLUDED.category,
  display_name     = EXCLUDED.display_name,
  description      = EXCLUDED.description,
  frequency_hint   = EXCLUDED.frequency_hint,
  detection_module = EXCLUDED.detection_module,
  metadata         = EXCLUDED.metadata,
  -- Don't override is_active — admin may have toggled it
  is_active        = alert_sources.is_active;

-- Verify the seed
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.alert_sources;
  RAISE NOTICE 'alert_sources seed complete: % rows', v_count;
  IF v_count < 20 THEN
    RAISE WARNING 'Expected at least 20 sources, got %', v_count;
  END IF;
END;
$$;
