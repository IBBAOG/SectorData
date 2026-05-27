# Field Stakes — Pending manual fill (Eduardo)

> Status as of 2026-05-26. Generated automatically by `worker_documentador` after Fase 1 seed.
>
> **Action:** open `/admin-panel → Field Stakes` (when `/production` dashboard ships) and add stakes for the campos listed below. Mark each as `- [x]` once filled.

## Summary

- **Seeded automatically:** 304 campos (SUM=100 verified, from ANP Anuário 2025 Quadro 2.3 + 14 supplementary sources).
- **Pending manual fill:** 240 campos from the `lacunas` sheet of `data/field_stakes_brasil.xlsx` + 2 unmatched names.
- **Source:** ANP Anuário Estatístico 2025 Quadro 2.3 (primary) + 14 supplementary (Petrobras IR, Equinor IR, PPSA — see Excel sheet `fontes`).
- **Why this matters:** the `/production` dashboard's company-level aggregates (`get_production_company_aggregate`, `get_production_top_fields`) only include campos with `SUM(stake_pct)=100`. Campos still in this lacunas list are **silently excluded** from company totals — preferring to under-report rather than inflate based on partial stakes.

Lacunas breakdown:

| Bucket | Count |
|---|---|
| AnC_ PSA / unitization areas | 12 |
| PA-1* exploration / test license areas | 33 |
| Fields not in ANP Anuário 2025 Quadro 2.3 (ceased / unitization rename / dev phase) | 195 |
| Unmatched from Excel (no fuzzy match in `mv_anp_cdp_pocos`) | 2 |
| **Total** | **242** |

---

## Unmatched from Excel (need new canonical names or manual ANP lookup)

These two names appeared in the upload report's "unmatched" list. They are not present in `mv_anp_cdp_pocos` and no fuzzy match scored above 0.85.

- [ ] **Mariqui** — not present in `mv_anp_cdp_pocos`. Possibly a recent declaration or an alternative ANP spelling. Verify with the ANP Painel Dinâmico de Concessões before deciding the canonical name.
- [ ] **Xisto São Mateus do Sul** — Petrobras shale field in PR. Distinct from `SÃO MATEUS` (Campos Basin). No fuzzy match above 0.85. May need to be entered as `XISTO SÃO MATEUS DO SUL` if/when it appears in CDP.

---

## PSA / Unitization areas (Acordos de Coparticipação)

These are PSA-tracked allocation areas. Production is allocated to parent fields (TUPI, MERO, ATAPU, BÚZIOS, SÉPIA, ITAPU, JUBARTE, TARTARUGA VERDE, etc.) — Eduardo decides whether to mirror the parent's stakes onto each AnC_ entry or skip them (skipping is OK; the parent field already carries the production).

- [ ] AnC_ARGONAUTA_ME1
- [ ] AnC_BRAVA
- [ ] AnC_Forno
- [ ] AnC_Jubarte_Nordeste
- [ ] AnC_Jubarte_Sudoeste
- [ ] AnC_TARTARUGA VERDE
- [ ] AnC_TARTARUGA_VERDE
- [ ] AnC_LULA
- [ ] AnC_MERO
- [ ] AnC_Mero
- [ ] AnC_NORTE_ATAPU
- [ ] AnC_TUPI

---

## Exploration / Test license areas (PA-1* prefix)

`PA-1*` are exploration / test license areas — not production-phase per ANP Quadro 2.3 (31/12/2024). The operator may have produced exploratory volumes recorded in CDP. Eduardo decides whether to attribute 100% to the listed operator (the most common case for exploratory licenses) or skip.

