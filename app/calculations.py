import json
import os
from typing import Dict, Any, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JSON_PATH = os.path.join(BASE_DIR, "questionnaire_data.json")

with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
    QUESTIONNAIRE_META = json.load(f)

QUESTIONS: List[Dict[str, Any]] = QUESTIONNAIRE_META["questions"]
EIXOS: List[Dict[str, Any]] = QUESTIONNAIRE_META["eixos"]
TUTORIAL: Dict[str, Any] = QUESTIONNAIRE_META["tutorial"]

VALID_SEM_NOTA = {"Não se aplica", "Prefiro não responder"}


def evaluate_item_status(nota: Any, sem_nota: Optional[str]) -> str:
    """
    Replicates the exact Excel formula in Questionário!H10:H59:
    =IF(AND(NOT(ISBLANK(F10)),G10<>""),"Escolha nota ou motivo",
      IF(G10<>"",G10,
        IF(ISBLANK(F10),"Não respondido",
          IF(NOT(ISNUMBER(F10)),"Nota inválida",
            IF(OR(F10<1,F10>10,MOD(F10,1)<>0),"Nota inválida",
              IF(F10<=6,"Nota até 6","Nota acima de 6"))))))
    """
    has_nota = nota is not None and str(nota).strip() != ""
    sem_nota_clean = (sem_nota or "").strip()
    has_sem_nota = sem_nota_clean != ""

    if has_nota and has_sem_nota:
        return "Escolha nota ou motivo"
    if has_sem_nota:
        if sem_nota_clean in VALID_SEM_NOTA:
            return sem_nota_clean
        return "Nota inválida"
    if not has_nota:
        return "Não respondido"

    try:
        val = float(nota)
        if val < 1 or val > 10 or (val % 1) != 0:
            return "Nota inválida"
        ival = int(val)
        return "Nota até 6" if ival <= 6 else "Nota acima de 6"
    except (ValueError, TypeError):
        return "Nota inválida"


