-- ============================================================================
-- Extend cabotage detection with a hard-coded Brazilian-fleet name blocklist.
-- Some Brazilian cabotage vessels (Transpetro fleet, small coastal tankers)
-- aren't indexed in public AIS databases — so vessel_lookup can't resolve
-- their flag. We catch them here by normalised name match.
--
-- List seeded from the Transpetro Aframax/Suezmax fleet + known coastal
-- tankers that have appeared in the scraped port line-ups. Maintainers can
-- add more by editing the regex.
-- ============================================================================

-- Drop + recreate is_cabotagem generated column (can't ALTER a generated
-- column's expression in-place)
ALTER TABLE public.navios_diesel DROP COLUMN IF EXISTS is_cabotagem;

ALTER TABLE public.navios_diesel ADD COLUMN is_cabotagem boolean
  GENERATED ALWAYS AS (
    -- Signal 1: explicit flag from VesselFinder lookup
    UPPER(COALESCE(flag, '')) IN ('BRAZIL', 'BRASIL', 'BR')

    -- Signal 2: origem string (Suape scraping annotates cabotage routes)
    OR UPPER(COALESCE(origem, '')) LIKE '%-BRA'
    OR UPPER(COALESCE(origem, '')) LIKE '%BRASIL%'

    -- Signal 3: known Brazilian coastal fleet by normalised name
    OR UPPER(REGEXP_REPLACE(COALESCE(navio, ''), '[^A-Za-z0-9]', '', 'g')) IN (
        -- Transpetro Aframax / Suezmax fleet
        'ATAULFOALVES', 'CARLOSDRUMMOND', 'CELSOFURTADO',
        'DRAGAOELERJ', 'HENRIQUEDIAS', 'JOAOCANDIDO',
        'MARCILIODIAS', 'SERGIOBUARQUEDEHOLANDA', 'TANCREDONEVES',
        'TOBIASBARRETO', 'VITALDEOLIVEIRA', 'ZUMBIDOSPALMARES',

        -- Transpetro product tankers / smaller coastal
        'BARRADOITAPOCU', 'BARRADORIACHO', 'BARRADOUNA', 'BARRADODANTE',
        'CARIOCA', 'GERONIMO', 'LAMBARI', 'MARAJO', 'NORDESTINA',

        -- Norsul / Eisa / smaller cabotage tankers
        'BASTOSI', 'BASTOSII', 'BASTOSIII',
        'GUARANI', 'GUARAPARI', 'PARATY', 'PARANAIBA',
        'IBIA', 'ISOLDA', 'CATUAI'
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_nd_cabotagem
  ON public.navios_diesel (is_cabotagem) WHERE is_cabotagem = false;