- [ ] PA-1BRSA513DAL-BTSEAL2 — Petrobras
- [ ] PA-1ENV25DAM_AM-T-84_AM-T-85 — Eneva
- [ ] PA-1-BGM-4-ES_ES-T-496 — BGM
- [ ] PA-1BGM1ES_EST-T-476 — BGM
- [ ] PA-1BGM5ES_ES-T-496 — BGM
- [ ] PA-1BRSA1240ES-1BRSA1241ES-4BRSA1176ES-E — Petrobras
- [ ] PA-1BRSA1318ES-ES-T-486 — Petrobras
- [ ] PA-1BRSA258-BT-ES-12 — Petrobras
- [ ] PA-1BRSA373DES-ES-T-495 — Petrobras
- [ ] PA-1BRSA504DES-BT-ES-15 — Petrobras
- [ ] PA-1IMET27ES_ES-T-487 — Capixaba Energia
- [ ] PA-1PGN1MA_PN-T-48_BT-PN-4 — Eneva
- [ ] PA-1AURI27RN-POT-T-573 — UTC Engenharia
- [ ] PA-1AURI3A-POT-T-302 — Imetame
- [ ] PA-1BRSA1025RN_POT-T-699 — Petrobras
- [ ] PA-1BRSA452-1BRSA453-POT-T-661 — Petrobras
- [ ] PA-1BRSA543RN-POTT701 — Petrobras
- [ ] PA-1BRSA558-1BRSA675-POT-T-744E745 — Phoenix
- [ ] PA-1BV1RN-POT-T-569 — Aurizônia Petróleo
- [ ] PA-1GALP42RN_POT-T-743 — Phoenix
- [ ] PA-1POT1RN_POT-T-702 — Potiguar E&P S.A.
- [ ] PA-1PSY4RN-POTT352 — Petrosynergy
- [ ] PA-1STAR8RN-POT-T-794 — SHB
- [ ] PA-1-GOP-1A-BA_REC-T-107 — Great Energy
- [ ] PA-1ALV1BA-REC-T-129 — Maha Energy
- [ ] PA-1ALV8DBA_REC-T-182 — Alvopetro
- [ ] PA-1BRSA1300DBA_RECT-T-70 — Petrobras
- [ ] PA-1BRSA568DBA-REC-T-265 — Petrobras
- [ ] PA-1GPK4DBA_REC-T-128 — Geopark Brasil
- [ ] PA-1GREN1DBA_REC-T-108 — Vultur Oil
- [ ] PA-1BRSA1083SES-SEAL-M-426 — Petrobras
- [ ] PA-1BRSA1291DES_SEAL-T-420 — Petrobras
- [ ] PA-1FCB0001BA_TUC-T-139_TUC-T-147 — Imetame

---

## Fields not in ANP Anuário 2025 Quadro 2.3 (ceased / unitization rename / dev phase)

These are listed in the `lacunas` sheet without a breakdown. Most are (a) fields that ceased production, (b) recent unitization name changes, or (c) fields still in development phase. Verify with the ANP Painel Dinâmico de Concessões before assigning stakes.

Grouped by bacia for readability (operador in parentheses):

### Alagoas (6)

- [ ] CIDADE DE SEBASTIÃO FERREIRA (Petrosynergy)
- [ ] CIDADE DE SÃO MIGUEL DOS CAMPOS (Origem Alagoas)
- [ ] JAPUAÇU (Petrobras)
- [ ] LAGOA PACAS (Petrosynergy)
- [ ] SEBASTIÃO FERREIRA (Petrosynergy)
- [ ] SÃO MIGUEL DOS CAMPOS (Origem Alagoas)

### Amazonas (1)

- [ ] AZULÃO OESTE (Eneva)

### Barreirinhas (1)

- [ ] PRJ-OC (Oeste de Canoas)

### Camamu (1)

- [ ] JIRIBATUBA (Alvopetro)

### Campos (23)

