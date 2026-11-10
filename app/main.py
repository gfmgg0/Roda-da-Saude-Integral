import io
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
import openpyxl
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal, get_db, Base
from app.models import User, Turma, Assessment, CompetenciaAssessment, AuditLog
from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
)
from app.calculations import (
    QUESTIONS,
    EIXOS,
    TUTORIAL,
    COMP_QUESTIONS,
    COMP_EIXOS,
    COMP_TUTORIAL,
    compute_individual_results,
    compute_turma_report,
    compute_competencias_results,
    build_quatro_aplicacoes_table,
    compute_competencias_turma_report,
)
from app.excel_service import (
    import_students_from_workbook,
    generate_filled_excel_bytes,
    generate_filled_competencias_excel_bytes,
    DEFAULT_ALUNOS_PATH,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "app", "static")
os.makedirs(STATIC_DIR, exist_ok=True)

ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").lower() == "true"

app = FastAPI(
    title="Roda da Saúde Integral - Profa. Sheila Ricoy",
    description="Aplicação Web de Autopercepção em 10 Dimensões, Roda da Saúde, Relatório de Notas, Eletrovitae e Plano de Ação.",
    version="1.1.0",
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ---------------------------------------------------------------------------
# Cybersecurity: Rate Limiting & Security Headers Middleware
# ---------------------------------------------------------------------------
_rate_limit_buckets: Dict[str, List[float]] = defaultdict(list)
MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def check_rate_limit(key: str, max_requests: int, window_seconds: int):
    now = time.time()
    bucket = _rate_limit_buckets[key]
    _rate_limit_buckets[key] = [t for t in bucket if now - t < window_seconds]
    if len(_rate_limit_buckets[key]) >= max_requests:
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente.",
        )
    _rate_limit_buckets[key].append(now)


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:60]
    return (request.client.host if request.client else "unknown")[:60]


def log_audit(db: Session, evento: str, email: Optional[str], ip: str, detalhes: str = ""):
    try:
        entry = AuditLog(
            evento=evento[:80],
            email=(email or "")[:255],
            ip_address=ip[:64],
            detalhes=detalhes[:500],
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


# ---------------------------------------------------------------------------
# Startup: Create tables, migrate columns if needed, seed Admin & default Excel
# ---------------------------------------------------------------------------
def _ensure_assessment_columns(db: Session):
    try:
        cols_res = db.execute(text("PRAGMA table_info(assessments)")).fetchall()
        existing_cols = {row[1] for row in cols_res}
        if "historico_json" not in existing_cols:
            db.execute(text("ALTER TABLE assessments ADD COLUMN historico_json TEXT NOT NULL DEFAULT '[]'"))
        if "plano_acao_json" not in existing_cols:
            db.execute(text("ALTER TABLE assessments ADD COLUMN plano_acao_json TEXT NOT NULL DEFAULT '{}'"))
        if "completed_at" not in existing_cols:
            db.execute(text("ALTER TABLE assessments ADD COLUMN completed_at DATETIME"))
        db.commit()
    except Exception:
        db.rollback()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_assessment_columns(db)
        admin_email = "shcosta@fiemg.com.br"
        admin = db.query(User).filter(User.email == admin_email).first()
        if not admin:
            admin = User(
                nome="Profa. Sheila Ricoy",
                email=admin_email,
                password_hash=hash_password("123456"),
                role="admin",
                ra=None,
                situacao_matricula="DOCENTE / ADMIN",
                turma_id=None,  # Admin never belongs to any Turma
                autorizado=True,
                primeiro_acesso=True,
            )
            db.add(admin)
            db.commit()

        # Pre-load the default students Excel if no Turmas exist yet
        if db.query(Turma).count() == 0 and os.path.exists(DEFAULT_ALUNOS_PATH):
            wb = openpyxl.load_workbook(DEFAULT_ALUNOS_PATH, data_only=True)
            import_students_from_workbook(wb, db)

        # Ensure secondary Admin account (admin@admin.com) exists
        sys_admin_email = "admin@admin.com"
        sys_admin = db.query(User).filter(User.email == sys_admin_email).first()
        if not sys_admin:
            sys_admin = User(
                nome="Administrador Geral",
                email=sys_admin_email,
                password_hash=hash_password("123456"),
                role="admin",
                ra=None,
                situacao_matricula="ADMIN",
                turma_id=None,
                autorizado=True,
                primeiro_acesso=True,
            )
            db.add(sys_admin)
            db.commit()
        elif sys_admin.role != "admin" or not sys_admin.autorizado:
            sys_admin.role = "admin"
            sys_admin.autorizado = True
            db.commit()

        # Ensure Gabriel is standard user (padrao)
        gabriel = db.query(User).filter(User.email == "gabrielmarinhogalvao@gmail.com").first()
        if gabriel and gabriel.role != "padrao":
            gabriel.role = "padrao"
            if not gabriel.turma_id:
                first_turma = db.query(Turma).first()
                if first_turma:
                    gabriel.turma_id = first_turma.id
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=128)


class AccessRequestPayload(BaseModel):
    nome: str = Field(..., max_length=255)
    email: str = Field(..., max_length=255)
    ra: Optional[str] = Field(default=None, max_length=50)
    cod_turma: Optional[str] = Field(default=None, max_length=100)


class ChangePasswordPayload(BaseModel):
    senha_atual: Optional[str] = Field(default=None, max_length=128)
    nova_senha: str = Field(..., max_length=128)
    confirmar_senha: str = Field(..., max_length=128)


class SaveQuestionnairePayload(BaseModel):
    respostas: Dict[str, Dict[str, Any]]
    finalizar: bool = False
    nova_avaliacao: bool = False
    data_avaliacao: Optional[str] = Field(default=None, max_length=40)


