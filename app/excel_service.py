import io
import os
import unicodedata
from datetime import datetime
from typing import Dict, Any, Optional
import openpyxl
from sqlalchemy.orm import Session
from app.models import Turma, User
from app.auth import hash_password

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_RODA_PATH = os.path.join(BASE_DIR, "assets", "template_roda_saude.xlsx")
TEMPLATE_COMPETENCIAS_PATH = os.path.join(BASE_DIR, "assets", "template_roda_competencias.xlsx")
DEFAULT_ALUNOS_PATH = os.path.join(BASE_DIR, "assets", "dados_alunos_padrao.xlsx")


def _norm_header(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip().upper()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s


def _sanitize_text(val: Any, max_len: int = 250) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    # Prevent CSV/Excel formula injection
    while s and s[0] in ("=", "+", "@", "\t", "\r", "\n"):
        s = s[1:].strip()
    return s[:max_len] if s else None


def import_students_from_workbook(wb: openpyxl.Workbook, db: Session) -> Dict[str, Any]:
    """
    Reads an Excel workbook like 'PÓS GRADUAÇÃO - MBA LIDERANÇA 4.0 - DADOS ALUNOS.XLSX'
    and creates/updates Turmas and Users (with email as login and default password 123456).
    """
    ws = wb.active
    headers = {}
    header_row = 1

    for r in range(1, min(10, ws.max_row + 1)):
        row_headers = {}
        for c in range(1, ws.max_column + 1):
            h = _norm_header(ws.cell(r, c).value)
            if h:
                row_headers[h] = c
        if "EMAIL" in row_headers or "E-MAIL" in row_headers or "ALUNO" in row_headers:
            headers = row_headers
            header_row = r
            break

    if not headers:
        raise ValueError(
            "Planilha inválida: não foram encontradas as colunas esperadas (ex.: ALUNO, EMAIL, CODTURMA)."
        )

    col_aluno = headers.get("ALUNO") or headers.get("NOME") or headers.get("NOME_ALUNO")
    col_email = headers.get("EMAIL") or headers.get("E-MAIL")
    col_ra = headers.get("RA") or headers.get("MATRICULA")
    col_codfilial = headers.get("CODFILIAL")
    col_codcurso = headers.get("CODCURSO")
    col_nomecurso = headers.get("NOME_CURSO") or headers.get("CURSO")
    col_codturma = headers.get("CODTURMA") or headers.get("TURMA")
    col_situacao = headers.get("SITUACAO")
    col_periodo = headers.get("PERIODO_LETIVO") or headers.get("PERIODO")
    col_nomefilial = headers.get("NOME_FILIAL") or headers.get("FILIAL")

    if not col_email or not col_aluno:
        raise ValueError("A planilha precisa conter pelo menos as colunas 'ALUNO' e 'EMAIL'.")

    created_users = 0
    updated_users = 0
    turmas_touched = set()
    default_pw_hash = hash_password("123456")

    for r in range(header_row + 1, min(ws.max_row + 1, 5000)):
        nome = _sanitize_text(ws.cell(r, col_aluno).value if col_aluno else None, 250)
        email_raw = _sanitize_text(ws.cell(r, col_email).value if col_email else None, 250)

        if not nome or not email_raw:
            continue

        email = email_raw.lower()
        if "@" not in email:
            continue

        ra = _sanitize_text(ws.cell(r, col_ra).value if col_ra else None, 50)
        cod_filial = _sanitize_text(ws.cell(r, col_codfilial).value if col_codfilial else None, 50)
        cod_curso = _sanitize_text(ws.cell(r, col_codcurso).value if col_codcurso else None, 50)
        nome_curso = _sanitize_text(ws.cell(r, col_nomecurso).value if col_nomecurso else None, 250) or "Curso Geral"
        cod_turma = _sanitize_text(ws.cell(r, col_codturma).value if col_codturma else None, 100) or "TURMA-GERAL"
        situacao = _sanitize_text(ws.cell(r, col_situacao).value if col_situacao else None, 100) or "MATRICULADO"
        periodo = _sanitize_text(ws.cell(r, col_periodo).value if col_periodo else None, 50) or str(datetime.now().year)
        nome_filial = _sanitize_text(ws.cell(r, col_nomefilial).value if col_nomefilial else None, 250)

        # Find or create Turma
        turma = db.query(Turma).filter(Turma.cod_turma == cod_turma).first()
        if not turma:
            turma = Turma(
                cod_turma=cod_turma,
                cod_curso=cod_curso,
                nome_curso=nome_curso,
                cod_filial=cod_filial,
                nome_filial=nome_filial,
                periodo_letivo=periodo,
            )
            db.add(turma)
            db.flush()
        else:
            if nome_curso:
                turma.nome_curso = nome_curso
            if cod_curso:
                turma.cod_curso = cod_curso
            if cod_filial:
                turma.cod_filial = cod_filial
            if nome_filial:
                turma.nome_filial = nome_filial
            if periodo:
                turma.periodo_letivo = periodo

        turmas_touched.add(turma.cod_turma)

        # Find or create User
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                nome=nome,
                email=email,
                password_hash=default_pw_hash,
                role="padrao",
                ra=ra,
                situacao_matricula=situacao,
                turma_id=turma.id,
                autorizado=True,
                primeiro_acesso=True,
            )
            db.add(user)
            created_users += 1
        else:
            if user.role != "admin":
                user.nome = nome
                user.ra = ra
                user.situacao_matricula = situacao
                user.turma_id = turma.id
                user.autorizado = True
                updated_users += 1

    db.commit()
    return {
        "novos_alunos": created_users,
        "alunos_atualizados": updated_users,
        "total_processados": created_users + updated_users,
        "turmas": sorted(list(turmas_touched)),
    }


