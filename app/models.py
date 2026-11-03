from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Turma(Base):
    __tablename__ = "turmas"

    id = Column(Integer, primary_key=True, index=True)
    cod_turma = Column(String(100), unique=True, index=True, nullable=False)
    cod_curso = Column(String(50), nullable=True)
    nome_curso = Column(String(255), nullable=True)
    cod_filial = Column(String(50), nullable=True)
    nome_filial = Column(String(255), nullable=True)
    periodo_letivo = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    alunos = relationship("User", back_populates="turma")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(30), default="padrao", nullable=False)  # 'admin' | 'padrao'
    ra = Column(String(50), nullable=True)
    situacao_matricula = Column(String(100), nullable=True)
    turma_id = Column(Integer, ForeignKey("turmas.id"), nullable=True)
    autorizado = Column(Boolean, default=True, nullable=False)
    primeiro_acesso = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    turma = relationship("Turma", back_populates="alunos")
    assessment = relationship("Assessment", back_populates="user", uselist=False, cascade="all, delete-orphan")


class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    concluido = Column(Boolean, default=False, nullable=False)
    respostas_json = Column(Text, default="{}", nullable=False)
    historico_json = Column(Text, default="[]", nullable=False)
    plano_acao_json = Column(Text, default="{}", nullable=False)
    data_avaliacao = Column(String(40), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="assessment")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    evento = Column(String(80), nullable=False, index=True)
    email = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    detalhes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