class SaveCompetenciasPayload(BaseModel):
    respostas: Dict[str, Dict[str, Any]]
    cargo_area: Optional[str] = Field(default=None, max_length=255)
    finalizar: bool = False
    nova_avaliacao: bool = False
    data_avaliacao: Optional[str] = Field(default=None, max_length=40)


class SaveActionPlanPayload(BaseModel):
    plano_acao: Dict[str, Dict[str, Any]]


class CreateStudentPayload(BaseModel):
    nome: str = Field(..., max_length=255)
    email: str = Field(..., max_length=255)
    ra: Optional[str] = Field(default=None, max_length=50)
    cod_turma: str = Field(..., max_length=100)
    nome_curso: Optional[str] = Field(default="MBA EM LIDERANÇA 4.0", max_length=255)
    situacao_matricula: Optional[str] = Field(default="MATRICULADO", max_length=100)
    autorizado: bool = True


class ToggleAuthorizePayload(BaseModel):
    autorizado: bool


# ---------------------------------------------------------------------------
# Helper serializers & 3-month cycle evaluation
# ---------------------------------------------------------------------------
def serialize_user(u: User) -> Dict[str, Any]:
    return {
        "id": u.id,
        "nome": u.nome,
        "email": u.email,
        "role": u.role,
        "ra": u.ra,
        "situacao_matricula": u.situacao_matricula,
        "autorizado": u.autorizado,
        "primeiro_acesso": u.primeiro_acesso,
        "turma": {
            "id": u.turma.id,
            "cod_turma": u.turma.cod_turma,
            "cod_curso": u.turma.cod_curso,
            "nome_curso": u.turma.nome_curso,
            "nome_filial": u.turma.nome_filial,
            "periodo_letivo": u.turma.periodo_letivo,
        }
        if u.turma
        else None,
    }


