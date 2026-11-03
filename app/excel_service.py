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