def compute_individual_results(respostas_raw: Dict[str, Any], concluido: bool = False) -> Dict[str, Any]:
    """
    Computes the complete individual report following all formulas in
    'Questionário' and 'Gráficos' of Roda_da_Saude_Integral_Sheila_Ricoy.xlsx.
    """
    items_evaluated = []
    by_dimension: Dict[str, List[Dict[str, Any]]] = {e["dimensao"]: [] for e in EIXOS}

    for q in QUESTIONS:
        num_str = str(q["numero"])
        ans = respostas_raw.get(num_str, {}) if isinstance(respostas_raw, dict) else {}
        raw_nota = ans.get("nota")
        raw_sem_nota = ans.get("sem_nota")

        situacao = evaluate_item_status(raw_nota, raw_sem_nota)
        nota_valida: Optional[int] = int(float(raw_nota)) if situacao in ("Nota até 6", "Nota acima de 6") else None

        rotulo_eletrovitae = f"{q['numero']:02d} {q['item']}"
        item_data = {
            "numero": q["numero"],
            "dimensao": q["dimensao"],
            "item": q["item"],
            "rotulo": rotulo_eletrovitae,
            "pergunta": q["pergunta"],
            "exemplo": q["exemplo"],
            "revisao": q["revisao"],
            "nota": nota_valida,
            "sem_nota": (raw_sem_nota or "").strip() if situacao in VALID_SEM_NOTA else None,
            "situacao": situacao,
        }
        items_evaluated.append(item_data)
        by_dimension[q["dimensao"]].append(item_data)

    # Relatório de Notas por Dimensão (Gráficos!A10:F20)
    relatorio_dimensoes = []
    radar_labels = []
    radar_values = []

    total_com_nota = 0
    total_sem_nota = 0
    soma_todas_notas = 0
    total_respondidos = 0
    total_erros = 0

    for eixo in EIXOS:
        dim_name = eixo["dimensao"]
        dim_short = eixo["dimensao_curta"]
        dim_items = by_dimension.get(dim_name, [])

        com_nota = sum(1 for it in dim_items if it["situacao"] in ("Nota até 6", "Nota acima de 6"))
        soma_notas = sum(it["nota"] for it in dim_items if it["nota"] is not None)
        sem_nota_cnt = sum(1 for it in dim_items if it["situacao"] in VALID_SEM_NOTA)
        erros_cnt = sum(1 for it in dim_items if it["situacao"] in ("Nota inválida", "Escolha nota ou motivo"))

        media_dim: Optional[float] = round(soma_notas / com_nota, 2) if com_nota > 0 else None

        # Exact formula from Gráficos!E11:E20:
        # =IF(erros>0,"Rever respostas",IF(B11+D11=5,IF(B11=0,"Sem notas","Concluída"),IF(B11>0,"Parcial","Aguardando")))
        if erros_cnt > 0:
            preenchimento = "Rever respostas"
        elif (com_nota + sem_nota_cnt) == 5:
            preenchimento = "Sem notas" if com_nota == 0 else "Concluída"
        elif com_nota > 0 or sem_nota_cnt > 0:
            preenchimento = "Parcial"
        else:
            preenchimento = "Aguardando"

        relatorio_dimensoes.append({
            "ordem": eixo["ordem"],
            "dimensao": dim_name,
            "dimensao_curta": dim_short,
            "o_que_avalia": eixo["o_que_avalia"],
            "com_nota": com_nota,
            "media": media_dim,
            "sem_nota": sem_nota_cnt,
            "preenchimento": preenchimento,
            "revisao": eixo["revisao"],
            "observacao": eixo["observacao"],
        })

        # Support data for Radar (Gráficos!Y90:Z99): =IF(B11>0,C11,NA())
        radar_labels.append(dim_short)
        radar_values.append(media_dim)

        total_com_nota += com_nota
        total_sem_nota += sem_nota_cnt
        soma_todas_notas += soma_notas
        total_respondidos += (com_nota + sem_nota_cnt)
        total_erros += erros_cnt

    # Support data for Eletrovitae (Gráficos!Y104:AA153)
    eletrovitae_labels = [it["rotulo"] for it in items_evaluated]
    eletrovitae_values = [it["nota"] for it in items_evaluated]  # None becomes null (#N/A in chart)
    eletrovitae_ref6 = [6 for _ in items_evaluated]

    media_geral = round(soma_todas_notas / total_com_nota, 2) if total_com_nota > 0 else None
    mensagem_status = (
        "Preencha as notas na aba Questionário para visualizar seus resultados."
        if total_com_nota == 0
        else f"Itens com nota válida: {total_com_nota} de 50"
    )

    assuntos_a_explorar = [
        it for it in items_evaluated if it["situacao"] == "Nota até 6"
    ]
    assuntos_a_explorar_sorted = sorted(assuntos_a_explorar, key=lambda x: (x["nota"], x["numero"]))

    pontos_fortes = [
        it for it in items_evaluated if it["situacao"] == "Nota acima de 6"
    ]
    pontos_fortes_sorted = sorted(pontos_fortes, key=lambda x: (-x["nota"], x["numero"]))

    return {
        "concluido": concluido,
        "resumo": {
            "total_itens": 50,
            "total_respondidos": total_respondidos,
            "total_com_nota": total_com_nota,
            "total_sem_nota": total_sem_nota,
            "total_pendentes": 50 - total_respondidos,
            "total_erros": total_erros,
            "media_geral": media_geral,
            "mensagem_status": mensagem_status,
            "total_assuntos_explorar": len(assuntos_a_explorar),
            "pode_finalizar": (total_respondidos == 50 and total_erros == 0),
        },
        "relatorio_dimensoes": relatorio_dimensoes,
        "roda_radar": {
            "labels": radar_labels,
            "values": radar_values,
            "referencia_6": [6 for _ in radar_labels],
        },
        "eletrovitae": {
            "labels": eletrovitae_labels,
            "values": eletrovitae_values,
            "referencia_6": eletrovitae_ref6,
        },
        "assuntos_a_explorar": assuntos_a_explorar_sorted,
        "pontos_fortes": pontos_fortes_sorted,
        "itens": items_evaluated,
    }