- [ ] ANEQUIM (Petrobras)
- [ ] BAGRE (Petrobras)
- [ ] BALEIA AZUL (Petrobras)
- [ ] BALEIA FRANCA (Petrobras)
- [ ] BIJUPIRÁ (Shell Brasil)
- [ ] CAXAREU (Petrobras)
- [ ] CHERNE (Petrobras)
- [ ] CONGRO (Petrobras)
- [ ] CORVINA (Petrobras)
- [ ] ESPADIM (Petrobras)
- [ ] GAROUPA (Petrobras)
- [ ] GAROUPINHA (Petrobras)
- [ ] MALHADO (Petrobras)
- [ ] MANJUBA (Petrobras)
- [ ] NAMORADO (Petrobras)
- [ ] NORDESTE DE NAMORADO (Petrobras)
- [ ] PARATI (Petrobras)
- [ ] SALEMA (Shell Brasil)
- [ ] TARTARUGA MESTIÇA (Petrobras)
- [ ] TRILHA (Petrobras)
- [ ] TUBARÃO AZUL (Dommo Energia)
- [ ] VIOLA (Petrobras)
- [ ] WAHOO (PRIO)

### Ceará (4)

- [ ] ATUM (Petrobras)
- [ ] CURIMÃ (Petrobras)
- [ ] ESPADA (Petrobras)
- [ ] XARÉU (Petrobras)

### Espírito Santo (44)

- [ ] ALBATROZ (Petrosynergy)
- [ ] BARRA DO IPIRANGA (Petrobras)
- [ ] BATUÍRA (Capixaba Energia)
- [ ] BEM-TE-VI (Vipetro)
- [ ] BIGUÁ (Karavan)
- [ ] CAÇÃO (Petrobras)
- [ ] Cancã Leste (Petrobras)
- [ ] CÓRREGO CEDRO NORTE (Karavan)
- [ ] CÓRREGO CEDRO NORTE SUL (Karavan)
- [ ] CÓRREGO DAS PEDRAS (Karavan)
- [ ] FAZENDA CEDRO NORTE (Karavan)
- [ ] FAZENDA QUEIMADAS (Karavan)
- [ ] GAIVOTA (Vipetro)
- [ ] GARÇA BRANCA (Petrol)
- [ ] GURIRI (Karavan)
- [ ] JACUPEMBA (Petrobras)
- [ ] JACUTINGA NORTE (Petrobras)
- [ ] LAGOA BONITA (Karavan)
- [ ] LAGOA PARDA SUL (Petrobras)
- [ ] LAGOA PIABANHA (Capixaba Energia)
- [ ] MARIRICU (Karavan)
- [ ] MARIRICU NORTE (Karavan)
- [ ] MARIRICU OESTE (Petrobras)
- [ ] MOSQUITO (Petrobras)
- [ ] MOSQUITO NORTE (Petrobras)
- [ ] MURIQUI (BGM)
- [ ] NATIVO OESTE (Petrobras)
- [ ] PA-3BRSA523ES-ET-T-381-ES-T-390 (Petrobras)
- [ ] RIO BARRA SECA (Petrobras)
- [ ] RIO DOCE (Petrobras)
- [ ] RIO IBIRIBAS (Petrobras)
- [ ] RIO ITAÚNAS LESTE (Petrobras)
- [ ] RIO MARIRICU (Mandacaru Energia)
- [ ] RIO MARIRICU SUL (Petrobras)
- [ ] RIO PRETO (Karavan)
- [ ] RIO PRETO OESTE (Karavan)
- [ ] RIO PRETO SUDESTE (Petrobras)
- [ ] RIO PRETO SUL (Petrobras)
- [ ] RIO SÃO MATEUS (Karavan)
- [ ] RIO SÃO MATEUS OESTE (Petrobras)
- [ ] SAIRA (Petrobras)
- [ ] SERIEMA (Karavan)
- [ ] SURUCUCU (BGM)
- [ ] SÃO MATEUS (Karavan)

### Parnaíba (6)

- [ ] GAVIÃO BELO (Eneva)
- [ ] GAVIÃO BRANCO NORTE (Eneva)
- [ ] GAVIÃO CARIJÓ (Eneva)
- [ ] GAVIÃO MATEIRO (Eneva)
- [ ] GAVIÃO TESOURA (Eneva)
- [ ] GAVIÃO VAQUEIRO (Eneva)

