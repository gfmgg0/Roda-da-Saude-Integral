# Roda da Saúde Integral & Roda de Liderança e Competências — Profa. Sheila Ricoy

Aplicação web integrada com dois módulos independentes de autopercepção e acompanhamento longitudinal (**Roda da Saúde Integral** e **Roda Integrada de Liderança e Competências**), cada um com 10 eixos e 50 itens, desenvolvida com **FastAPI**, **SQLAlchemy**, **Chart.js** e **OpenPyXL**.

## Módulos do Sistema

### 1. 🌿 Roda da Saúde Integral
- **Questionário de 50 Perguntas (10 Dimensões)**:
  - Nota de `1` a `10` ou justificativa em `Sem nota` (`Não se aplica` / `Prefiro não responder`), com exemplos práticos por pergunta e validação fiel à planilha original.
- **Roda da Saúde em Radar + Comparação Sombreada**:
  - Exibe a avaliação atual (`#2C6B92`), a linha de `Referência 6` (`#B58428`) e, quando há reavaliação, preserva a **Última Roda como sombreado ao fundo** para comparação direta da evolução.
- **Relatório de Notas, Eletrovitae e Plano de Ação**:
  - Tabela consolidada por dimensão, lista de **Assuntos a Explorar (Notas ≤ 6)**, gráfico linear **Eletrovitae** dos 50 itens, Plano de Ação para áreas em desfalque e exportação da planilha `.xlsx` preenchida no modelo oficial (`template_roda_saude.xlsx`).

### 2. 🎯 Roda Integrada de Liderança e Competências
- **Autoavaliação de 50 Comportamentos Observáveis (10 Eixos de Liderança)**:
  - Escala oficial de `0` a `10` (`0 = não demonstro | 5 = demonstro com alguma regularidade | 10 = demonstro de forma consistente`) + campo de **Cargo / área**.
- **Acompanhamento Longitudinal em 4 Aplicações (`1ª a 4ª aplicação`)**:
  - Reproduz a tabela da aba `Roda integrada` da planilha oficial, com datas, situação (`Concluída` / `Em curso` / `Não iniciada`), médias por eixo nas 4 aplicações e cálculo automático da **Variação (pontos)** em relação à 1ª aplicação, além do **sombreado da última roda no gráfico Radar**.
- **Plano de Desenvolvimento Individual (PDI) e Exportação Excel**:
  - Aba dedicada para registrar *Meta (nota)*, *Ação prática*, *Prazo* e *Status* para os eixos prioritários, com exportação fiel na planilha oficial (`template_roda_competencias.xlsx`) preenchendo até 4 aplicações.

### 3. Painel Docente / Administrativo
- Importação de planilhas `.xlsx` de turmas/alunos com criação automática de acessos (`senha padrão: 123456` e troca obrigatória no primeiro acesso).
- Gestão completa de alunos e turmas: autorização/bloqueio, redefinição de senha, **reset independente de respostas da Roda da Saúde ou da Roda de Competências**, exclusão de aluno e exclusão de turma.
- **Relatório Coletivo e Anônimo por Turma** para ambos os módulos (alternando pelo seletor no topo), preservando o sigilo individual das notas.

## Execução Local

```bash
pip install -r requirements.txt
python run.py
```

Acesse em `http://localhost:8000`.
