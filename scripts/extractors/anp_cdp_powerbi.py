"""
anp_cdp_powerbi.py
==================
Extrator do Power BI ANP/CDP — 3 niveis de granularidade:
  - Campo       (pagina 4, entidade v_campos_detalhe)
  - Instalacao  (pagina 5, entidade v_instalacoes_final)
  - Poco        (pagina 6, entidade v_poco_instalacao_sigep_ultimo)

Fonte: relatorio publico "Painel Dinamico de Producao Diaria de Petroleo e Gas Natural"
URL:   https://app.powerbi.com/view?r=eyJrIjoiZjQ0NjIzNmYtNzY3Ni00MzZkLWI0MTQtYzk4ZWY0ZGI4ODQ5IiwidCI6IjQ0OTlmNGZmLTI0YTYtNGI0Mi1iN2VmLTEyNGFmY2FkYzkxMyJ9

Constantes descobertas via Chrome MCP em 2026-05-08.

Uso:
  python scripts/extractors/anp_cdp_powerbi.py --level all --upload
  python scripts/extractors/anp_cdp_powerbi.py --level campo --start 2025-01-01
  python scripts/extractors/anp_cdp_powerbi.py --level instalacao
  python scripts/extractors/anp_cdp_powerbi.py --level poco

  # Backward compat (equivalente a --level campo):
  python scripts/extractors/anp_cdp_powerbi.py --all
  python scripts/extractors/anp_cdp_powerbi.py --all --start 2025-01-01 --upload
  python scripts/extractors/anp_cdp_powerbi.py --campo PEREGRINO
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    from scripts.extractors._powerbi_common import post_query, extract_row_count
except ModuleNotFoundError:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from extractors._powerbi_common import post_query, extract_row_count  # type: ignore[import]

# ─── Constantes descobertas via Chrome MCP (2026-05-08) ──────────────────────

RESOURCE_KEY = "f446236f-7676-436d-b414-c98ef4db8849"   # decodificado do ?r= via base64
MODEL_ID     = 3418545
DATASET_ID   = "5dd23708-9095-4e35-b585-d1039d481990"
REPORT_ID    = "0f6fa041-4098-458c-a4ac-1603e4eebbd2"

# Visual IDs por nivel (para ApplicationContext)
VISUAL_ID_CAMPO      = "0cb9bc972ac667eac72b"   # tabela "Producao por Campo" (pagina 4)
VISUAL_ID_INSTALACAO = "876655dd87739eb64d9b"   # visual pagina 5
VISUAL_ID_POCO       = "cb0856053370c87f38d5"   # chart visual pagina 6

DEFAULT_OUTPUT = Path("output")
DEFAULT_CAMPO  = "PEREGRINO"


# ─── Helpers de construcao do payload ────────────────────────────────────────

def _column(src: str, prop: str) -> dict:
    return {"Column": {"Expression": {"SourceRef": {"Source": src}}, "Property": prop}}


def _measure(src: str, prop: str) -> dict:
    return {"Measure": {"Expression": {"SourceRef": {"Source": src}}, "Property": prop}}


def _where_in(src: str, prop: str, values: list) -> dict:
    return {"Condition": {"In": {
        "Expressions": [_column(src, prop)],
        "Values": [[{"Literal": {"Value": f"'{v}'"}}] for v in values],
    }}}


def _where_date_range(src: str, prop: str, start_date: date, end_date_excl: date) -> dict:
    """
    Reproduz exato o shape capturado: And de dois Comparisons.
      ComparisonKind 2 = >= (start, inclusive)
      ComparisonKind 3 = <  (end,   exclusive)
    """
    def _lit(d: date) -> dict:
        return {"Literal": {"Value": f"datetime'{d.isoformat()}T00:00:00'"}}

    return {"Condition": {"And": {
        "Left":  {"Comparison": {"ComparisonKind": 2,
                                 "Left":  _column(src, prop),
                                 "Right": _lit(start_date)}},
        "Right": {"Comparison": {"ComparisonKind": 3,
                                 "Left":  _column(src, prop),
                                 "Right": _lit(end_date_excl)}},
    }}}


def _app_ctx(visual_id: str) -> dict:
    return {
        "DatasetId": DATASET_ID,
        "Sources": [{"ReportId": REPORT_ID, "VisualId": visual_id}],
    }


def _build_query_body(
    entities: list,
    select_cols: list,
    where_conds: list,
    visual_id: str,
    window: int,
    n_projections: int,
    order_desc: bool = True,
) -> dict:
    order_by = [{"Direction": 2, "Expression": _column("d", "Data")}] if order_desc else []
    projections = list(range(n_projections))
    return {
        "version": "1.0.0",
        "queries": [{
            "Query": {"Commands": [{"SemanticQueryDataShapeCommand": {
                "Query": {
                    "Version": 2,
                    "From":    entities,
                    "Select":  select_cols,
                    "Where":   where_conds,
                    "OrderBy": order_by,
                },
                "Binding": {
                    "Primary": {"Groupings": [{"Projections": projections, "Subtotal": 1}]},
                    "DataReduction": {"DataVolume": 3, "Primary": {"Window": {"Count": window}}},
                    "Version": 1,
                },
                "ExecutionMetricsKind": 1,
            }}]},
            "QueryId": "",
            "ApplicationContext": _app_ctx(visual_id),
        }],
        "cancelQueries": [],
        "modelId": MODEL_ID,
    }


# ─── Definicoes por nivel ──────────────────────────────────────────────────────

def _entities_campo() -> list:
    return [
        {"Name": "d", "Entity": "Datas",            "Type": 0},
        {"Name": "v", "Entity": "v_campos_detalhe", "Type": 0},
        {"Name": "m", "Entity": "Medidas",          "Type": 0},
        {"Name": "c", "Entity": "Correção",         "Type": 0},
    ]


def _select_campo() -> list:
    """5 colunas: Data, Campo, Bacia, Petroleo, Gas"""
    return [
        {**_column("d", "Data"),      "Name": "Datas.Data"},
        {**_column("v", "Campo"),     "Name": "v_campos_detalhe.Campo"},
        {**_column("v", "Bacia"),     "Name": "v_campos_detalhe.Bacia"},
        {**_measure("m", "Petróleo"), "Name": "Medidas.Petroleo"},
        {**_measure("m", "Gás Mm3"),  "Name": "Medidas.Gas"},
    ]


def _entities_instalacao() -> list:
    return [
        {"Name": "d", "Entity": "Datas",               "Type": 0},
        {"Name": "v", "Entity": "v_instalacoes_final",  "Type": 0},
        {"Name": "m", "Entity": "Medidas",              "Type": 0},
        {"Name": "c", "Entity": "Correção",             "Type": 0},
    ]


def _select_instalacao() -> list:
    """5 colunas: Data, Campo, Instalacao, Petroleo, Gas"""
    return [
        {**_column("d", "Data"),        "Name": "Datas.Data"},
        {**_column("v", "Campo"),       "Name": "v_instalacoes_final.Campo"},
        {**_column("v", "Instalação"),  "Name": "v_instalacoes_final.Instalação"},
        {**_measure("m", "Petróleo"),   "Name": "Medidas.Petroleo"},
        {**_measure("m", "Gás Mm3"),    "Name": "Medidas.Gás"},
    ]


def _entities_poco() -> list:
    # NOTE (2026-06-10): v_instalacoes_final is intentionally NOT joined here.
    # The old auto-JOIN silently DROPPED every well whose installation was
    # missing/late in that ANP view (measured live: -40 kbpd of Búzios wells on
    # 2026-06-01, -17.9 kbpd on 06-02) — the same mechanism that would hide a
    # new FPSO's wells whenever ANP registers wells before installations.
    # The well entity carries its own 'nome_instalacao' attribute (verified
    # against the live conceptualschema), so the join is unnecessary.
    return [
        {"Name": "d",  "Entity": "Datas",                          "Type": 0},
        {"Name": "v",  "Entity": "v_poco_instalacao_sigep_ultimo", "Type": 0},
        {"Name": "m",  "Entity": "Medidas",                        "Type": 0},
        {"Name": "c",  "Entity": "Correção",                       "Type": 0},
    ]


def _select_poco() -> list:
    """7 colunas: Data, NOME CAMPO, BACIA, NOME POCO ANP, Instalacao, Petroleo, Gas"""
    return [
        {**_column("d", "Data"),            "Name": "Datas.Data"},
        {**_column("v", "Campo (Poço)"),     "Name": "v_poco_instalacao_sigep_ultimo.NOME CAMPO"},
        {**_column("v", "BACIA"),           "Name": "v_poco_instalacao_sigep_ultimo.BACIA"},
        {**_column("v", "NOME POÇO ANP"),   "Name": "v_poco_instalacao_sigep_ultimo.NOME POÇO ANP"},
        {**_column("v", "nome_instalacao"), "Name": "v_poco_instalacao_sigep_ultimo.nome_instalacao"},  # from the well entity itself — no join
        {**_measure("m", "Petróleo"),       "Name": "Medidas.Petroleo"},
        {**_measure("m", "Gás Mm3"),        "Name": "Medidas.Gás"},
    ]


# ─── Backward compat (build_cdp_payload* usados por imports externos) ─────────

def _select_cols() -> list:
    return _select_campo()


def _from_entities() -> list:
    return _entities_campo()


def build_cdp_payload(campo: str, start_date: date, end_date_excl: date,
                      window: int = 500) -> dict:
    """Monta payload para um unico campo (modo debug/single-campo). Mantido para compat."""
    where_conds = [
        _where_in("c", "Unidade", ["bbl"]),
        _where_date_range("d", "Data", start_date, end_date_excl),
        _where_in("v", "Campo", [campo]),
    ]
    return _build_query_body(
        _entities_campo(), _select_campo(), where_conds,
        VISUAL_ID_CAMPO, window, 5,
    )


def build_cdp_payload_todos(start_date: date, end_date_excl: date,
                            window: int = 100_000) -> dict:
    """Monta payload sem filtro de Campo. Mantido para compat."""
    where_conds = [
        _where_in("c", "Unidade", ["bbl"]),
        _where_date_range("d", "Data", start_date, end_date_excl),
    ]
    return _build_query_body(
        _entities_campo(), _select_campo(), where_conds,
        VISUAL_ID_CAMPO, window, 5,
    )


# ─── Conversor numerico ───────────────────────────────────────────────────────

def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ─── Parser DSR generico para o relatorio CDP ────────────────────────────────

# DSR null-mask key (Latin capital O with stroke, U+00D8). Power BI marks NULL
# columns with this bitmask: bit i set => column i is NULL and is NOT present in
# the "C" value array. Ignoring it shifts every subsequent value one slot to the
# left — the bug that filled anp_cdp_diaria_instalacao.campo with measure
# strings (e.g. '57499.45...') and mis-assigned petroleo/gas on those rows
# (root-caused live on 2026-06-10).
_DSR_NULL_MASK_KEY = "Ø"


def _parse_dsr_cdp_generic(result_json: dict, n_cols: int, debug_dump_path: Path | None = None) -> list[list]:
    """
    Parser dedicado para o formato DSR retornado pelo relatorio CDP.

    - Dados em PH[1].DM1
    - Data e Unix timestamp em ms
    - R-mask indica heranca de colunas do item anterior
    - Ø-mask (Ø) indica colunas NULL (ausentes do array "C")
    - Measures sao strings numericas diretas (sem ValueDict)

    Column resolution per item, for each column i (in order):
      1. R bit set    -> inherit value from the previous row (may inherit NULL)
      2. Ø bit set    -> NULL (no entry consumed from "C")
      3. otherwise    -> next value from "C", resolved through ValueDicts

    Retorna lista de listas com n_cols valores (raw, sem mapear para dict).
    """
    try:
        dsr   = result_json["results"][0]["result"]["data"]["dsr"]
        ds    = dsr["DS"][0]
        dicts = ds.get("ValueDicts", {})
        items = ds["PH"][1]["DM1"]
    except (KeyError, IndexError, TypeError) as exc:
        if debug_dump_path:
            debug_dump_path.parent.mkdir(parents=True, exist_ok=True)
            debug_dump_path.write_text(
                json.dumps(result_json, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"   [debug dump -> {debug_dump_path}]")
        raise ValueError(f"Estrutura DSR inesperada: {exc}") from exc

    schema_item = next((i for i in items if "S" in i), None)
    col_dicts: list[str | None] = [None] * n_cols
    if schema_item:
        for idx, s in enumerate(schema_item["S"]):
            if idx < n_cols:
                col_dicts[idx] = s.get("DN")

    def resolve(v, dk):
        if dk and dk in dicts and isinstance(v, int) and v < len(dicts[dk]):
            return dicts[dk][v]
        return v

    def ts_to_date(ts) -> str | None:
        if ts is None:
            return None
        try:
            return datetime.fromtimestamp(float(ts) / 1000, tz=timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            return str(ts)

    rows: list[list] = []
    prev = [None] * n_cols

    for item in items:
        # Data items carry at least one of C (values), R (repeat mask) or
        # Ø (null mask). The schema-only item has none of them.
        if "C" not in item and "R" not in item and _DSR_NULL_MASK_KEY not in item:
            continue
        r_mask    = item.get("R", 0)
        null_mask = item.get(_DSR_NULL_MASK_KEY, 0)
        c_vals    = item.get("C", [])
        row: list = [None] * n_cols
        c_idx = 0
        for i in range(n_cols):
            if (r_mask >> i) & 1:
                row[i] = prev[i]            # inherit (may inherit NULL)
            elif (null_mask >> i) & 1:
                row[i] = None               # explicit NULL — consumes nothing from C
            elif c_idx < len(c_vals):
                row[i] = resolve(c_vals[c_idx], col_dicts[i])
                c_idx += 1
        prev = row[:]
        # Converter coluna 0 (sempre Data) de timestamp para ISO
        out_row = list(row)
        out_row[0] = ts_to_date(row[0])
        if c_idx != len(c_vals):
            # Every "C" value must be consumed — a leftover means the R/Ø
            # masks were misread (the silent-corruption class the Ø fix
            # addresses). Surface it loudly instead of discarding.
            print(f"   [WARN] DSR row {len(rows)} (data={out_row[0]}, "
                  f"n_cols={n_cols}): {len(c_vals) - c_idx} leftover 'C' "
                  f"value(s) not consumed — R/Ø masks may be misread",
                  file=sys.stderr)
        rows.append(out_row)

    return rows


def parse_dsr_cdp(result_json: dict) -> list[dict]:
    """
    Parser de compatibilidade para 5 colunas (nivel Campo).
    Mantido com a mesma assinatura para nao quebrar imports externos.

    Schema idx: 0=Data, 1=Campo, 2=Bacia, 3=Petroleo, 4=Gas
    """
    raw = _parse_dsr_cdp_generic(result_json, 5)
    return [
        {
            "data":             row[0],
            "campo":            row[1],
            "bacia":            row[2],
            "petroleo_bbl_dia": _to_float(row[3]),
            "gas_mm3_dia":      _to_float(row[4]),
        }
        for row in raw
    ]


def _parse_instalacao(result_json: dict) -> list[dict]:
    """
    Schema idx: 0=Data, 1=Campo, 2=Instalacao, 3=Petroleo, 4=Gas

    Source facts (verified live 2026-06-10):
      - v_instalacoes_final.Campo only fills for onshore installations; offshore
        FPSOs come back NULL -> normalized to '' (the DB column is NOT NULL and
        '' was the historical convention; field attribution for offshore comes
        from the well-level mapping, see migration 20260508130001).
      - Each day may carry ONE unattributed row (Campo and Instalacao both NULL
        via the Ø mask): production of wells whose installation is missing from
        v_instalacoes_final (e.g. a brand-new FPSO not yet in the dimension).
        The PK (data, instalacao) cannot hold it -> skipped + logged. The same
        production is still captured at field level and at well level (the well
        query no longer joins v_instalacoes_final).
    """
    raw = _parse_dsr_cdp_generic(result_json, 5)
    rows: list[dict] = []
    skipped = 0
    skipped_oil = 0.0
    for row in raw:
        if row[2] is None or row[2] == "":
            skipped += 1
            skipped_oil += _to_float(row[3]) or 0.0
            continue
        rows.append({
            "data":             row[0],
            "campo":            row[1] if row[1] is not None else "",
            "instalacao":       row[2],
            "petroleo_bbl_dia": _to_float(row[3]),
            "gas_mm3_dia":      _to_float(row[4]),
        })
    if skipped:
        print(f"   [INSTALACAO] {skipped} unattributed row(s) skipped "
              f"(NULL installation in source; {skipped_oil:,.0f} bbl/d total oil)")
    return rows


def _parse_poco(result_json: dict, debug_dump_path: Path | None = None) -> list[dict]:
    """
    Schema idx: 0=Data, 1=NOME CAMPO, 2=BACIA, 3=NOME POCO ANP, 4=Instalacao, 5=Petroleo, 6=Gas

    campo / bacia / instalacao may be NULL (the DB columns are nullable).
    poco is part of the PK (data, poco) -> NULL-poco rows are skipped + logged.
    """
    raw = _parse_dsr_cdp_generic(result_json, 7, debug_dump_path=debug_dump_path)
    rows: list[dict] = []
    skipped = 0
    for row in raw:
        if row[3] is None or row[3] == "":
            skipped += 1
            continue
        rows.append({
            "data":             row[0],
            "campo":            row[1],
            "bacia":            row[2],
            "poco":             row[3],
            "instalacao":       row[4],
            "petroleo_bbl_dia": _to_float(row[5]),
            "gas_mm3_dia":      _to_float(row[6]),
        })
    if skipped:
        print(f"   [POCO] {skipped} row(s) skipped (NULL well name in source)")
    return rows


# ─── Paginacao mensal generica ────────────────────────────────────────────────

# Sub-chunk size (days) used when a monthly window is truncated by the Power BI
# hard cap (~30 000 rows).  7 days × ~1 000 wells = ~7 000 rows per sub-window,
# well below the cap.  If a weekly sub-chunk is *still* truncated the extractor
# logs a warning but keeps the partial data (further splitting would yield
# diminishing returns and is not expected for the current dataset size).
_SUB_CHUNK_DAYS = 7


def _fetch_chunk(
    nivel: str,
    chunk_start: date,
    chunk_end: date,
    entities_fn,
    select_fn,
    visual_id: str,
    n_cols: int,
    parse_fn,
    window: int,
    label: str,
    is_first: bool,
) -> tuple[list[dict], bool, int | None]:
    """
    Fetches a single date range from the Power BI API and parses it.

    Returns:
      (rows, is_complete, row_count_from_api)
    """
    where_conds = [
        _where_in("c", "Unidade", ["bbl"]),
        _where_date_range("d", "Data", chunk_start, chunk_end),
    ]
    payload = _build_query_body(
        entities_fn(), select_fn(), where_conds,
        visual_id, window, n_cols,
    )
    data = post_query(payload, RESOURCE_KEY)

    rc, complete = extract_row_count(data)

    if is_first:
        debug_path = DEFAULT_OUTPUT / f"_debug_cdp_{nivel.lower()}_chunk_{label}.json"
        debug_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[debug dump -> {debug_path.name}]", end="  ", flush=True)

    if nivel.lower() == "poco":
        debug_dump = DEFAULT_OUTPUT / "_debug_cdp_poco_response.json" if rc == 0 else None
        rows = _parse_poco(data, debug_dump_path=debug_dump)
    else:
        rows = parse_fn(data)

    return rows, complete, rc


def _extract_paginado(
    nivel: str,
    start: date,
    end_excl: date,
    entities_fn,
    select_fn,
    visual_id: str,
    n_cols: int,
    parse_fn,
    window: int = 100_000,
) -> list[dict]:
    """
    Extracts all records for a given level, paginating month by month.

    Sub-chunking strategy: if a monthly window returns IC=False (truncated by
    the Power BI ~30 000-row hard cap), the month is automatically retried in
    weekly sub-windows of _SUB_CHUNK_DAYS days each.  The sub-window results
    are deduplicated (by primary key columns) and concatenated, so re-running
    the pipeline is safe and idempotent.
    """
    all_rows: list[dict] = []
    truncated_months: list[str] = []
    still_truncated: list[str] = []
    first_chunk = True

    cursor = date(start.year, start.month, 1)
    DEFAULT_OUTPUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    while cursor < end_excl:
        if cursor.month == 12:
            next_month = date(cursor.year + 1, 1, 1)
        else:
            next_month = date(cursor.year, cursor.month + 1, 1)
        chunk_end = min(next_month, end_excl)

        label = cursor.strftime("%Y-%m")
        print(f"  [{nivel}] Month {label} ({cursor.isoformat()} -> {chunk_end.isoformat()})",
              end="  ", flush=True)

        rows, complete, rc = _fetch_chunk(
            nivel, cursor, chunk_end,
            entities_fn, select_fn, visual_id, n_cols, parse_fn,
            window, label, is_first=first_chunk,
        )
        first_chunk = False

        if complete is False:
            # Monthly window was truncated — retry with weekly sub-chunks.
            truncated_months.append(label)
            print(f"TRUNCATED (rc={rc}) — retrying with {_SUB_CHUNK_DAYS}-day sub-chunks...",
                  flush=True)

            sub_rows: list[dict] = []
            sub_cursor = cursor
            sub_still_truncated = False

            while sub_cursor < chunk_end:
                sub_end = min(sub_cursor + timedelta(days=_SUB_CHUNK_DAYS), chunk_end)
                sub_label = f"{sub_cursor.isoformat()}:{sub_end.isoformat()}"
                print(f"      [{nivel}] Sub-chunk {sub_label}", end="  ", flush=True)

                s_rows, s_complete, s_rc = _fetch_chunk(
                    nivel, sub_cursor, sub_end,
                    entities_fn, select_fn, visual_id, n_cols, parse_fn,
                    window, sub_label, is_first=False,
                )

                if s_complete is False:
                    sub_still_truncated = True
                    print(f"STILL TRUNCATED (rc={s_rc}) — keeping partial data",
                          flush=True)
                else:
                    print(f"{len(s_rows)} rows", flush=True)

                sub_rows.extend(s_rows)
                sub_cursor = sub_end
                time.sleep(0.2)  # brief pause between sub-chunk requests

            if sub_still_truncated:
                still_truncated.append(label)

            print(f"  [{nivel}] Sub-chunk total for {label}: {len(sub_rows)} rows")
            rows = sub_rows
        else:
            print(f"{len(rows)} rows", flush=True)

        all_rows.extend(rows)
        cursor = next_month

    elapsed = time.time() - t0
    print(f"\n  [{nivel}] Total: {len(all_rows)} rows in {elapsed:.1f}s")

    if truncated_months:
        recovered = [m for m in truncated_months if m not in still_truncated]
        print(f"  [{nivel}] Months that required sub-chunking: {truncated_months}")
        if recovered:
            print(f"  [{nivel}] Successfully recovered via sub-chunking: {recovered}")
        if still_truncated:
            print(f"  [{nivel}] WARNING — still truncated after sub-chunking: {still_truncated}")
    else:
        print(f"  [{nivel}] No months truncated.")

    return all_rows


# ─── Funcoes de extracao por nivel ────────────────────────────────────────────

def extract_producao_diaria_campo_todos(
    start: date,
    end_excl: date,
    window: int = 100_000,
) -> list[dict]:
    """
    Extrai producao diaria de todos os campos, paginando mes a mes.
    Output rows: {data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia}
    """
    return _extract_paginado(
        nivel="CAMPO",
        start=start, end_excl=end_excl,
        entities_fn=_entities_campo,
        select_fn=_select_campo,
        visual_id=VISUAL_ID_CAMPO,
        n_cols=5,
        parse_fn=parse_dsr_cdp,
        window=window,
    )


def extract_producao_diaria_instalacao_todos(
    start: date,
    end_excl: date,
    window: int = 100_000,
) -> list[dict]:
    """
    Extrai producao diaria por instalacao, paginando mes a mes.
    Output rows: {data, campo, instalacao, petroleo_bbl_dia, gas_mm3_dia}
    """
    return _extract_paginado(
        nivel="INSTALACAO",
        start=start, end_excl=end_excl,
        entities_fn=_entities_instalacao,
        select_fn=_select_instalacao,
        visual_id=VISUAL_ID_INSTALACAO,
        n_cols=5,
        parse_fn=_parse_instalacao,
        window=window,
    )


def extract_producao_diaria_poco_todos(
    start: date,
    end_excl: date,
    window: int = 100_000,
) -> list[dict]:
    """
    Extrai producao diaria por poco, paginando mes a mes.
    Output rows: {data, campo, bacia, poco, instalacao, petroleo_bbl_dia, gas_mm3_dia}
    """
    return _extract_paginado(
        nivel="POCO",
        start=start, end_excl=end_excl,
        entities_fn=_entities_poco,
        select_fn=_select_poco,
        visual_id=VISUAL_ID_POCO,
        n_cols=7,
        parse_fn=_parse_poco,
        window=window,
    )


# ─── Extracao single-campo (mantida para debug / --campo CLI) ─────────────────

def extract_producao_diaria_campo(
    campo: str = DEFAULT_CAMPO,
    start_date: date | None = None,
    end_date_excl: date | None = None,
    window: int = 500,
) -> list[dict]:
    """Extrai producao diaria do campo indicado (modo debug/single-campo)."""
    start    = start_date    or date(2025, 1, 1)
    end_excl = end_date_excl or (date.today() + timedelta(days=1))

    print(f"[CDP] Extraindo producao diaria: campo={campo}, "
          f"{start.isoformat()} ate {end_excl.isoformat()} (excl.), window={window}")

    payload = build_cdp_payload(campo, start, end_excl, window)

    DEFAULT_OUTPUT.mkdir(parents=True, exist_ok=True)
    (DEFAULT_OUTPUT / "_debug_cdp_payload.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    data = post_query(payload, RESOURCE_KEY)
    (DEFAULT_OUTPUT / "_debug_cdp_response.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    row_count, complete = extract_row_count(data)
    print(f"   Linhas API: {row_count} | Completo: {complete}")
    if complete is False:
        print(f"   ATENCAO: Truncado em {window} linhas — aumente --window se necessario")

    rows = parse_dsr_cdp(data)
    print(f"   Linhas parseadas: {len(rows)}")
    return rows


# Alias legado (mantido para compatibilidade com imports externos)
extract_producao_diaria = extract_producao_diaria_campo

# Alias legado para extract_producao_diaria_todos
def extract_producao_diaria_todos(
    start: date,
    end_excl: date,
    window: int = 100_000,
) -> list[dict]:
    """Alias legado — equivale a extract_producao_diaria_campo_todos."""
    return extract_producao_diaria_campo_todos(start, end_excl, window=window)


# ─── Upload para Supabase (generico) ─────────────────────────────────────────

def _get_service_client():
    """Service-role Supabase client from env, or None (with stderr message)."""
    url = os.environ.get("SUPABASE_URL")
    svc_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not svc_key:
        print("ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao definidos", file=sys.stderr)
        return None
    from supabase import create_client  # type: ignore[import]
    return create_client(url, svc_key)


def _is_numeric_garbage(value: str | None) -> bool:
    """
    True when an installation 'name' is actually a stray measure value (e.g.
    '3323.0017198342516', '0') left behind by the pre-fix Ø-mask parser.
    Strict regex ^[0-9.]+$ (matches the documented predicate in
    docs/etl-pipelines/PRD.md): tighter than float(), which would also accept
    'nan'/'inf'/'1e5'. No real installation name can match (real names:
    'FPSO ...', 'Polo ...', '3R-...' — the latter carries letters).
    """
    if not value:
        return False
    return re.fullmatch(r"[0-9.]+", value) is not None


def purge_instalacao_garbage() -> bool:
    """
    Self-heal for the Ø-mask parser bug (fixed 2026-06-10): before the fix, the
    daily unattributed row (Campo + Instalacao NULL) was mis-parsed and stored
    with a MEASURE VALUE as the installation name (e.g. instalacao='3323.0017...',
    NULL measures) — one zombie row per affected day. Those keys are never
    re-emitted by the fixed extractor, so the DO UPDATE upsert cannot heal them;
    they must be deleted here. Idempotent: scans the distinct instalacao keys
    and deletes only rows whose key is a pure numeric string.

    Runs inside the pipeline with the service key — no manual DML.
    """
    client = _get_service_client()
    if client is None:
        return False

    # Page through the instalacao column (PostgREST caps a request at ~1000
    # rows; the table is ~16k rows -> ~17 cheap pages) and collect garbage keys.
    garbage: set[str] = set()
    PAGE = 1000
    start = 0
    while True:
        resp = (
            client.table("anp_cdp_diaria_instalacao")
            .select("instalacao")
            .order("data")          # PK (data, instalacao) — PostgREST does not
            .order("instalacao")    # guarantee stable pages without an order
            .range(start, start + PAGE - 1)
            .execute()
        )
        batch = resp.data or []
        for r in batch:
            v = r.get("instalacao")
            if _is_numeric_garbage(v):
                garbage.add(v)
        if len(batch) < PAGE:
            break
        start += PAGE

    if not garbage:
        print("   [INSTALACAO] no garbage rows to purge")
        return True

    # Sanity bound: the Ø-mask bug left a handful of distinct numeric keys
    # (one per affected day). A count anywhere near this bound means a NEW
    # parse regression is flooding the table — refuse the mass delete.
    MAX_GARBAGE_KEYS = 500
    if len(garbage) > MAX_GARBAGE_KEYS:
        print(f"   [INSTALACAO] ABORT: {len(garbage)} numeric instalacao keys "
              f"flagged for purge (sanity bound {MAX_GARBAGE_KEYS}) — likely a "
              f"new parse regression; refusing the mass delete. Investigate "
              f"before purging.", file=sys.stderr)
        return False

    total_deleted = 0
    keys = sorted(garbage)
    CHUNK = 100  # keep the in_() URL filter comfortably short
    for i in range(0, len(keys), CHUNK):
        result = (
            client.table("anp_cdp_diaria_instalacao")
            .delete()
            .in_("instalacao", keys[i:i + CHUNK])
            .execute()
        )
        total_deleted += len(result.data) if result.data else 0
    print(f"   [INSTALACAO] purged {total_deleted} garbage row(s) across "
          f"{len(garbage)} numeric instalacao key(s) left behind by the "
          f"pre-fix Ø-mask parser")
    return True


def upload_to_supabase(records: list[dict], table: str = "anp_cdp_diaria",
                       on_conflict: str = "data,campo,bacia",
                       do_update: bool = False) -> bool:
    """
    Upsert para tabela indicada. Lotes de 500.
    Le SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do env.

    Semantica por nivel (do_update):
      - do_update=False (campo level): ON CONFLICT DO NOTHING — snapshot
        imutavel; revisoes retroativas da ANP nao sao refletidas (decisao do
        usuario em 2026-05-08). O nivel campo foi verificado byte-identico ao
        painel em 2026-06-10 e permanece append-only.
      - do_update=True (instalacao + poco levels): ON CONFLICT DO UPDATE —
        required so a full-range re-run SELF-HEALS the historical damage from
        the Ø-mask parser bug (garbage campo + mis-assigned measures at the
        installation level) and from the v_instalacoes_final join drops at the
        well level (entire well-days missing). Decided 2026-06-10.

    PKs por nivel:
      anp_cdp_diaria            -> on_conflict="data,campo,bacia"
      anp_cdp_diaria_instalacao -> on_conflict="data,instalacao"
      anp_cdp_diaria_poco       -> on_conflict="data,poco"
    """
    client = _get_service_client()
    if client is None:
        return False

    # Deduplicar por PK composta antes do upsert (evita double-update em batch)
    pk_keys = [k.strip() for k in on_conflict.split(",")]
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for r in records:
        key_tuple = tuple(r.get(k) for k in pk_keys)
        if key_tuple not in seen:
            seen.add(key_tuple)
            deduped.append(r)

    if len(deduped) < len(records):
        print(f"   Deduplicacao: {len(records)} -> {len(deduped)} linhas")

    BATCH = 500
    total = len(deduped)
    mode = "upsert DO UPDATE" if do_update else "upsert append-only"
    print(f"{mode}: {total} rows into {table}...")
    for i in range(0, total, BATCH):
        batch = deduped[i:i + BATCH]
        result = client.table(table).upsert(
            batch,
            on_conflict=on_conflict,
            ignore_duplicates=not do_update,
        ).execute()
        if do_update:
            print(f"   {min(i + BATCH, total)}/{total} ok (upserted={len(result.data) if result.data else 0})")
        else:
            inserted = len(result.data) if result.data else 0
            skipped = len(batch) - inserted
            print(f"   {min(i + BATCH, total)}/{total} ok (inserted={inserted}, skipped={skipped})")
    print(f"Upsert concluido: {table}")
    return True


# ─── Escrita do CSV ───────────────────────────────────────────────────────────

FIELDNAMES_BY_LEVEL = {
    "campo":      ["data", "campo", "bacia", "petroleo_bbl_dia", "gas_mm3_dia"],
    "instalacao": ["data", "campo", "instalacao", "petroleo_bbl_dia", "gas_mm3_dia"],
    "poco":       ["data", "campo", "bacia", "poco", "instalacao", "petroleo_bbl_dia", "gas_mm3_dia"],
}

TABLE_BY_LEVEL = {
    "campo":      "anp_cdp_diaria",
    "instalacao": "anp_cdp_diaria_instalacao",
    "poco":       "anp_cdp_diaria_poco",
}

CONFLICT_BY_LEVEL = {
    "campo":      "data,campo,bacia",
    "instalacao": "data,instalacao",
    "poco":       "data,poco",
}

# campo: immutable snapshot (DO NOTHING, user decision 2026-05-08).
# instalacao/poco: DO UPDATE so full-range re-runs self-heal the Ø-mask
# corruption and the join-induced well drops (decision 2026-06-10).
DO_UPDATE_BY_LEVEL = {
    "campo":      False,
    "instalacao": True,
    "poco":       True,
}


def write_csv(rows: list[dict], output_path: Path, level: str = "campo") -> None:
    """Escreve CSV virgula UTF-8 BOM (Excel-friendly)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = FIELDNAMES_BY_LEVEL.get(level, list(rows[0].keys()) if rows else [])
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=",", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"CSV salvo: {output_path} ({len(rows)} linhas)")