### Potiguar (35)

- [ ] AGULHA (Petrobras)
- [ ] ANDORINHA SUL (Perícia)
- [ ] ARATUM (3R PETROLEUM)
- [ ] Alto Alegre (Petro-Victory)
- [ ] BAIXA DO JUAZEIRO (Petrobras)
- [ ] BIQUARA (Petrobras)
- [ ] BOA VISTA (Petrobras)
- [ ] BREJINHO RN (PetroRecôncavo)
- [ ] CABOCLINHO (Imetame)
- [ ] CHAUÁ (Allpetro)
- [ ] CHOPIM (Petrogal Brasil)
- [ ] DENTÃO (Petrobras)
- [ ] FAZENDA BELÉM CE (3R Fazenda Belém)
- [ ] FAZENDA JUNCO (Petrobras)
- [ ] GRAÚNA (Imetame)
- [ ] GUAMARÉ SUDESTE (Petrobras)
- [ ] IRAÚNA (Imetame)
- [ ] MORRINHO (Petrobras)
- [ ] NOROESTE DO MORRO ROSADO (Petrobras)
- [ ] NORTE DE PESCADA (Petrobras)
- [ ] PA-3BRSA956RN_3BRSA1074RN_POT-T-744 (Phoenix)
- [ ] PA-AURI4-AURI5-AURI6-RNPOT-T-432 (Imetame)
- [ ] PERIQUITO NORDESTE (Phoenix Óleo & Gás)
- [ ] PITIGUARI (Petrosynergy)
- [ ] POÇO XAVIER (Petrobras)
- [ ] REDONDA PROFUNDO (Petrobras)
- [ ] RIACHO VELHO (Leros)
- [ ] SABIÁ-LARANJEIRA (PetroRecôncavo)
- [ ] SERRA (3R PETROLEUM)
- [ ] SÃO MANOEL (Arclima)
- [ ] SÃO MIGUEL (Petrobras)
- [ ] TIZIU (Petrobras)
- [ ] TLD-1BRSA456RN-POT-T-700 (Petrobras)
- [ ] Tanatau (Phoenix Óleo & Gás)
- [ ] VÁRZEA REDONDA (Petrobras)

### Recôncavo (42)

- [ ] BEIJA-FLOR (Petrobras)
- [ ] BREJINHO BA (PetroRecôncavo)
- [ ] CABURÉ LESTE (Alvopetro)
- [ ] CAMBACICA (3R Candeias S.A.)
- [ ] CIDADE DE ENTRE RIOS (Petrobras)
- [ ] Camaçari (Creative Energy)
- [ ] Canário da Terra (Petrobras)
- [ ] DIAS D'ÁVILA (Petrobras)
- [ ] DOM JOÃO MAR (—)
- [ ] FAZENDA ALTO DAS PEDRAS (3R Rio Ventura)
- [ ] FAZENDA GAMELEIRA (Licitado) (Petrobras)
- [ ] FAZENDA SORI (Petrobras)
- [ ] GURIATÃ (Petrobras)
- [ ] ITAPARICA (Petrobras)
- [ ] JANDAIA (Petrobras)
- [ ] JAÓ (Queiroz Galvão)
- [ ] Jandaia Sul (Petrobras)
- [ ] LAGOA VERDE (Petrobras)
- [ ] LEODÓRIO (Petrobras)
- [ ] MAPELE (Petrobras)
- [ ] MARITACA (SHB)
- [ ] MIRANGA LESTE (Petrobras)
- [ ] Mãe-da-lua (Alvopetro)
- [ ] PARIRI (3R Candeias S.A.)
- [ ] POJUCA (3R Rio Ventura S.A)
- [ ] POJUCA NORTE (Petrobras)
- [ ] PRJ-FSP (Alcom)
- [ ] QUIAMBINA (—)
- [ ] RIACHO DA BARRA (Petrobras)
- [ ] RIO DA SERRA (Petrobras)
- [ ] RIO JOANES (Petrobras)
- [ ] RIO PIPIRI (Petrobras)
- [ ] RIO POJUCA (3R Rio Ventura S.A)
- [ ] RIO SAUÍPE (Petrobras)
- [ ] Rio Joanes (Creative Energy)
- [ ] SOCORRO EXTENSÃO NORTE (Petrobras)
- [ ] TAPIRANGA (3R Rio Ventura S.A)
- [ ] TICO-TICO (Nova Petróleo)
- [ ] TLD-1BRSA502BA-BT-REC-7 (Petrobras)
- [ ] TLD-1QG4BA-BT-REC-8 (Queiroz Galvão)
- [ ] UIRAPURU SUDOESTE (Petrosynergy)
- [ ] VALE DO QUIRICO (Energizzi Energias)