def compute_turma_report(
    turma_info: Dict[str, Any],
    total_alunos_turma: int,
    assessments_respostas: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Computes the ANONYMOUS aggregated class report for the Admin.
    Does NOT expose any individual student scores or responses.
    """
    num_respondentes = len(assessments_respostas)
    individual_results = [compute_individual_results(r, concluido=True) for r in assessments_respostas]

    # Aggregate per dimension (10 dimensions)
    dim_stats = []
    for idx, eixo in enumerate(EIXOS):
        dim_name = eixo["dimensao"]
        dim_short = eixo["dimensao_curta"]

        # Collect all student dimension averages where the student had at least 1 valid note in that dimension
        medias_alunos_dim = []
        notas_itens_dim = []
        for res in individual_results:
            d_row = res["relatorio_dimensoes"][idx]
            if d_row["media"] is not None:
                medias_alunos_dim.append(d_row["media"])
            for it in res["itens"]:
                if it["dimensao"] == dim_name and it["nota"] is not None:
                    notas_itens_dim.append(it["nota"])

        media_turma_dim = round(sum(medias_alunos_dim) / len(medias_alunos_dim), 2) if medias_alunos_dim else None
        pct_ate_6 = (
            round(sum(1 for n in notas_itens_dim if n <= 6) * 100.0 / len(notas_itens_dim), 1)
            if notas_itens_dim
            else 0.0
        )

        dim_stats.append({
            "ordem": eixo["ordem"],
            "dimensao": dim_name,
            "dimensao_curta": dim_short,
            "o_que_avalia": eixo["o_que_avalia"],
            "media_turma": media_turma_dim,
            "respondentes_com_nota": len(medias_alunos_dim),
            "total_notas_validas": len(notas_itens_dim),
            "percentual_ate_6": pct_ate_6,
        })

    # Aggregate per item of Eletrovitae (50 items)
    item_stats = []
    todas_notas_turma = []

    for q_idx, q in enumerate(QUESTIONS):
        notas_item = []
        sem_nota_item = 0
        for res in individual_results:
            it = res["itens"][q_idx]
            if it["nota"] is not None:
                notas_item.append(it["nota"])
                todas_notas_turma.append(it["nota"])
            elif it["situacao"] in VALID_SEM_NOTA:
                sem_nota_item += 1

        media_item = round(sum(notas_item) / len(notas_item), 2) if notas_item else None
        pct_ate_6_item = (
            round(sum(1 for n in notas_item if n <= 6) * 100.0 / len(notas_item), 1)
            if notas_item
            else 0.0
        )

        item_stats.append({
            "numero": q["numero"],
            "dimensao": q["dimensao"],
            "dimensao_curta": q["dimensao"].replace("Saúde ", ""),
            "item": q["item"],
            "rotulo": f"{q['numero']:02d} {q['item']}",
            "pergunta": q["pergunta"],
            "media_turma": media_item,
            "respostas_com_nota": len(notas_item),
            "respostas_sem_nota": sem_nota_item,
            "percentual_ate_6": pct_ate_6_item,
        })

    # Overall class average (average of student overall averages, or average of all valid scores)
    medias_gerais_alunos = [
        res["resumo"]["media_geral"]
        for res in individual_results
        if res["resumo"]["media_geral"] is not None
    ]
    media_geral_turma = (
        round(sum(medias_gerais_alunos) / len(medias_gerais_alunos), 2)
        if medias_gerais_alunos
        else None
    )

    # Rankings of Dimensions (Melhores e Piores Dimensões Médias)
    dims_com_media = [d for d in dim_stats if d["media_turma"] is not None]
    melhores_dimensoes = sorted(dims_com_media, key=lambda x: (-x["media_turma"], x["ordem"]))[:3]
    piores_dimensoes = sorted(dims_com_media, key=lambda x: (x["media_turma"], x["ordem"]))[:3]

    # Rankings of Items (Melhores e Piores Indicadores Médios do Eletrovitae)
    itens_com_media = [it for it in item_stats if it["media_turma"] is not None]
    melhores_indicadores = sorted(itens_com_media, key=lambda x: (-x["media_turma"], x["numero"]))[:5]
    piores_indicadores = sorted(itens_com_media, key=lambda x: (x["media_turma"], x["numero"]))[:5]
    indicadores_atencao_ate_6 = sorted(
        [it for it in itens_com_media if it["media_turma"] <= 6.0],
        key=lambda x: (x["media_turma"], x["numero"])
    )

    taxa_participacao = (
        round((num_respondentes * 100.0) / total_alunos_turma, 1)
        if total_alunos_turma > 0
        else 0.0
    )

    return {
        "turma": turma_info,
        "resumo_turma": {
            "total_alunos": total_alunos_turma,
            "total_respondentes": num_respondentes,
            "taxa_participacao": taxa_participacao,
            "media_geral_turma": media_geral_turma,
            "total_indicadores_ate_6": len(indicadores_atencao_ate_6),
        },
        "melhores_dimensoes": melhores_dimensoes,
        "piores_dimensoes": piores_dimensoes,
        "melhores_indicadores": melhores_indicadores,
        "piores_indicadores": piores_indicadores,
        "indicadores_atencao_ate_6": indicadores_atencao_ate_6,
        "relatorio_dimensoes": dim_stats,
        "relatorio_itens": item_stats,
        "roda_radar": {
            "labels": [d["dimensao_curta"] for d in dim_stats],
            "values": [d["media_turma"] for d in dim_stats],
            "referencia_6": [6 for _ in dim_stats],
        },
        "eletrovitae": {
            "labels": [it["rotulo"] for it in item_stats],
            "values": [it["media_turma"] for it in item_stats],
            "referencia_6": [6 for _ in item_stats],
        },
    }

