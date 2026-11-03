# Roda da Saúde Integral — Profa. Sheila Ricoy

Aplicação web de autopercepção e acompanhamento da **Roda da Saúde Integral** em 10 dimensões e 50 itens, desenvolvida com **FastAPI**, **SQLAlchemy (SQLite WAL)**, **Chart.js** e **OpenPyXL**.

## Funcionalidades Principais

- **Questionário de 50 Perguntas (10 Dimensões)**:
  - Nota de `1` a `10` ou justificativa em `Sem nota` (`Não se aplica` / `Prefiro não responder`), com exemplos práticos por pergunta e validação fiel à planilha original.
- **Roda da Saúde em Radar + Comparação Sombreada**:
  - Exibe a avaliação atual (`#2C6B92`), a linha de `Referência 6` (`#B58428`) e, quando há reavaliação, preserva a **Última Roda como sombreado ao fundo** para comparação direta da evolução.
- **Ciclo de Atualização Trimestral (3 Meses / 90 Dias) e Histórico de Datas**:
  - Registra todas as datas de respostas realizadas e exibe alerta automático a cada 3 meses (90 dias) para atualização da Roda.
- **Relatório de Notas e Eletrovitae**:
  - Tabela consolidada por dimensão, lista de **Assuntos a Explorar (Notas ≤ 6)**, gráfico linear **Eletrovitae** dos 50 itens e exportação da planilha `.xlsx` preenchida no modelo oficial.
- **Plano de Ação para Áreas em Desfalque**:
  - Aba dedicada para traçar *Objetivo*, *Ações Práticas*, *Prazo/Meta* e *Status* para cada dimensão com média $\le 6{,}0$.
- **Painel Administrativo (Profa. Sheila Ricoy & Gabriel)**:
  - Importação de planilhas `.xlsx` de turmas/alunos com criação automática de acessos (`senha padrão: 123456` e troca obrigatória no primeiro acesso).
  - Aprovação de solicitações de acesso, criação manual de alunos, **reset de resposta do aluno**, **exclusão de aluno** e **exclusão de turma**.
  - **Relatório Coletivo e Anônimo por Turma**: médias da turma, melhores e piores indicadores médios, Roda da Saúde da Turma e Eletrovitae médio, preservando o sigilo individual.

## Execução Local

```bash
pip install -r requirements.txt
python run.py
```

Acesse em `http://localhost:8000`.