### Santos (10)

- [ ] BERBIGÃO (Petrobras)
- [ ] CORAL (Petrobras)
- [ ] LAGOSTA (Petrobras)
- [ ] LULA (Petrobras)
- [ ] MERLUZA (Petrobras)
- [ ] NOROESTE DE SAPINHOA (Petrobras)
- [ ] PEO-1BRSA1146RJS_Iara_Entorno_CCO (Petrobras)
- [ ] PIRACABA (Petrobras)
- [ ] SUL DE BERBIGÃO (Petrobras)
- [ ] SUL DE LULA (Petrobras)

### Sergipe (17)

- [ ] ARACUÃ (SHB)
- [ ] CAIOBA (Petrobras)
- [ ] CAMORIM (Petrobras)
- [ ] CARMÓPOLIS NOROESTE (Petrobras)
- [ ] DOURADO (Petrobras)
- [ ] DÓ-RÉ-MI (Mandacaru Energia)
- [ ] GUARICEMA (Petrobras)
- [ ] GUARÁ (Nord)
- [ ] MATO GROSSO NOROESTE (Petrobras)
- [ ] MATO GROSSO NORTE (Petrobras)
- [ ] MATO GROSSO SUDOESTE (Petrobras)
- [ ] MATO GROSSO SUL (Petrobras)
- [ ] PIRANEMA (Petrobras)
- [ ] PIRANEMA SUL (Petrobras)
- [ ] SALGO (Petrobras)
- [ ] SIRIRIZINHO SUL (Petrobras)
- [ ] TATUI (Petrobras)

### Solimões (2)

- [ ] CARAPANAÚBA (Petrobras)
- [ ] CUPIÚBA (Petrobras)

### Tucano Sul (3)

- [ ] IRAÍ (Petroborn)
- [ ] SEMPRE VIVA (Oceania)
- [ ] Tucano Grande (Imetame)

---

## How to fill (workflow)

1. Open `/admin-panel → Field Stakes`.
2. Type the campo name in the search box (left pane).
3. Click the campo.
4. Click "+ Add company", type empresa + stake_pct.
5. Repeat until sum = 100 (status pill turns green).
6. Click Save.
7. Come back to this file and mark `- [x]`.

The Admin Panel autocompletes empresas already registered (Petrobras, PRIO, Shell, Equinor, Brava Energia, TotalEnergies, Petrogal, ExxonMobil, CNODC, CNOOC, ONGC, QatarEnergy, Petronas, Karoon, BP, Chevron, Origem Energia, Eneva, Petrosynergy, Petro-Victory, Repsol Sinopec, Galp, Perícia Petróleo, Andorinha Energia, Gas Bridge, Geopark, Creative Energy, PetroRecôncavo, 3R Petroleum, Alvopetro, Eagle, UP Petróleo, and ~30 others).

## Refresh cadence

When ANP publishes a new Anuário (annual), `worker_dados-locais` re-runs `scripts/manual/field_stakes_upload.py` against the updated Excel. This overwrites campos that appear in the new sheet but preserves manually-filled campos outside the Excel scope.