def _parse_date_br(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str:
        return None
    s = date_str.strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def build_assessment_payload(user: User, assessment: Optional[Assessment]) -> Dict[str, Any]:
    respostas_raw = {}
    historico_raw = []
    plano_acao_raw = {}
    concluido = False
    now = datetime.now()
    data_avaliacao = now.strftime("%d/%m/%Y")
    completed_dt: Optional[datetime] = None

    if assessment:
        try:
            respostas_raw = json.loads(assessment.respostas_json or "{}")
        except Exception:
            respostas_raw = {}
        try:
            historico_raw = json.loads(assessment.historico_json or "[]")
            if not isinstance(historico_raw, list):
                historico_raw = []
        except Exception:
            historico_raw = []
        try:
            plano_acao_raw = json.loads(assessment.plano_acao_json or "{}")
            if not isinstance(plano_acao_raw, dict):
                plano_acao_raw = {}
        except Exception:
            plano_acao_raw = {}

        concluido = bool(assessment.concluido)
        if assessment.data_avaliacao:
            data_avaliacao = assessment.data_avaliacao
        completed_dt = assessment.completed_at or _parse_date_br(assessment.data_avaliacao)

    resultados = compute_individual_results(respostas_raw, concluido=concluido)

    # Evaluate previous assessment (for background shadow on Radar & comparison)
    avaliacao_anterior = None
    historico_resumo = []
    for idx, h_entry in enumerate(historico_raw):
        h_resp = h_entry.get("respostas", {})
        h_date = h_entry.get("data_avaliacao") or "Avaliação anterior"
        h_calc = compute_individual_results(h_resp, concluido=True)
        h_summary = {
            "ordem": idx + 1,
            "data_avaliacao": h_date,
            "media_geral": h_calc["resumo"]["media_geral"],
            "total_com_nota": h_calc["resumo"]["total_com_nota"],
            "roda_radar": h_calc["roda_radar"],
            "relatorio_dimensoes": h_calc["relatorio_dimensoes"],
            "eletrovitae": h_calc["eletrovitae"],
        }
        historico_resumo.append(h_summary)

    if historico_resumo:
        avaliacao_anterior = historico_resumo[-1]

    # 3-month (90 days) update alert calculation
    dias_desde_ultima = None
    proxima_atualizacao_str = None
    dias_para_proxima = None
    alerta_trimestral = False

    if concluido and completed_dt:
        delta = now - completed_dt
        dias_desde_ultima = max(0, delta.days)
        prox_dt = completed_dt + timedelta(days=90)
        proxima_atualizacao_str = prox_dt.strftime("%d/%m/%Y")
        dias_para_proxima = (prox_dt - now).days
        if dias_desde_ultima >= 90:
            alerta_trimestral = True

    # Build timeline of all response dates (past + current if concluido)
    datas_respostas = [
        {
            "tipo": "anterior",
            "rotulo": f"{h['ordem']}ª Avaliação",
            "data": h["data_avaliacao"],
            "media_geral": h["media_geral"],
        }
        for h in historico_resumo
    ]
    if concluido:
        datas_respostas.append({
            "tipo": "atual",
            "rotulo": f"Avaliação Atual ({len(historico_resumo) + 1}ª)",
            "data": data_avaliacao,
            "media_geral": resultados["resumo"]["media_geral"],
        })

    return {
        "user": serialize_user(user),
        "data_avaliacao": data_avaliacao,
        "concluido": concluido,
        "respostas": respostas_raw,
        "plano_acao": plano_acao_raw,
        "avaliacao_anterior": avaliacao_anterior,
        "historico_avaliacoes": historico_resumo,
        "datas_respostas": datas_respostas,
        "ciclo_trimestral": {
            "alerta_trimestral": alerta_trimestral,
            "dias_desde_ultima": dias_desde_ultima,
            "dias_para_proxima": dias_para_proxima,
            "proxima_atualizacao_data": proxima_atualizacao_str,
            "ultima_avaliacao_data": data_avaliacao if concluido else None,
        },
        "questions": QUESTIONS,
        "eixos": EIXOS,
        "tutorial": TUTORIAL,
        "resultados": resultados,
    }


def build_competencias_payload(
    user: User, comp_assessment: Optional[CompetenciaAssessment]
) -> Dict[str, Any]:
    respostas_raw = {}
    historico_raw = []
    plano_acao_raw = {}
    cargo_area = ""
    concluido = False
    now = datetime.now()
    data_avaliacao = now.strftime("%d/%m/%Y")
    completed_dt: Optional[datetime] = None

    if comp_assessment:
        cargo_area = comp_assessment.cargo_area or ""
        try:
            respostas_raw = json.loads(comp_assessment.respostas_json or "{}")
        except Exception:
            respostas_raw = {}
        try:
            historico_raw = json.loads(comp_assessment.historico_json or "[]")
            if not isinstance(historico_raw, list):
                historico_raw = []
        except Exception:
            historico_raw = []
        try:
            plano_acao_raw = json.loads(comp_assessment.plano_acao_json or "{}")
            if not isinstance(plano_acao_raw, dict):
                plano_acao_raw = {}
        except Exception:
            plano_acao_raw = {}

        concluido = bool(comp_assessment.concluido)
        if comp_assessment.data_avaliacao:
            data_avaliacao = comp_assessment.data_avaliacao
        completed_dt = comp_assessment.completed_at or _parse_date_br(comp_assessment.data_avaliacao)

    resultados = compute_competencias_results(respostas_raw, concluido=concluido)

    avaliacao_anterior = None
    historico_resumo = []
    for idx, h_entry in enumerate(historico_raw):
        h_resp = h_entry.get("respostas", {})
        h_date = h_entry.get("data_avaliacao") or "Aplicação anterior"
        h_calc = compute_competencias_results(h_resp, concluido=True)
        h_summary = {
            "ordem": idx + 1,
            "data_avaliacao": h_date,
            "media_geral": h_calc["resumo"]["media_geral"],
            "total_com_nota": h_calc["resumo"]["total_com_nota"],
            "roda_radar": h_calc["roda_radar"],
            "relatorio_dimensoes": h_calc["relatorio_dimensoes"],
            "eletrovitae": h_calc["eletrovitae"],
        }
        historico_resumo.append(h_summary)

    if historico_resumo:
        avaliacao_anterior = historico_resumo[-1]

    quatro_aplicacoes = build_quatro_aplicacoes_table(
        historico_resumo=historico_resumo,
        resultados_atual=resultados,
        concluido_atual=concluido,
        data_atual=data_avaliacao,
    )

    dias_desde_ultima = None
    proxima_atualizacao_str = None
    dias_para_proxima = None
    alerta_trimestral = False

    if concluido and completed_dt:
        delta = now - completed_dt
        dias_desde_ultima = max(0, delta.days)
        prox_dt = completed_dt + timedelta(days=90)
        proxima_atualizacao_str = prox_dt.strftime("%d/%m/%Y")
        dias_para_proxima = (prox_dt - now).days
        if dias_desde_ultima >= 90:
            alerta_trimestral = True

    datas_respostas = [
        {
            "tipo": "anterior",
            "rotulo": f"{h['ordem']}ª Aplicação",
            "data": h["data_avaliacao"],
            "media_geral": h["media_geral"],
        }
        for h in historico_resumo
    ]
    if concluido:
        datas_respostas.append({
            "tipo": "atual",
            "rotulo": f"Aplicação Atual ({len(historico_resumo) + 1}ª)",
            "data": data_avaliacao,
            "media_geral": resultados["resumo"]["media_geral"],
        })

    return {
        "modulo": "competencias",
        "user": serialize_user(user),
        "cargo_area": cargo_area,
        "data_avaliacao": data_avaliacao,
        "concluido": concluido,
        "respostas": respostas_raw,
        "plano_acao": plano_acao_raw,
        "avaliacao_anterior": avaliacao_anterior,
        "historico_avaliacoes": historico_resumo,
        "quatro_aplicacoes": quatro_aplicacoes,
        "datas_respostas": datas_respostas,
        "ciclo_trimestral": {
            "alerta_trimestral": alerta_trimestral,
            "dias_desde_ultima": dias_desde_ultima,
            "dias_para_proxima": dias_para_proxima,
            "proxima_atualizacao_data": proxima_atualizacao_str,
            "ultima_avaliacao_data": data_avaliacao if concluido else None,
        },
        "questions": COMP_QUESTIONS,
        "eixos": COMP_EIXOS,
        "tutorial": COMP_TUTORIAL,
        "resultados": resultados,
    }


# ---------------------------------------------------------------------------
# Frontend Root
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


# ---------------------------------------------------------------------------
# Public / Auth Routes
# ---------------------------------------------------------------------------
@app.get("/api/public/turmas")
def list_public_turmas(db: Session = Depends(get_db)):
    turmas = db.query(Turma).order_by(Turma.cod_turma).all()
    return [
        {
            "id": t.id,
            "cod_turma": t.cod_turma,
            "nome_curso": t.nome_curso,
            "periodo_letivo": t.periodo_letivo,
        }
        for t in turmas
    ]


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(request)
    email_clean = payload.email.strip().lower()
    check_rate_limit(f"login_ip:{client_ip}", max_requests=25, window_seconds=300)
    check_rate_limit(f"login_email:{email_clean}", max_requests=12, window_seconds=300)

    user = db.query(User).filter(User.email == email_clean).first()

    if not user or not verify_password(payload.password, user.password_hash):
        log_audit(db, "LOGIN_FAILED", email_clean, client_ip, "Credenciais inválidas")
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")

    if not user.autorizado and user.role != "admin":
        log_audit(db, "LOGIN_BLOCKED_UNAUTH", email_clean, client_ip, "Aguardando autorização")
        raise HTTPException(
            status_code=403,
            detail="Seu cadastro está pendente de autorização pela administradora (Profa. Sheila Ricoy).",
        )

    log_audit(db, "LOGIN_SUCCESS", email_clean, client_ip, f"role={user.role}")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.post("/api/auth/request-access")
def request_access(payload: AccessRequestPayload, request: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(request)
    check_rate_limit(f"req_access:{client_ip}", max_requests=8, window_seconds=600)

    email_clean = payload.email.strip().lower()
    nome_clean = payload.nome.strip()
    if not nome_clean or not email_clean or "@" not in email_clean:
        raise HTTPException(status_code=400, detail="Informe seu nome completo e um e-mail válido.")

    existing = db.query(User).filter(User.email == email_clean).first()
    if existing:
        if existing.autorizado:
            raise HTTPException(
                status_code=400,
                detail="Este e-mail já possui acesso autorizado! Faça login com seu e-mail e senha (padrão inicial: 123456).",
            )
        raise HTTPException(
            status_code=400,
            detail="Já existe uma solicitação para este e-mail aguardando autorização da administradora.",
        )

    turma = None
    if payload.cod_turma:
        turma = db.query(Turma).filter(Turma.cod_turma == payload.cod_turma.strip()).first()
        if not turma:
            turma = Turma(
                cod_turma=payload.cod_turma.strip(),
                nome_curso="Turma Solicitada",
                periodo_letivo=str(datetime.now().year),
            )
            db.add(turma)
            db.flush()

    new_user = User(
        nome=nome_clean,
        email=email_clean,
        password_hash=hash_password("123456"),
        role="padrao",
        ra=payload.ra.strip() if payload.ra else None,
        situacao_matricula="SOLICITAÇÃO DE ACESSO",
        turma_id=turma.id if turma else None,
        autorizado=False,  # Requires Admin authorization
        primeiro_acesso=True,
    )
    db.add(new_user)
    db.commit()
    log_audit(db, "ACCESS_REQUESTED", email_clean, client_ip, f"nome={nome_clean}")

    return {
        "message": (
            "Solicitação enviada com sucesso! Após autorização da Profa. Sheila Ricoy, "
            "você poderá acessar com seu e-mail e a senha inicial 123456."
        )
    }


@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"user": serialize_user(current_user)}


@app.post("/api/auth/change-password")
def change_password(
    payload: ChangePasswordPayload,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    nova = payload.nova_senha.strip()
    conf = payload.confirmar_senha.strip()

    if len(nova) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 6 caracteres.")
    if nova != conf:
        raise HTTPException(status_code=400, detail="A confirmação de senha não confere.")
    if nova == "123456":
        raise HTTPException(
            status_code=400,
            detail="Por segurança, escolha uma nova senha diferente da senha padrão (123456).",
        )

    if not current_user.primeiro_acesso and payload.senha_atual:
        if not verify_password(payload.senha_atual, current_user.password_hash):
            raise HTTPException(status_code=400, detail="A senha atual informada está incorreta.")

    current_user.password_hash = hash_password(nova)
    current_user.primeiro_acesso = False
    db.commit()
    db.refresh(current_user)
    log_audit(db, "PASSWORD_CHANGED", current_user.email, get_client_ip(request), "Troca de senha concluída")

    return {
        "message": "Senha atualizada com sucesso!",
        "user": serialize_user(current_user),
    }


# ---------------------------------------------------------------------------
# Questionnaire, History, Action Plan & Personal Results
# ---------------------------------------------------------------------------
@app.get("/api/questionnaire")
def get_questionnaire(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assessment = db.query(Assessment).filter(Assessment.user_id == current_user.id).first()
    return build_assessment_payload(current_user, assessment)


@app.post("/api/questionnaire/save")
def save_questionnaire(
    payload: SaveQuestionnairePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cleaned_respostas: Dict[str, Dict[str, Any]] = {}
    for q in QUESTIONS:
        num_str = str(q["numero"])
        item_in = payload.respostas.get(num_str, {}) if payload.respostas else {}
        nota_val = item_in.get("nota")
        sem_nota_val = item_in.get("sem_nota")

        if nota_val is not None and str(nota_val).strip() != "":
            try:
                nota_int = int(float(nota_val))
                cleaned_respostas[num_str] = {"nota": nota_int, "sem_nota": None}
            except (ValueError, TypeError):
                cleaned_respostas[num_str] = {"nota": nota_val, "sem_nota": None}
        elif sem_nota_val and str(sem_nota_val).strip() != "":
            cleaned_respostas[num_str] = {"nota": None, "sem_nota": str(sem_nota_val).strip()[:40]}

    preview_results = compute_individual_results(cleaned_respostas, concluido=payload.finalizar)

    if payload.finalizar:
        if preview_results["resumo"]["total_erros"] > 0:
            raise HTTPException(
                status_code=400,
                detail="Existem respostas inválidas. Revise os itens sinalizados antes de finalizar.",
            )
        if preview_results["resumo"]["total_respondidos"] < 50:
            pendentes = preview_results["resumo"]["total_pendentes"]
            raise HTTPException(
                status_code=400,
                detail=f"Ainda faltam {pendentes} pergunta(s) para responder. Preencha uma nota de 1 a 10 ou selecione um motivo em 'Sem nota' em todas as 50 perguntas para liberar os resultados.",
            )

    now = datetime.now()
    eval_date = payload.data_avaliacao or now.strftime("%d/%m/%Y %H:%M")
    assessment = db.query(Assessment).filter(Assessment.user_id == current_user.id).first()

    if not assessment:
        assessment = Assessment(
            user_id=current_user.id,
            concluido=True if payload.finalizar else False,
            respostas_json=json.dumps(cleaned_respostas, ensure_ascii=False),
            historico_json="[]",
            plano_acao_json="{}",
            data_avaliacao=eval_date,
            completed_at=now if payload.finalizar else None,
        )
        db.add(assessment)
    else:
        # If finalizing a new response when a previous finalized response already exists,
        # preserve the previous finalized response in historico_json so its Roda da Vida
        # is drawn as a shaded background underneath the new Roda da Vida!
        if payload.finalizar and assessment.concluido:
            try:
                old_respostas = json.loads(assessment.respostas_json or "{}")
            except Exception:
                old_respostas = {}

            if old_respostas and (old_respostas != cleaned_respostas or payload.nova_avaliacao):
                try:
                    hist_list = json.loads(assessment.historico_json or "[]")
                    if not isinstance(hist_list, list):
                        hist_list = []
                except Exception:
                    hist_list = []

                hist_list.append({
                    "data_avaliacao": assessment.data_avaliacao or now.strftime("%d/%m/%Y"),
                    "completed_at_iso": assessment.completed_at.isoformat() if assessment.completed_at else None,
                    "respostas": old_respostas,
                })
                # Keep up to last 10 historical evaluations
                assessment.historico_json = json.dumps(hist_list[-10:], ensure_ascii=False)

        assessment.respostas_json = json.dumps(cleaned_respostas, ensure_ascii=False)
        if payload.finalizar:
            assessment.concluido = True
            assessment.data_avaliacao = eval_date
            assessment.completed_at = now
        elif not assessment.concluido:
            assessment.data_avaliacao = eval_date
        assessment.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(assessment)

    full_data = build_assessment_payload(current_user, assessment)
    has_prev = full_data["avaliacao_anterior"] is not None
    msg = (
        "Nova avaliação finalizada! A sua última Roda da Saúde foi preservada como sombreado no fundo e a nova foi desenhada por cima."
        if (payload.finalizar and has_prev)
        else (
            "Questionário finalizado com sucesso! Seus resultados e a aba de Plano de Ação já estão disponíveis."
            if payload.finalizar
            else "Progresso salvo com sucesso!"
        )
    )
    full_data["message"] = msg
    return full_data


@app.post("/api/questionnaire/action-plan")
def save_action_plan(
    payload: SaveActionPlanPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assessment = db.query(Assessment).filter(Assessment.user_id == current_user.id).first()
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    cleaned_plan: Dict[str, Dict[str, str]] = {}
    for k, v in (payload.plano_acao or {}).items():
        if not isinstance(v, dict):
            continue
        dim_key = str(k).strip()[:100]
        objetivo = str(v.get("objetivo") or "").strip()[:1000]
        acoes = str(v.get("acoes") or "").strip()[:2000]
        prazo = str(v.get("prazo") or "").strip()[:300]
        status_p = str(v.get("status") or "Em andamento").strip()[:60]
        if objetivo or acoes or prazo:
            cleaned_plan[dim_key] = {
                "objetivo": objetivo,
                "acoes": acoes,
                "prazo": prazo,
                "status": status_p,
                "updated_at": now_str,
            }

    if not assessment:
        assessment = Assessment(
            user_id=current_user.id,
            concluido=False,
            respostas_json="{}",
            historico_json="[]",
            plano_acao_json=json.dumps(cleaned_plan, ensure_ascii=False),
            data_avaliacao=now_str,
        )
        db.add(assessment)
    else:
        assessment.plano_acao_json = json.dumps(cleaned_plan, ensure_ascii=False)
        assessment.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(assessment)
    return {
        "message": "Plano de Ação salvo com sucesso!",
        "plano_acao": cleaned_plan,
    }


@app.get("/api/questionnaire/export-excel")
def export_personal_excel(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assessment = db.query(Assessment).filter(Assessment.user_id == current_user.id).first()
    respostas_raw = {}
    data_avaliacao = datetime.now().strftime("%d/%m/%Y")
    if assessment:
        try:
            respostas_raw = json.loads(assessment.respostas_json or "{}")
        except Exception:
            respostas_raw = {}
        if assessment.data_avaliacao:
            data_avaliacao = assessment.data_avaliacao

    xlsx_bytes = generate_filled_excel_bytes(
        nome_usuario=current_user.nome,
        data_avaliacao=data_avaliacao,
        respostas_raw=respostas_raw,
    )
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", current_user.nome)[:40]
    filename = f"Roda_da_Saude_Integral_{safe_name}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Roda Integrada de Liderança e Competências Routes (Independent Module)
# ---------------------------------------------------------------------------
@app.get("/api/competencias")
def get_competencias(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comp_assessment = (
        db.query(CompetenciaAssessment)
        .filter(CompetenciaAssessment.user_id == current_user.id)
        .first()
    )
    return build_competencias_payload(current_user, comp_assessment)


@app.post("/api/competencias/save")
def save_competencias(
    payload: SaveCompetenciasPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cleaned_respostas: Dict[str, Dict[str, Any]] = {}
    for q in COMP_QUESTIONS:
        num_str = str(q["numero"])
        item_in = payload.respostas.get(num_str, {}) if payload.respostas else {}
        nota_val = item_in.get("nota")
        sem_nota_val = item_in.get("sem_nota")

        if nota_val is not None and str(nota_val).strip() != "":
            try:
                nota_int = int(float(nota_val))
                cleaned_respostas[num_str] = {"nota": nota_int, "sem_nota": None}
            except (ValueError, TypeError):
                cleaned_respostas[num_str] = {"nota": nota_val, "sem_nota": None}
        elif sem_nota_val and str(sem_nota_val).strip() != "":
            cleaned_respostas[num_str] = {"nota": None, "sem_nota": str(sem_nota_val).strip()[:40]}

    preview_results = compute_competencias_results(cleaned_respostas, concluido=payload.finalizar)

    if payload.finalizar:
        if preview_results["resumo"]["total_erros"] > 0:
            raise HTTPException(
                status_code=400,
                detail="Existem notas inválidas. Na Roda de Competências, use notas inteiras de 0 a 10.",
            )
        if preview_results["resumo"]["total_respondidos"] < 50:
            pendentes = preview_results["resumo"]["total_pendentes"]
            raise HTTPException(
                status_code=400,
                detail=f"Ainda faltam {pendentes} comportamento(s) para avaliar. Preencha notas de 0 a 10 em todos os 50 comportamentos para liberar a Roda de Competências.",
            )

    now = datetime.now()
    eval_date = payload.data_avaliacao or now.strftime("%d/%m/%Y %H:%M")
    cargo_clean = (payload.cargo_area or "").strip()[:250] if payload.cargo_area is not None else None

    comp = (
        db.query(CompetenciaAssessment)
        .filter(CompetenciaAssessment.user_id == current_user.id)
        .first()
    )

    if not comp:
        comp = CompetenciaAssessment(
            user_id=current_user.id,
            cargo_area=cargo_clean or "",
            concluido=payload.finalizar,
            respostas_json=json.dumps(cleaned_respostas, ensure_ascii=False),
            historico_json="[]",
            plano_acao_json="{}",
            data_avaliacao=eval_date,
            completed_at=now if payload.finalizar else None,
        )
        db.add(comp)
    else:
        if cargo_clean is not None:
            comp.cargo_area = cargo_clean

        if payload.finalizar and comp.concluido:
            try:
                old_respostas = json.loads(comp.respostas_json or "{}")
            except Exception:
                old_respostas = {}

            if old_respostas and (old_respostas != cleaned_respostas or payload.nova_avaliacao):
                try:
                    hist_list = json.loads(comp.historico_json or "[]")
                    if not isinstance(hist_list, list):
                        hist_list = []
                except Exception:
                    hist_list = []

                hist_list.append({
                    "data_avaliacao": comp.data_avaliacao or now.strftime("%d/%m/%Y"),
                    "completed_at_iso": comp.completed_at.isoformat() if comp.completed_at else None,
                    "respostas": old_respostas,
                })
                comp.historico_json = json.dumps(hist_list[-10:], ensure_ascii=False)

        comp.respostas_json = json.dumps(cleaned_respostas, ensure_ascii=False)
        if payload.finalizar:
            comp.concluido = True
            comp.data_avaliacao = eval_date
            comp.completed_at = now
        elif not comp.concluido:
            comp.data_avaliacao = eval_date
        comp.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(comp)

    full_data = build_competencias_payload(current_user, comp)
    has_prev = full_data["avaliacao_anterior"] is not None
    msg = (
        "Nova aplicação da Roda de Competências concluída! A aplicação anterior foi preservada como sombreado e na tabela de evolução das 4 aplicações."
        if (payload.finalizar and has_prev)
        else (
            "Autoavaliação de Competências finalizada! A Roda Integrada, a tabela de evolução e o Plano de Ação já estão disponíveis."
            if payload.finalizar
            else "Progresso da Roda de Competências salvo com sucesso!"
        )
    )
    full_data["message"] = msg
    return full_data


@app.post("/api/competencias/action-plan")
def save_competencias_action_plan(
    payload: SaveActionPlanPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comp = (
        db.query(CompetenciaAssessment)
        .filter(CompetenciaAssessment.user_id == current_user.id)
        .first()
    )
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    cleaned_plan: Dict[str, Dict[str, str]] = {}
    for k, v in (payload.plano_acao or {}).items():
        if not isinstance(v, dict):
            continue
        dim_key = str(k).strip()[:120]
        objetivo = str(v.get("objetivo") or "").strip()[:1000]
        acoes = str(v.get("acoes") or "").strip()[:2000]
        meta_nota = str(v.get("meta_nota") or "").strip()[:40]
        prazo = str(v.get("prazo") or "").strip()[:300]
        status_p = str(v.get("status") or "Em andamento").strip()[:60]
        if objetivo or acoes or meta_nota or prazo:
            cleaned_plan[dim_key] = {
                "objetivo": objetivo,
                "acoes": acoes,
                "meta_nota": meta_nota,
                "prazo": prazo,
                "status": status_p,
                "updated_at": now_str,
            }

    if not comp:
        comp = CompetenciaAssessment(
            user_id=current_user.id,
            cargo_area="",
            concluido=False,
            respostas_json="{}",
            historico_json="[]",
            plano_acao_json=json.dumps(cleaned_plan, ensure_ascii=False),
            data_avaliacao=now_str,
        )
        db.add(comp)
    else:
        comp.plano_acao_json = json.dumps(cleaned_plan, ensure_ascii=False)
        comp.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(comp)
    return {
        "message": "Plano de Ação de Competências salvo com sucesso!",
        "plano_acao": cleaned_plan,
    }


@app.get("/api/competencias/export-excel")
def export_competencias_excel(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comp = (
        db.query(CompetenciaAssessment)
        .filter(CompetenciaAssessment.user_id == current_user.id)
        .first()
    )
    respostas_raw = {}
    historico_raw = []
    plano_acao_raw = {}
    cargo_area = ""
    data_avaliacao = datetime.now().strftime("%d/%m/%Y")

    if comp:
        cargo_area = comp.cargo_area or ""
        try:
            respostas_raw = json.loads(comp.respostas_json or "{}")
        except Exception:
            respostas_raw = {}
        try:
            historico_raw = json.loads(comp.historico_json or "[]")
        except Exception:
            historico_raw = []
        try:
            plano_acao_raw = json.loads(comp.plano_acao_json or "{}")
        except Exception:
            plano_acao_raw = {}
        if comp.data_avaliacao:
            data_avaliacao = comp.data_avaliacao

    xlsx_bytes = generate_filled_competencias_excel_bytes(
        nome_usuario=current_user.nome,
        cargo_area=cargo_area,
        data_avaliacao=data_avaliacao,
        respostas_raw=respostas_raw,
        historico_raw=historico_raw,
        plano_acao_raw=plano_acao_raw,
    )
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", current_user.nome)[:40]
    filename = f"Roda_Integrada_Lideranca_Competencias_{safe_name}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Admin Routes: Upload Excel, Manage Turmas/Students, Reset, Delete, Reports
# ---------------------------------------------------------------------------
@app.post("/api/admin/upload-excel")
async def admin_upload_excel(
    request: Request,
    file: UploadFile = File(...),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Envie um arquivo Excel válido (.xlsx).")

    content = await file.read()
    if len(content) > MAX_EXCEL_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Arquivo muito grande (limite máximo: 10 MB).")
    if not content.startswith(b"PK\x03\x04"):
        raise HTTPException(status_code=400, detail="Formato de arquivo inválido (não é um arquivo .xlsx válido).")

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        result = import_students_from_workbook(wb, db)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao processar planilha: {str(e)}")

    log_audit(
        db,
        "EXCEL_IMPORTED",
        admin_user.email,
        get_client_ip(request),
        f"novos={result['novos_alunos']}, atualizados={result['alunos_atualizados']}",
    )

    return {
        "message": (
            f"Planilha importada com sucesso! {result['novos_alunos']} novo(s) aluno(s) cadastrado(s) "
            f"e {result['alunos_atualizados']} atualizado(s) com login via e-mail e senha padrão 123456."
        ),
        "detalhes": result,
    }


@app.get("/api/admin/turmas")
def admin_list_turmas(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    turmas = db.query(Turma).order_by(Turma.cod_turma).all()
    out = []
    for t in turmas:
        alunos_padrao = [u for u in t.alunos if u.role == "padrao"]
        autorizados = sum(1 for u in alunos_padrao if u.autorizado)
        pendentes = sum(1 for u in alunos_padrao if not u.autorizado)
        concluidos = sum(
            1 for u in alunos_padrao if u.assessment and u.assessment.concluido
        )
        comp_concluidos = sum(
            1 for u in alunos_padrao if u.competencia_assessment and u.competencia_assessment.concluido
        )
        out.append({
            "id": t.id,
            "cod_turma": t.cod_turma,
            "cod_curso": t.cod_curso,
            "nome_curso": t.nome_curso,
            "cod_filial": t.cod_filial,
            "nome_filial": t.nome_filial,
            "periodo_letivo": t.periodo_letivo,
            "total_alunos": len(alunos_padrao),
            "alunos_autorizados": autorizados,
            "alunos_pendentes": pendentes,
            "questionarios_concluidos": concluidos,
            "competencias_concluidos": comp_concluidos,
        })
    return {"turmas": out}


@app.delete("/api/admin/turmas/{turma_id}")
def admin_delete_turma(
    turma_id: int,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    turma = db.query(Turma).filter(Turma.id == turma_id).first()
    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada.")

    cod_turma = turma.cod_turma
    alunos_turma = db.query(User).filter(User.turma_id == turma.id, User.role == "padrao").all()
    qtd_alunos = len(alunos_turma)

    for u in alunos_turma:
        db.delete(u)
    db.delete(turma)
    db.commit()

    log_audit(
        db,
        "TURMA_DELETED",
        admin_user.email,
        get_client_ip(request),
        f"turma={cod_turma}, alunos_removidos={qtd_alunos}",
    )
    return {
        "message": f"Turma '{cod_turma}' e seus {qtd_alunos} aluno(s) vinculado(s) foram removidos com sucesso."
    }


@app.get("/api/admin/relatorio-turma")
def admin_turma_report(
    turma_id: Optional[str] = Query(default="all"),
    apenas_concluidos: bool = Query(default=False),
    modulo: Optional[str] = Query(default="saude"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User).filter(User.role == "padrao", User.autorizado == True)

    turma_info = {
        "id": "all",
        "cod_turma": "TODAS AS TURMAS",
        "nome_curso": "Consolidado Geral de Turmas",
        "nome_filial": "SENAI / FIEMG",
        "periodo_letivo": "2026",
    }

    if turma_id and turma_id != "all":
        t_obj = db.query(Turma).filter(Turma.id == int(turma_id)).first()
        if not t_obj:
            raise HTTPException(status_code=404, detail="Turma não encontrada.")
        query = query.filter(User.turma_id == t_obj.id)
        turma_info = {
            "id": t_obj.id,
            "cod_turma": t_obj.cod_turma,
            "cod_curso": t_obj.cod_curso,
            "nome_curso": t_obj.nome_curso,
            "cod_filial": t_obj.cod_filial,
            "nome_filial": t_obj.nome_filial,
            "periodo_letivo": t_obj.periodo_letivo,
        }

    alunos = query.all()
    total_alunos_turma = len(alunos)

    is_comp = (modulo or "saude").strip().lower() == "competencias"
    assessments_respostas = []
    for u in alunos:
        target_ass = u.competencia_assessment if is_comp else u.assessment
        if not target_ass:
            continue
        if apenas_concluidos and not target_ass.concluido:
            continue
        try:
            resp = json.loads(target_ass.respostas_json or "{}")
        except Exception:
            resp = {}
        if resp:
            assessments_respostas.append(resp)

    if is_comp:
        return compute_competencias_turma_report(
            turma_info=turma_info,
            total_alunos_turma=total_alunos_turma,
            assessments_respostas=assessments_respostas,
        )

    report = compute_turma_report(
        turma_info=turma_info,
        total_alunos_turma=total_alunos_turma,
        assessments_respostas=assessments_respostas,
    )
    return report


@app.get("/api/admin/users")
def admin_list_users(
    turma_id: Optional[str] = Query(default=None),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(User).filter(User.role == "padrao")
    if turma_id and turma_id != "all":
        q = q.filter(User.turma_id == int(turma_id))

    users = q.order_by(User.autorizado.asc(), User.nome.asc()).all()
    out = []
    for u in users:
        tem_respostas = False
        data_resp = None
        qtd_avaliacoes = 0
        if u.assessment:
            try:
                r_dict = json.loads(u.assessment.respostas_json or "{}")
                tem_respostas = bool(r_dict)
            except Exception:
                tem_respostas = False
            try:
                h_list = json.loads(u.assessment.historico_json or "[]")
                qtd_avaliacoes = len(h_list) + (1 if u.assessment.concluido else 0)
            except Exception:
                qtd_avaliacoes = 1 if u.assessment.concluido else 0
            if u.assessment.concluido or tem_respostas:
                data_resp = u.assessment.data_avaliacao

        tem_respostas_comp = False
        data_resp_comp = None
        qtd_avaliacoes_comp = 0
        if u.competencia_assessment:
            try:
                rc_dict = json.loads(u.competencia_assessment.respostas_json or "{}")
                tem_respostas_comp = bool(rc_dict)
            except Exception:
                tem_respostas_comp = False
            try:
                hc_list = json.loads(u.competencia_assessment.historico_json or "[]")
                qtd_avaliacoes_comp = len(hc_list) + (1 if u.competencia_assessment.concluido else 0)
            except Exception:
                qtd_avaliacoes_comp = 1 if u.competencia_assessment.concluido else 0
            if u.competencia_assessment.concluido or tem_respostas_comp:
                data_resp_comp = u.competencia_assessment.data_avaliacao

        out.append({
            "id": u.id,
            "nome": u.nome,
            "email": u.email,
            "ra": u.ra,
            "situacao_matricula": u.situacao_matricula,
            "autorizado": u.autorizado,
            "primeiro_acesso": u.primeiro_acesso,
            "questionario_concluido": bool(u.assessment and u.assessment.concluido),
            "tem_respostas": tem_respostas,
            "data_ultima_resposta": data_resp,
            "qtd_avaliacoes": qtd_avaliacoes,
            "competencias_concluido": bool(u.competencia_assessment and u.competencia_assessment.concluido),
            "tem_respostas_competencias": tem_respostas_comp,
            "data_ultima_competencia": data_resp_comp,
            "qtd_avaliacoes_competencias": qtd_avaliacoes_comp,
            "turma": {
                "id": u.turma.id,
                "cod_turma": u.turma.cod_turma,
                "nome_curso": u.turma.nome_curso,
            }
            if u.turma
            else None,
        })
    return {"alunos": out}


@app.post("/api/admin/users")
def admin_create_user(
    payload: CreateStudentPayload,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    email_clean = payload.email.strip().lower()
    nome_clean = payload.nome.strip()
    cod_turma_clean = payload.cod_turma.strip()

    if not nome_clean or not email_clean or "@" not in email_clean:
        raise HTTPException(status_code=400, detail="Informe nome e e-mail válidos.")

    existing = db.query(User).filter(User.email == email_clean).first()
    if existing:
        raise HTTPException(status_code=400, detail="Já existe um usuário cadastrado com este e-mail.")

    turma = db.query(Turma).filter(Turma.cod_turma == cod_turma_clean).first()
    if not turma:
        turma = Turma(
            cod_turma=cod_turma_clean,
            nome_curso=payload.nome_curso or "MBA EM LIDERANÇA 4.0",
            periodo_letivo=str(datetime.now().year),
        )
        db.add(turma)
        db.flush()

    user = User(
        nome=nome_clean,
        email=email_clean,
        password_hash=hash_password("123456"),
        role="padrao",
        ra=payload.ra.strip() if payload.ra else None,
        situacao_matricula=payload.situacao_matricula or "MATRICULADO",
        turma_id=turma.id,
        autorizado=payload.autorizado,
        primeiro_acesso=True,
    )
    db.add(user)
    db.commit()
    log_audit(db, "USER_CREATED_BY_ADMIN", email_clean, get_client_ip(request), f"turma={turma.cod_turma}")

    return {
        "message": f"Aluno(a) {nome_clean} cadastrado(a) com sucesso na turma {turma.cod_turma} (senha inicial: 123456).",
    }


@app.patch("/api/admin/users/{user_id}/authorize")
def admin_toggle_authorize(
    user_id: int,
    payload: ToggleAuthorizePayload,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "padrao").first()
    if not user:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    user.autorizado = payload.autorizado
    db.commit()
    status_str = "autorizado" if user.autorizado else "bloqueado/pendente"
    log_audit(db, "USER_AUTH_CHANGED", user.email, get_client_ip(request), f"status={status_str}")
    return {"message": f"Acesso de {user.nome} alterado para {status_str}."}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_user_password(
    user_id: int,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "padrao").first()
    if not user:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    user.password_hash = hash_password("123456")
    user.primeiro_acesso = True
    db.commit()
    log_audit(db, "USER_PASSWORD_RESET", user.email, get_client_ip(request), "Redefinido pelo admin")
    return {
        "message": f"Senha de {user.nome} redefinida para '123456'. No próximo login será solicitada a troca de senha."
    }


@app.post("/api/admin/users/{user_id}/reset-assessment")
def admin_reset_user_assessment(
    user_id: int,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "padrao").first()
    if not user:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    if user.assessment:
        db.delete(user.assessment)
        db.commit()

    log_audit(db, "USER_ASSESSMENT_RESET", user.email, get_client_ip(request), "Respostas de Saúde Integral resetadas pelo admin")
    return {
        "message": f"As respostas, histórico e plano de ação da Roda da Saúde de {user.nome} foram resetados com sucesso."
    }


@app.post("/api/admin/users/{user_id}/reset-competencias")
def admin_reset_user_competencias(
    user_id: int,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "padrao").first()
    if not user:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    if user.competencia_assessment:
        db.delete(user.competencia_assessment)
        db.commit()

    log_audit(db, "USER_COMPETENCIAS_RESET", user.email, get_client_ip(request), "Respostas de Competências resetadas pelo admin")
    return {
        "message": f"As respostas, histórico de 4 aplicações e plano de ação da Roda de Competências de {user.nome} foram resetados com sucesso."
    }


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    request: Request,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "padrao").first()
    if not user:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    nome = user.nome
    email = user.email
    db.delete(user)
    db.commit()
    log_audit(db, "USER_DELETED", email, get_client_ip(request), f"nome={nome}")
    return {"message": f"Aluno(a) {nome} removido(a) com sucesso."}