def generate_filled_excel_bytes(nome_usuario: str, data_avaliacao: str, respostas_raw: Dict[str, Any]) -> bytes:
    """
    Loads the original Roda_da_Saude_Integral_Sheila_Ricoy.xlsx template,
    populates the user's name, evaluation date, and 50 answers (Nota or Sem nota),
    and returns the binary .xlsx bytes with all original formulas and charts intact.
    """
    wb = openpyxl.load_workbook(TEMPLATE_RODA_PATH)
    ws_q = wb["Questionário"]

    ws_q["B6"] = _sanitize_text(nome_usuario, 150) or ""
    ws_q["E6"] = _sanitize_text(data_avaliacao, 40) or datetime.now().strftime("%d/%m/%Y")

    for num in range(1, 51):
        row_idx = 9 + num  # Row 10 is Item 1, Row 59 is Item 50
        ans = respostas_raw.get(str(num), {}) if isinstance(respostas_raw, dict) else {}
        nota = ans.get("nota")
        sem_nota = ans.get("sem_nota")

        if nota is not None and str(nota).strip() != "":
            try:
                ws_q.cell(row_idx, 6).value = int(float(nota))
                ws_q.cell(row_idx, 7).value = None
            except (ValueError, TypeError):
                ws_q.cell(row_idx, 6).value = None
        elif sem_nota and str(sem_nota).strip() != "":
            ws_q.cell(row_idx, 6).value = None
            ws_q.cell(row_idx, 7).value = str(sem_nota).strip()
        else:
            ws_q.cell(row_idx, 6).value = None
            ws_q.cell(row_idx, 7).value = None

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _parse_excel_date(date_str: Optional[str]):
    if not date_str:
        return datetime.now().date()
    s = str(date_str).strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return datetime.now().date()


def generate_filled_competencias_excel_bytes(
    nome_usuario: str,
    cargo_area: Optional[str],
    data_avaliacao: str,
    respostas_raw: Dict[str, Any],
    historico_raw: Optional[list] = None,
    plano_acao_raw: Optional[Dict[str, Any]] = None,
) -> bytes:
    """
    Loads the original Roda_Integrada_Lideranca_Competencias.xlsx template,
    populates up to 4 applications (Columns D, E, F, G in 'Autoavaliação')
    plus the Action Plan (rows 62+ in 'Autoavaliação'), keeping all formulas and charts intact.
    """
    wb = openpyxl.load_workbook(TEMPLATE_COMPETENCIAS_PATH)
    ws_auto = wb["Autoavaliação"]

    ws_auto["C2"] = _sanitize_text(nome_usuario, 150) or ""
    ws_auto["C3"] = _sanitize_text(cargo_area, 150) or ""

    all_apps = []
    if isinstance(historico_raw, list):
        for h in historico_raw:
            if isinstance(h, dict) and h.get("respostas"):
                all_apps.append({
                    "data": h.get("data_avaliacao"),
                    "respostas": h.get("respostas", {}),
                })
    if respostas_raw:
        all_apps.append({
            "data": data_avaliacao,
            "respostas": respostas_raw,
        })

    if len(all_apps) > 4:
        all_apps = [all_apps[0]] + all_apps[-3:]

    # Columns D (4), E (5), F (6), G (7) in Autoavaliação
    for app_idx, app_entry in enumerate(all_apps[:4]):
        col_idx = 4 + app_idx
        ws_auto.cell(2, col_idx).value = _parse_excel_date(app_entry.get("data"))
        resp_dict = app_entry.get("respostas", {})
        for num in range(1, 51):
            row_idx = 5 + num  # Row 6 is Item 1, Row 55 is Item 50
            ans = resp_dict.get(str(num), {}) if isinstance(resp_dict, dict) else {}
            nota = ans.get("nota")
            if nota is not None and str(nota).strip() != "":
                try:
                    ws_auto.cell(row_idx, col_idx).value = int(float(nota))
                except (ValueError, TypeError):
                    ws_auto.cell(row_idx, col_idx).value = None
            else:
                ws_auto.cell(row_idx, col_idx).value = None

    # Populate Plano de Ação in Autoavaliação rows 62..71
    if isinstance(plano_acao_raw, dict):
        row_cursor = 62
        for eixo_nome, plan_item in plano_acao_raw.items():
            if not isinstance(plan_item, dict):
                continue
            acao_txt = _sanitize_text(plan_item.get("acoes") or plan_item.get("objetivo"), 300)
            meta_txt = _sanitize_text(plan_item.get("meta_nota") or plan_item.get("objetivo"), 60)
            prazo_txt = _sanitize_text(plan_item.get("prazo"), 80)
            if not (acao_txt or meta_txt or prazo_txt):
                continue
            ws_auto.cell(row_cursor, 2).value = _sanitize_text(eixo_nome, 150)
            ws_auto.cell(row_cursor, 3).value = acao_txt or ""
            # Try numeric meta if possible (since D62:D64 has decimal validation 0..10)
            if meta_txt:
                try:
                    ws_auto.cell(row_cursor, 4).value = float(str(meta_txt).replace(",", "."))
                except ValueError:
                    ws_auto.cell(row_cursor, 4).value = meta_txt
            ws_auto.cell(row_cursor, 5).value = prazo_txt or ""
            row_cursor += 1
            if row_cursor > 71:
                break

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()