def _print_stats(level: str, rows: list[dict]) -> None:
    if not rows:
        print(f"  [{level.upper()}] Nenhuma linha.")
        return
    datas = sorted({r["data"] for r in rows if r["data"]})
    min_data = datas[0] if datas else "N/A"
    max_data = datas[-1] if datas else "N/A"
    print(f"\n--- Estatisticas [{level.upper()}] ---")
    print(f"  Total linhas  : {len(rows)}")
    print(f"  Range de datas: {min_data} -> {max_data}")
    print("  Sample (3 linhas):")
    for r in rows[:3]:
        print(f"    {r}")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="ANP CDP Power BI extractor — 3 niveis")

    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true",
                      help="[LEGADO] Extrair todos os campos (equiv. a --level campo). "
                           "Mantido para backward compat.")
    mode.add_argument("--campo", default=None, metavar="NOME",
                      help="[LEGADO] Extrair campo especifico (ex: PEREGRINO)")
    mode.add_argument("--level", choices=["campo", "instalacao", "poco", "all"], default=None,
                      help="Nivel de granularidade. Default: all (3 niveis)")

    p.add_argument("--start",  type=lambda s: date.fromisoformat(s),
                   default=date(2025, 11, 9),
                   help="Data inicial ISO (padrao: 2025-11-09 — primeira data com dados no Power BI ANP CDP)")
    p.add_argument("--end",    type=lambda s: date.fromisoformat(s),
                   default=None,
                   help="Data final exclusiva ISO (padrao: amanha)")
    p.add_argument("--output", type=Path, default=None,
                   help="Caminho de saida do CSV (ignorado quando --level all)")
    p.add_argument("--window", type=int, default=None,
                   help="Override da Window.Count do Power BI")
    p.add_argument("--upload", action="store_true",
                   help="Apos extrair, fazer upsert no Supabase (requer SUPABASE_SERVICE_ROLE_KEY)")

    args = p.parse_args()

    end_excl = args.end or (date.today() + timedelta(days=1))

    # ── Normalizar modo ──────────────────────────────────────────────────────
    # --campo NOME  => modo legado single-campo
    # --all         => legado, equiv. a --level campo
    # --level X     => novo
    # (nenhum)      => default all
    if args.campo:
        mode_str = "_single_campo"
    elif args.all:
        mode_str = "campo"
    elif args.level:
        mode_str = args.level
    else:
        mode_str = "all"

    # ── Modo single-campo (legado debug) ─────────────────────────────────────
    if mode_str == "_single_campo":
        window = args.window or 500
        campo = args.campo
        out = args.output or (DEFAULT_OUTPUT / f"anp_cdp_diaria_{campo.lower()}.csv")
        try:
            rows = extract_producao_diaria_campo(campo, args.start, end_excl, window=window)
        except (requests.HTTPError, ValueError) as e:
            print(f"ERRO: {e}", file=sys.stderr)
            sys.exit(1)
        if not rows:
            print("ERRO: Nenhuma linha retornada.", file=sys.stderr)
            sys.exit(1)
        write_csv(rows, out, level="campo")
        _print_stats("campo", rows)
        if args.upload:
            ok = upload_to_supabase(rows, TABLE_BY_LEVEL["campo"], CONFLICT_BY_LEVEL["campo"],
                                    do_update=DO_UPDATE_BY_LEVEL["campo"])
            if not ok:
                sys.exit(1)
        return

    # ── Determinar quais niveis executar ──────────────────────────────────────
    if mode_str == "all":
        levels = ["campo", "instalacao", "poco"]
    else:
        levels = [mode_str]

    window = args.window or 100_000
    results: dict[str, list[dict]] = {}

    for lvl in levels:
        print(f"\n📦 Extraindo nivel {lvl.upper()}...")
        try:
            if lvl == "campo":
                rows = extract_producao_diaria_campo_todos(args.start, end_excl, window=window)
            elif lvl == "instalacao":
                rows = extract_producao_diaria_instalacao_todos(args.start, end_excl, window=window)
            else:  # poco
                rows = extract_producao_diaria_poco_todos(args.start, end_excl, window=window)
        except (requests.HTTPError, ValueError) as e:
            print(f"ERRO [{lvl.upper()}]: {e}", file=sys.stderr)
            if len(levels) == 1:
                sys.exit(1)
            print(f"  -> Continuando com proximos niveis...")
            results[lvl] = []
            continue

        if not rows:
            print(f"AVISO [{lvl.upper()}]: Nenhuma linha retornada.", file=sys.stderr)
            results[lvl] = []
        else:
            results[lvl] = rows

    # ── CSV output ────────────────────────────────────────────────────────────
    any_ok = any(len(v) > 0 for v in results.values())
    if not any_ok:
        print("ERRO: Nenhuma linha retornada em nenhum nivel.", file=sys.stderr)
        sys.exit(1)

    for lvl, rows in results.items():
        if not rows:
            continue
        if args.output and len(levels) == 1:
            out = args.output
        else:
            out = DEFAULT_OUTPUT / f"anp_cdp_diaria_{lvl}_completo.csv"
        write_csv(rows, out, level=lvl)
        _print_stats(lvl, rows)

    # ── Upload ────────────────────────────────────────────────────────────────
    if args.upload:
        for lvl, rows in results.items():
            if not rows:
                print(f"[{lvl.upper()}] Skip upsert (0 linhas)")
                continue
            if lvl == "instalacao":
                # Self-heal: drop zombie rows keyed by numeric garbage
                # installation names (pre-fix Ø-mask parser). Idempotent and
                # runs on EVERY execution (cheap ~17-page scan) — remove this
                # call once the table is confirmed clean across a few runs.
                if not purge_instalacao_garbage():
                    sys.exit(1)
            ok = upload_to_supabase(rows, TABLE_BY_LEVEL[lvl], CONFLICT_BY_LEVEL[lvl],
                                    do_update=DO_UPDATE_BY_LEVEL[lvl])
            if not ok:
                sys.exit(1)


if __name__ == "__main__":
    main()
