/* ============================================================================
 * Roda da Saúde Integral — Profa. Sheila Ricoy
 * Frontend Application (Vanilla JS + Tailwind CSS + Chart.js)
 * ============================================================================ */

const state = {
  token: localStorage.getItem('rsi_token') || null,
  user: null,
  authTab: 'login', // 'login' | 'request'
  publicTurmas: [],
  activeModule: 'saude', // 'saude' | 'competencias'
  activeTab: 'questionario', // 'questionario' | 'resultados' | 'plano_acao' | 'tutorial' | 'admin_relatorio' | 'admin_alunos'
  resultsSubTab: 'todos', // 'todos' | 'roda' | 'relatorio' | 'eletrovitae'
  selectedDimFilter: 'todas',
  openExamples: {}, // { [numero]: boolean }
  questionnaireData: null,
  localCargoArea: '',
  localAnswers: {},
  localActionPlan: {}, // { [dimensao]: { objetivo, acoes, meta_nota, prazo, status } }
  novaAvaliacaoMode: false,
  unsavedChanges: false,
  showAllDimsInPlan: false,
  // Admin state
  adminTurmas: [],
  selectedAdminTurma: 'all',
  apenasConcluidosFilter: false,
  adminReport: null,
  adminUsers: [],
  adminUserTurmaFilter: 'all',
  adminUserSearch: '',
  skipFirstAccessPromptSession: false,
};

let chartInstances = {
  personalRadar: null,
  personalEletrovitae: null,
  adminRadar: null,
  adminEletrovitae: null,
};

// ----------------------------------------------------------------------------
// Utility Helpers
// ----------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  const colors = {
    success: 'bg-emerald-700 text-white border-emerald-800',
    error: 'bg-red-700 text-white border-red-800',
    warning: 'bg-amber-600 text-white border-amber-700',
    info: 'bg-navy text-white border-navy-dark',
  };
  el.className = `pointer-events-auto border px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-start justify-between gap-3 transition-all duration-300 ${colors[type] || colors.info}`;
  el.innerHTML = `
    <span class="leading-snug">${escapeHtml(message)}</span>
    <button class="opacity-80 hover:opacity-100 font-bold text-base leading-none">&times;</button>
  `;
  el.querySelector('button').onclick = () => el.remove();
  container.appendChild(el);
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 6000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(val, decimals = 1) {
  if (val === null || val === undefined || val === '') return '—';
  const num = Number(val);
  if (Number.isNaN(num)) return '—';
  return num.toFixed(decimals).replace('.', ',');
}

async function apiFetch(path, options = {}) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(cleanPath, { ...options, headers });
  if (resp.status === 401) {
    if (state.token) {
      logout(false);
    }
  }
  let data = null;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await resp.json();
  }
  if (!resp.ok) {
    const errMsg = (data && data.detail) ? data.detail : `Erro na requisição (${resp.status})`;
    throw new Error(errMsg);
  }
  return data;
}

// ----------------------------------------------------------------------------
// Initialization & Auth Flow
// ----------------------------------------------------------------------------
async function initApp() {
  try {
    state.publicTurmas = await apiFetch('/api/public/turmas');
  } catch (_) {
    state.publicTurmas = [];
  }

  if (state.token) {
    try {
      const me = await apiFetch('/api/auth/me');
      state.user = me.user;
      await loadInitialAuthedData();
      render();
      return;
    } catch (_) {
      state.token = null;
      localStorage.removeItem('rsi_token');
    }
  }
  render();
}

async function loadInitialAuthedData() {
  await loadQuestionnaireData();
  if (state.user.role === 'admin') {
    state.activeTab = 'admin_relatorio';
    await loadAdminTurmasAndUsers();
    await loadAdminReport();
  } else {
    state.activeTab = state.questionnaireData?.concluido ? 'resultados' : 'questionario';
    if (state.questionnaireData?.ciclo_trimestral?.alerta_trimestral) {
      showToast(
        '⏰ Alerta Trimestral (3 Meses): Já se passaram mais de 90 dias desde sua última avaliação! Recomendamos atualizar sua Roda da Saúde Integral.',
        'warning'
      );
    }
  }
}

async function loadQuestionnaireData() {
  const endpoint = state.activeModule === 'competencias' ? '/api/competencias' : '/api/questionnaire';
  const data = await apiFetch(endpoint);
  state.questionnaireData = data;
  state.localCargoArea = data.cargo_area || '';
  state.localAnswers = JSON.parse(JSON.stringify(data.respostas || {}));
  state.localActionPlan = JSON.parse(JSON.stringify(data.plano_acao || {}));
  state.unsavedChanges = false;
}

async function loadAdminTurmasAndUsers() {
  const [turmasRes, usersRes] = await Promise.all([
    apiFetch('/api/admin/turmas'),
    apiFetch(`/api/admin/users?turma_id=${encodeURIComponent(state.adminUserTurmaFilter)}`),
  ]);
  state.adminTurmas = turmasRes.turmas || [];
  state.adminUsers = usersRes.alunos || [];
  if (state.selectedAdminTurma === 'all' && state.adminTurmas.length === 1) {
    state.selectedAdminTurma = String(state.adminTurmas[0].id);
  }
}

async function loadAdminReport() {
  const q = new URLSearchParams({
    turma_id: state.selectedAdminTurma,
    apenas_concluidos: state.apenasConcluidosFilter ? 'true' : 'false',
    modulo: state.activeModule,
  });
  state.adminReport = await apiFetch(`/api/admin/relatorio-turma?${q.toString()}`);
}

function logout(notify = true) {
  state.token = null;
  state.user = null;
  state.questionnaireData = null;
  state.localCargoArea = '';
  state.localAnswers = {};
  state.localActionPlan = {};
  state.novaAvaliacaoMode = false;
  state.skipFirstAccessPromptSession = false;
  localStorage.removeItem('rsi_token');
  if (notify) showToast('Sessão encerrada com sucesso.', 'info');
  render();
}

// ----------------------------------------------------------------------------
// Local Evaluation Helper
// ----------------------------------------------------------------------------
function evaluateLocalItem(numero) {
  const ans = state.localAnswers[String(numero)] || {};
  const nota = ans.nota;
  const semNota = (ans.sem_nota || '').trim();
  const hasNota = nota !== null && nota !== undefined && String(nota).trim() !== '';
  const hasSemNota = semNota !== '';

  if (hasNota && hasSemNota) return 'Escolha nota ou motivo';
  if (hasSemNota) return semNota;
  if (!hasNota) return 'Não respondido';
  const n = Number(nota);
  const minScore = state.activeModule === 'competencias' ? 0 : 1;
  if (!Number.isInteger(n) || n < minScore || n > 10) return 'Nota inválida';
  return n <= 6 ? 'Nota até 6' : 'Nota acima de 6';
}

function getLocalProgressSummary() {
  if (!state.questionnaireData) return { respondidos: 0, comNota: 0, semNota: 0, pendentes: 50 };
  let comNota = 0;
  let semNota = 0;
  for (let i = 1; i <= 50; i++) {
    const sit = evaluateLocalItem(i);
    if (sit === 'Nota até 6' || sit === 'Nota acima de 6') comNota++;
    else if (sit === 'Não se aplica' || sit === 'Prefiro não responder') semNota++;
  }
  const respondidos = comNota + semNota;
  return { respondidos, comNota, semNota, pendentes: 50 - respondidos };
}

function getDeficitDimensions() {
  if (!state.questionnaireData?.resultados) return [];
  const { relatorio_dimensoes, itens } = state.questionnaireData.resultados;
  return relatorio_dimensoes.filter((d) => {
    const hasLowAvg = d.media !== null && d.media <= 6.0;
    const hasLowItem = itens.some((it) => it.dimensao === d.dimensao && it.situacao === 'Nota até 6');
    return hasLowAvg || hasLowItem;
  });
}

// ----------------------------------------------------------------------------
// Render Dispatcher
// ----------------------------------------------------------------------------
function render() {
  const root = document.getElementById('app-root');
  if (!root) return;

  Object.keys(chartInstances).forEach((k) => {
    if (chartInstances[k]) {
      chartInstances[k].destroy();
      chartInstances[k] = null;
    }
  });

  if (!state.user) {
    root.innerHTML = renderLoginScreen();
    bindLoginEvents();
    return;
  }

  if (state.user.primeiro_acesso && !state.skipFirstAccessPromptSession) {
    root.innerHTML = renderFirstAccessPasswordScreen();
    bindFirstAccessEvents();
    return;
  }

  root.innerHTML = `
    ${renderNavbar()}
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
      ${renderTrimestralAlertBanner()}
      ${renderActiveTabContent()}
    </main>
    ${renderFooter()}
  `;

  bindMainEvents();
  initChartsIfNeeded();
}

// ----------------------------------------------------------------------------
// Trimestral (3-Month) Alert & Response Dates Banner
// ----------------------------------------------------------------------------
function renderTrimestralAlertBanner() {
  if (!state.questionnaireData) return '';
  if (state.activeTab === 'admin_relatorio' || state.activeTab === 'admin_alunos') return '';

  const { concluido, datas_respostas, ciclo_trimestral, avaliacao_anterior } = state.questionnaireData;
  if (!concluido && (!datas_respostas || datas_respostas.length === 0)) return '';

  const isAlert = ciclo_trimestral?.alerta_trimestral;
  const diasPassados = ciclo_trimestral?.dias_desde_ultima ?? 0;
  const proxData = ciclo_trimestral?.proxima_atualizacao_data || '—';

  const datesHtml = (datas_respostas || [])
    .map(
      (dr) => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border ${
        dr.tipo === 'atual'
          ? 'bg-cerulean text-white border-cerulean shadow-sm'
          : 'bg-slate-100 text-slate-700 border-slate-300'
      }">
        📅 <strong>${escapeHtml(dr.rotulo)}:</strong> ${escapeHtml(dr.data)}
        ${dr.media_geral !== null && dr.media_geral !== undefined ? `(Média: ${formatNumber(dr.media_geral, 2)})` : ''}
      </span>
    `
    )
    .join('');

  return `
    <div class="mb-6 rounded-2xl border p-4 sm:p-5 shadow-sm ${
      isAlert
        ? 'bg-amber-50 border-amber-400 text-amber-950'
        : 'bg-white border-slate-200 text-slate-800'
    }">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            ${
              isAlert
                ? `<span class="px-2.5 py-0.5 rounded-full bg-amber-600 text-white text-xs font-extrabold uppercase tracking-wide animate-pulse">
                     ⏰ Alerta de Atualização Trimestral (3 Meses)
                   </span>`
                : `<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
                     🔄 Acompanhamento Trimestral (Ciclo de 3 Meses)
                   </span>`
            }
            <span class="text-xs text-slate-600 font-medium">
              Próxima atualização recomendada (+3 meses): <strong class="text-navy">${escapeHtml(proxData)}</strong>
              (${diasPassados === 0 ? 'respondido hoje' : `há ${diasPassados} dia(s)`})
            </span>
          </div>

          ${
            isAlert
              ? `<p class="text-xs sm:text-sm font-semibold text-amber-900">
                   Já se passaram <strong>${diasPassados} dias</strong> (mais de 3 meses) desde a sua última avaliação. Responda novamente ao questionário para atualizar sua Roda da Saúde Integral! A sua última roda continuará visível como sombreado no fundo para comparação.
                 </p>`
              : `<p class="text-xs text-slate-600">
                   A Roda da Saúde Integral avalia sua percepção a cada trimestre (3 meses). Quando você realizar uma nova resposta no questionário, a <strong>última Roda da Saúde é preservada como sombreado no fundo</strong> e a nova é desenhada por cima.
                 </p>`
          }

          <!-- Histórico de Datas de Respostas -->
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-500">Datas de Respostas:</span>
            ${datesHtml}
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0 no-print">
          <button
            id="btn-start-new-wheel"
            class="px-4 py-2.5 rounded-xl bg-navy hover:bg-navy-light text-white text-xs font-bold shadow transition-colors"
          >
            🔄 Responder Nova Avaliação (Comparar Rodas)
          </button>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 1. Login & Access Request Screen
// ----------------------------------------------------------------------------
function renderLoginScreen() {
  const turmasOptions = state.publicTurmas
    .map(
      (t) =>
        `<option value="${escapeHtml(t.cod_turma)}">${escapeHtml(t.cod_turma)} — ${escapeHtml(t.nome_curso || '')}</option>`
    )
    .join('');

  return `
    <div class="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-gradient-to-br from-navy-dark via-navy to-cerulean">
      <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
        <div class="bg-navy px-6 py-7 text-center text-white border-b-4 border-amberref">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 border border-white/20 mb-3">
            <svg class="w-8 h-8 text-amberref-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v18m9-9H3m15.364 6.364l-12.728-12.728M18.364 5.636L5.636 18.364"></path>
            </svg>
          </div>
          <h1 class="text-2xl font-extrabold tracking-tight">Eixo Humano</h1>
          <p class="text-sm text-amberref-light font-bold mt-0.5">Autoconhecimento para o Líder 4.0</p>
          <p class="text-xs text-slate-200 mt-1.5 font-medium">Autoria: Profa. Sheila Ricoy em parceria com I.A.</p>
          <p class="text-[11px] text-slate-300 mt-0.5">Roda da Saúde Integral • Roda de Liderança e Competências • Eletrovitae • Plano de Ação</p>
        </div>

        <div class="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-sm font-semibold">
          <button id="tab-btn-login" class="py-3.5 text-center transition-colors ${
            state.authTab === 'login'
              ? 'bg-white text-navy border-b-2 border-cerulean'
              : 'text-slate-500 hover:text-navy'
          }">
            Entrar na Conta
          </button>
          <button id="tab-btn-request" class="py-3.5 text-center transition-colors ${
            state.authTab === 'request'
              ? 'bg-white text-navy border-b-2 border-cerulean'
              : 'text-slate-500 hover:text-navy'
          }">
            Solicitar Acesso
          </button>
        </div>

        <div class="p-6 sm:p-7">
          ${
            state.authTab === 'login'
              ? `
            <form id="login-form" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">E-mail de Acesso</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  placeholder="seuemail@exemplo.com.br"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean focus:border-cerulean text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">Senha</label>
                <input
                  id="login-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean focus:border-cerulean text-sm"
                />
              </div>
              <button
                type="submit"
                class="w-full py-3 px-4 rounded-xl bg-navy hover:bg-navy-light text-white font-semibold text-sm shadow-md transition-colors"
              >
                Acessar Plataforma
              </button>
            </form>

            <div class="mt-5 p-3.5 rounded-xl bg-amberref-soft border border-amberref/30 text-xs text-slate-700 space-y-1">
              <p class="font-bold text-navy">Primeiro acesso de Aluno?</p>
              <p>Utilize o <strong>seu e-mail cadastrado na turma</strong> como login e a senha inicial padrão <strong>123456</strong>. No primeiro acesso será solicitada a criação da sua senha pessoal.</p>
            </div>
          `
              : `
            <form id="request-access-form" class="space-y-4">
              <p class="text-xs text-slate-600 leading-relaxed">
                Caso seu nome ainda não tenha sido importado na planilha da turma, preencha seus dados abaixo. Seu acesso será liberado mediante autorização da <strong>Profa. Sheila Ricoy</strong>.
              </p>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nome Completo *</label>
                <input
                  id="req-nome"
                  type="text"
                  required
                  placeholder="Seu nome completo"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">E-mail (será seu login) *</label>
                <input
                  id="req-email"
                  type="email"
                  required
                  placeholder="seuemail@exemplo.com"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm"
                />
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">RA / Matrícula (opcional)</label>
                  <input
                    id="req-ra"
                    type="text"
                    placeholder="Ex: 0001083505"
                    class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Turma</label>
                  <select
                    id="req-turma"
                    class="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm bg-white"
                  >
                    ${turmasOptions}
                    <option value="TURMA-GERAL">Outra Turma / Geral</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                class="w-full py-3 px-4 rounded-xl bg-cerulean hover:bg-cerulean-dark text-white font-semibold text-sm shadow-md transition-colors"
              >
                Enviar Solicitação para Autorização
              </button>
            </form>
          `
          }
        </div>
      </div>
      <p class="text-xs text-white/70 mt-6 text-center">
        Eixo Humano • Autoconhecimento para o Líder 4.0 • Avaliação Individual e Confidencial
      </p>
    </div>
  `;
}

function bindLoginEvents() {
  const btnLogin = document.getElementById('tab-btn-login');
  const btnReq = document.getElementById('tab-btn-request');
  if (btnLogin) {
    btnLogin.onclick = () => {
      state.authTab = 'login';
      render();
    };
  }
  if (btnReq) {
    btnReq.onclick = () => {
      state.authTab = 'request';
      render();
    };
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        state.token = res.access_token;
        localStorage.setItem('rsi_token', res.access_token);
        state.user = res.user;
        await loadInitialAuthedData();
        showToast(`Bem-vindo(a), ${state.user.nome}!`, 'success');
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  const reqForm = document.getElementById('request-access-form');
  if (reqForm) {
    reqForm.onsubmit = async (e) => {
      e.preventDefault();
      const nome = document.getElementById('req-nome').value.trim();
      const email = document.getElementById('req-email').value.trim();
      const ra = document.getElementById('req-ra').value.trim();
      const cod_turma = document.getElementById('req-turma').value;
      try {
        const res = await apiFetch('/api/auth/request-access', {
          method: 'POST',
          body: JSON.stringify({ nome, email, ra, cod_turma }),
        });
        showToast(res.message, 'success');
        state.authTab = 'login';
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }
}

// ----------------------------------------------------------------------------
// 2. First-Access Mandatory Password Reconfiguration Screen
// ----------------------------------------------------------------------------
function renderFirstAccessPasswordScreen() {
  const isAdmin = state.user && state.user.role === 'admin';
  return `
    <div class="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-gradient-to-br from-navy-dark via-navy to-cerulean">
      <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
        <div class="bg-navy px-6 py-6 text-white border-b-4 border-amberref">
          <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amberref text-white mb-2">
            Segurança • Primeiro Acesso
          </span>
          <h2 class="text-xl font-bold">Reconfiguração de Senha Obrigatória</h2>
          <p class="text-xs text-slate-200 mt-1">
            Olá, <strong>${escapeHtml(state.user.nome)}</strong>! Como este é o seu primeiro acesso com a senha padrão (123456), defina agora sua nova senha pessoal e confidencial.
          </p>
        </div>

        <form id="first-access-form" class="p-6 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nova Senha Pessoal (mín. 6 caracteres)</label>
            <input
              id="fa-nova-senha"
              type="password"
              required
              minlength="6"
              placeholder="Digite sua nova senha (diferente de 123456)"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm"
            />
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Confirmar Nova Senha</label>
            <input
              id="fa-conf-senha"
              type="password"
              required
              minlength="6"
              placeholder="Repita a nova senha"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-sm"
            />
          </div>

          <div class="pt-2 flex flex-col gap-2.5">
            <button
              type="submit"
              class="w-full py-3 px-4 rounded-xl bg-cerulean hover:bg-cerulean-dark text-white font-semibold text-sm shadow-md transition-colors"
            >
              Salvar Nova Senha e Continuar
            </button>
            ${
              isAdmin
                ? `
              <button
                type="button"
                id="btn-admin-skip-pw"
                class="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-medium text-xs transition-colors"
              >
                Continuar mantendo a senha padrão (123456) nesta sessão
              </button>
            `
                : ''
            }
            <button
              type="button"
              id="btn-fa-logout"
              class="w-full py-2 text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Sair da conta
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function bindFirstAccessEvents() {
  const form = document.getElementById('first-access-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const nova_senha = document.getElementById('fa-nova-senha').value;
      const confirmar_senha = document.getElementById('fa-conf-senha').value;
      try {
        const res = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ nova_senha, confirmar_senha }),
        });
        state.user = res.user;
        showToast(res.message, 'success');
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }
  const skipBtn = document.getElementById('btn-admin-skip-pw');
  if (skipBtn) {
    skipBtn.onclick = () => {
      state.skipFirstAccessPromptSession = true;
      render();
    };
  }
  const logoutBtn = document.getElementById('btn-fa-logout');
  if (logoutBtn) {
    logoutBtn.onclick = () => logout();
  }
}

// ----------------------------------------------------------------------------
// 3. Top Navbar & Navigation Tabs
// ----------------------------------------------------------------------------
function renderNavbar() {
  const isAdmin = state.user.role === 'admin';
  const isComp = state.activeModule === 'competencias';
  const moduleTitle = isComp
    ? 'Roda Integrada de Liderança e Competências'
    : 'Roda da Saúde Integral';

  const turmaBadge = state.user.turma
    ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amberref/20 text-amberref-light border border-amberref/40">
         Turma: ${escapeHtml(state.user.turma.cod_turma)} • ${escapeHtml(state.user.turma.nome_curso || '')}
       </span>`
    : isAdmin
    ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amberref text-white">
         Perfil Administrador(a)
       </span>`
    : '';

  const pendentesCount = isAdmin ? state.adminUsers.filter((u) => !u.autorizado).length : 0;
  const deficitCount = getDeficitDimensions().length;

  return `
    <header class="bg-navy text-white shadow-lg border-b-4 border-amberref no-print">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div class="flex items-center gap-3 flex-wrap">
              <h1 class="text-xl sm:text-2xl font-extrabold tracking-tight">Eixo Humano</h1>
              <span class="px-2.5 py-0.5 rounded-lg bg-white/10 text-amberref-light text-xs sm:text-sm font-bold border border-white/15">
                Autoconhecimento para o Líder 4.0
              </span>
              ${turmaBadge}
            </div>
            <p class="text-xs text-slate-300 mt-1">
              Módulo ativo: <strong class="text-amberref-light">${escapeHtml(moduleTitle)}</strong> • Autoria: Sheila Ricoy em parceria com I.A. • Usuário(a): <strong class="text-white">${escapeHtml(state.user.nome)}</strong> (${escapeHtml(state.user.email)})
            </p>
          </div>
          <div class="flex items-center gap-2.5 self-start md:self-auto">
            <button
              id="btn-open-change-pw"
              class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-slate-100 border border-white/15 transition-colors"
            >
              Alterar Senha
            </button>
            <button
              id="btn-logout"
              class="px-3.5 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-600 text-xs font-semibold text-white transition-colors"
            >
              Sair
            </button>
          </div>
        </div>

        <!-- Module Switcher: Roda da Saúde Integral vs Roda de Liderança e Competências -->
        <div class="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[11px] font-bold uppercase tracking-wider text-amberref-light mr-1">
              Módulo do Sistema:
            </span>
            <button
              data-switch-module="saude"
              class="module-switch-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 ${
                !isComp
                  ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300/60'
                  : 'bg-white/10 text-slate-200 hover:bg-white/20 border border-white/15'
              }"
            >
              🌿 Roda da Saúde Integral
            </button>
            <button
              data-switch-module="competencias"
              class="module-switch-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 ${
                isComp
                  ? 'bg-cerulean text-white shadow-md ring-2 ring-sky-300/60'
                  : 'bg-white/10 text-slate-200 hover:bg-white/20 border border-white/15'
              }"
            >
              🎯 Roda de Liderança e Competências
            </button>
          </div>
          <span class="text-[11px] text-slate-300">
            ${
              isComp
                ? 'Avaliação Independente • 50 Comportamentos em 10 Eixos • Evolução em 4 Aplicações'
                : 'Avaliação Independente • 50 Perguntas em 10 Dimensões de Saúde Integral'
            }
          </span>
        </div>

        <!-- Navigation Tabs -->
        <nav class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-white/10">
          ${
            isAdmin
              ? `
            <button data-nav="admin_relatorio" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'admin_relatorio'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📊 Relatório da Turma (${isComp ? 'Competências' : 'Saúde Integral'})
            </button>
            <button data-nav="admin_alunos" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${
              state.activeTab === 'admin_alunos'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              👥 Alunos, Turmas e Importar Excel
              ${
                pendentesCount > 0
                  ? `<span class="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[11px] font-bold">${pendentesCount}</span>`
                  : ''
              }
            </button>
            <button data-nav="questionario" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'questionario'
                ? 'bg-cerulean text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📝 ${isComp ? 'Minha Autoavaliação (Competências)' : 'Meu Questionário (Saúde)'}
            </button>
            <button data-nav="resultados" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'resultados'
                ? 'bg-cerulean text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📈 ${isComp ? 'Minha Roda de Competências' : 'Meus Gráficos (Saúde)'}
            </button>
            <button data-nav="plano_acao" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'plano_acao'
                ? 'bg-cerulean text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              🎯 Meu Plano de Ação (${isComp ? 'Competências' : 'Saúde'})
            </button>
            <button data-nav="tutorial" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'tutorial'
                ? 'bg-cerulean text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📖 ${isComp ? 'Critérios e 10 Eixos' : 'Tutorial e 10 Eixos'}
            </button>
          `
              : `
            <button data-nav="questionario" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'questionario'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📝 1. ${isComp ? 'Autoavaliação de Competências (50 Comportamentos)' : 'Responder Questionário (50 Itens)'}
            </button>
            <button data-nav="resultados" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${
              state.activeTab === 'resultados'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📊 2. ${isComp ? 'Roda Integrada, 4 Aplicações e Perfil' : 'Meus Resultados (Roda, Relatório e Eletrovitae)'}
              ${
                state.questionnaireData?.concluido
                  ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/30 border border-emerald-300/40 text-[10px]">Liberado</span>`
                  : `<span class="px-1.5 py-0.5 rounded bg-white/20 text-[10px]">Concluir 50 itens</span>`
              }
            </button>
            <button data-nav="plano_acao" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${
              state.activeTab === 'plano_acao'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              🎯 3. Plano de Ação (${isComp ? 'Eixos Prioritários' : 'Áreas em Desfalque'})
              ${
                state.questionnaireData?.concluido && deficitCount > 0
                  ? `<span class="px-1.5 py-0.5 rounded-full bg-amber-500/40 border border-amber-300/50 text-[10px] font-bold">${deficitCount} eixos</span>`
                  : ''
              }
            </button>
            <button data-nav="tutorial" class="nav-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              state.activeTab === 'tutorial'
                ? 'bg-amberref text-white shadow'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }">
              📖 4. ${isComp ? 'Critérios e Eixos' : 'Tutorial e Eixos'}
            </button>
          `
          }
        </nav>
      </div>
    </header>
  `;
}

function renderFooter() {
  return `
    <footer class="bg-white border-t border-slate-200 mt-12 py-5 text-center text-xs text-slate-500 no-print">
      <div class="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span><strong>Eixo Humano — Autoconhecimento para o Líder 4.0</strong> • Profa. Sheila Ricoy</span>
        <span>Roda da Saúde Integral & Roda de Liderança e Competências • Dados individuais confidenciais</span>
      </div>
    </footer>
  `;
}

function renderActiveTabContent() {
  switch (state.activeTab) {
    case 'questionario':
      return renderQuestionnaireView();
    case 'resultados':
      return renderPersonalResultsView();
    case 'plano_acao':
      return renderActionPlanView();
    case 'tutorial':
      return renderTutorialAndEixosView();
    case 'admin_relatorio':
      return renderAdminClassReportView();
    case 'admin_alunos':
      return renderAdminUsersAndUploadView();
    default:
      return renderQuestionnaireView();
  }
}

// ----------------------------------------------------------------------------
// 4. Questionnaire View (50 Items across 10 Dimensions / Eixos)
// ----------------------------------------------------------------------------
function renderQuestionnaireView() {
  if (!state.questionnaireData) {
    return `<div class="p-8 text-center text-slate-500">Carregando questionário...</div>`;
  }
  const { questions, eixos, concluido, data_avaliacao } = state.questionnaireData;
  const prog = getLocalProgressSummary();
  const pct = Math.round((prog.respondidos / 50) * 100);
  const isAdmin = state.user.role === 'admin';
  const isComp = state.activeModule === 'competencias';

  const dimOptions = [
    `<option value="todas" ${state.selectedDimFilter === 'todas' ? 'selected' : ''}>Todos os 10 Eixos (50 itens)</option>`,
    ...eixos.map(
      (e) =>
        `<option value="${escapeHtml(e.dimensao)}" ${
          state.selectedDimFilter === e.dimensao ? 'selected' : ''
        }>${e.ordem}. ${escapeHtml(e.dimensao)}</option>`
    ),
  ].join('');

  const filteredQuestions =
    state.selectedDimFilter === 'todas'
      ? questions
      : questions.filter((q) => q.dimensao === state.selectedDimFilter);

  const groupedByDim = [];
  let currentDim = null;
  filteredQuestions.forEach((q) => {
    if (!currentDim || currentDim.dimensao !== q.dimensao) {
      const eixoMeta = eixos.find((e) => e.dimensao === q.dimensao) || {};
      currentDim = { dimensao: q.dimensao, eixoMeta, items: [] };
      groupedByDim.push(currentDim);
    }
    currentDim.items.push(q);
  });

  return `
    <div class="space-y-6">
      ${
        isAdmin
          ? `
        <div class="bg-cerulean-light border border-cerulean/30 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div class="text-xs sm:text-sm text-navy">
            <strong>Modo Pessoal da Administradora:</strong> Você pode responder à avaliação (${isComp ? 'Roda de Competências' : 'Roda da Saúde'}) e gerar seus gráficos normalmente. Suas respostas são exclusivas do seu perfil e <strong>não são contabilizadas em nenhuma turma</strong>.
          </div>
        </div>
      `
          : ''
      }

      ${
        state.novaAvaliacaoMode
          ? `
        <div class="bg-indigo-50 border border-indigo-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="text-xs sm:text-sm text-indigo-950">
            <strong>🔄 Modo de Nova Avaliação Ativo:</strong> Ao finalizar este questionário, a sua <strong>${isComp ? 'Roda de Competências' : 'Roda da Saúde'} anterior (${escapeHtml(data_avaliacao)})</strong> será automaticamente preservada como sombreado no fundo${isComp ? ' e registrada na tabela das 4 aplicações' : ''} e a nova roda será desenhada por cima!
          </div>
          <button id="btn-clear-form-new" class="px-3.5 py-1.5 rounded-xl bg-white hover:bg-indigo-100 text-indigo-900 border border-indigo-300 text-xs font-bold shrink-0">
            Limpar respostas para preencher do zero
          </button>
        </div>
      `
          : ''
      }

      <!-- Instructions & Sticky Progress Header -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <span class="inline-block px-2.5 py-0.5 rounded-md text-xs font-bold ${isComp ? 'bg-cerulean' : 'bg-navy'} text-white mb-1.5">
              ${isComp ? 'Autoavaliação • Roda Integrada de Liderança e Competências' : 'Questionário de Autopercepção em 10 Dimensões'}
            </span>
            <h2 class="text-lg sm:text-xl font-bold text-navy">
              ${
                isComp
                  ? 'Considere os últimos três meses. 0 = não demonstro. 5 = demonstro com alguma regularidade. 10 = demonstro de forma consistente.'
                  : 'Dê uma nota de 1 a 10 conforme sua satisfação com cada aspecto avaliado.'
              }
            </h2>
            <p class="text-xs text-slate-600 mt-1">
              ${
                isComp
                  ? 'Avalie cada um dos 50 comportamentos de liderança e competências em uma escala de <strong>0 a 10</strong> (ou selecione um motivo em "Sem nota"). Sugestão de reaplicação: a cada 3 meses (acompanhamento em até 4 aplicações).'
                  : 'Preencha a <strong>Nota (1 a 10)</strong> OU escolha um motivo em <strong>"Sem nota"</strong> (<em>Não se aplica</em> ou <em>Prefiro não responder</em>). Clique em <strong>"Ver exemplo"</strong> quando precisar.'
              }
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <div class="text-xs bg-amberref-light border border-amberref/40 px-3 py-2 rounded-xl text-navy">
              <span class="font-bold">Última data registrada:</span> ${escapeHtml(data_avaliacao)}
            </div>
            ${
              concluido
                ? `<span class="px-3 py-2 rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-300">✓ Avaliação Concluída</span>`
                : `<span class="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200">Em preenchimento</span>`
            }
          </div>
        </div>

        ${
          isComp
            ? `
          <div class="my-4 p-3.5 rounded-xl bg-slatebg border border-slate-200 flex flex-col sm:flex-row sm:items-center gap-3">
            <label for="comp-cargo-area" class="text-xs font-extrabold uppercase tracking-wider text-navy shrink-0">
              Cargo / Área de Atuação (Aba Autoavaliação):
            </label>
            <input
              id="comp-cargo-area"
              type="text"
              value="${escapeHtml(state.localCargoArea || '')}"
              placeholder="Ex: Gestor de Projetos / Operações / Liderança..."
              class="w-full sm:max-w-md px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-medium text-navy focus:outline-none focus:ring-2 focus:ring-cerulean"
            />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 my-4 text-xs">
            <div class="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900">
              <span class="font-extrabold">Nota 0 a 4:</span> Não demonstro / demonstro raramente
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
              <span class="font-extrabold">Nota 5 a 6:</span> Demonstro com alguma regularidade (A desenvolver)
            </div>
            <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
              <span class="font-extrabold">Nota 7 a 10:</span> Demonstro de forma frequente a consistente
            </div>
          </div>
        `
            : `
          <!-- Scale quick bar -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 my-4 text-xs">
            <div class="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900">
              <span class="font-extrabold">Notas 1 a 2:</span> Muito insatisfatório
            </div>
            <div class="p-2.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-900">
              <span class="font-extrabold">Notas 3 a 4:</span> Insatisfatório
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
              <span class="font-extrabold">Notas 5 a 6:</span> Intermediário (A explorar)
            </div>
            <div class="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900">
              <span class="font-extrabold">Notas 7 a 8:</span> Satisfatório
            </div>
            <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 col-span-2 sm:col-span-1">
              <span class="font-extrabold">Notas 9 a 10:</span> Muito satisfatório
            </div>
          </div>
        `
        }

        <!-- Progress and Controls Bar -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
          <div class="flex-1">
            <div class="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
              <span>Progresso de preenchimento: <strong>${prog.respondidos} de 50</strong> itens respondidos (${prog.comNota} com nota • ${prog.semNota} sem nota)</span>
              <span class="text-cerulean font-bold">${pct}%</span>
            </div>
            <div class="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div class="h-full bg-gradient-to-r from-navy to-cerulean transition-all duration-300" style="width: ${pct}%"></div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <select id="dim-filter-select" class="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-navy focus:outline-none focus:ring-2 focus:ring-cerulean">
              ${dimOptions}
            </select>
            <button id="btn-save-draft" class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs border border-slate-300 transition-colors">
              💾 Salvar Rascunho
            </button>
            <button id="btn-finalize-questionnaire" class="px-5 py-2.5 rounded-xl bg-cerulean hover:bg-cerulean-dark text-white font-bold text-xs shadow-md transition-colors">
              ✅ ${concluido ? 'Salvar Nova Aplicação e Comparar' : 'Finalizar e Ver Resultados'}
            </button>
          </div>
        </div>
      </div>

      <!-- Questions List Grouped by Dimension -->
      <div class="space-y-6">
        ${groupedByDim
          .map(
            (group) => `
          <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="bg-navy px-5 py-4 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded bg-amberref text-white text-xs font-bold">
                    Eixo ${group.eixoMeta.ordem || ''} de 10
                  </span>
                  <h3 class="text-base sm:text-lg font-bold">${escapeHtml(group.dimensao)}</h3>
                </div>
                <p class="text-xs text-slate-200 mt-0.5">${escapeHtml(group.eixoMeta.o_que_avalia || group.eixoMeta.temas_origem || '')}</p>
              </div>
              <span class="self-start sm:self-auto px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                ${isComp ? `Radar: ${escapeHtml(group.eixoMeta.rotulo_radar || group.dimensao)}` : `Revisão da autora: ${escapeHtml(group.eixoMeta.revisao || 'Validado')}`}
              </span>
            </div>

            <div class="divide-y divide-slate-200">
              ${group.items.map((q) => renderQuestionRow(q)).join('')}
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Bottom Action Bar -->
      <div class="bg-white rounded-2xl shadow-md border border-slate-200 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="text-xs sm:text-sm text-slate-700">
          <strong>Status atual:</strong> ${prog.respondidos} de 50 itens respondidos
          ${
            prog.pendentes > 0
              ? `<span class="text-amber-700 font-semibold">(faltam ${prog.pendentes} item(ns) para liberar os resultados finais)</span>`
              : `<span class="text-emerald-700 font-bold">(todos os 50 itens estão preenchidos!)</span>`
          }
        </div>
        <div class="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          <button id="btn-save-draft-bottom" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs sm:text-sm border border-slate-300 transition-colors">
            💾 Salvar Progresso
          </button>
          <button id="btn-finalize-bottom" class="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-lg transition-colors">
            ✅ ${concluido ? 'Finalizar Nova Aplicação (Preservar Roda Anterior no Fundo)' : 'Finalizar Avaliação e Abrir Resultados'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderQuestionRow(q) {
  const numStr = String(q.numero);
  const ans = state.localAnswers[numStr] || {};
  const currentNota = ans.nota !== null && ans.nota !== undefined && String(ans.nota).trim() !== '' ? Number(ans.nota) : null;
  const currentSemNota = ans.sem_nota || '';
  const situacao = evaluateLocalItem(q.numero);
  const isExampleOpen = !!state.openExamples[numStr];
  const isComp = state.activeModule === 'competencias';
  const minScore = isComp ? 0 : 1;

  let badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
  if (situacao === 'Nota até 6') {
    badgeClass = 'bg-amber-100 text-amber-900 border-amber-300';
  } else if (situacao === 'Nota acima de 6') {
    badgeClass = 'bg-emerald-100 text-emerald-900 border-emerald-300';
  } else if (situacao === 'Não se aplica' || situacao === 'Prefiro não responder') {
    badgeClass = 'bg-sky-100 text-sky-900 border-sky-300';
  } else if (situacao === 'Nota inválida' || situacao === 'Escolha nota ou motivo') {
    badgeClass = 'bg-red-100 text-red-800 border-red-300';
  }

  const scoreButtons = [];
  for (let n = minScore; n <= 10; n++) {
    const selected = currentNota === n;
    let btnStyle = 'bg-white text-slate-700 border-slate-300 hover:border-cerulean hover:bg-cerulean-light';
    if (selected) {
      btnStyle =
        n <= 6
          ? 'bg-amberref text-white border-amberref shadow-sm ring-2 ring-amberref/40'
          : 'bg-cerulean text-white border-cerulean shadow-sm ring-2 ring-cerulean/40';
    }
    scoreButtons.push(`
      <button
        type="button"
        data-qnum="${q.numero}"
        data-score="${n}"
        class="score-btn w-8 h-9 sm:w-9 sm:h-10 rounded-xl border font-bold text-xs sm:text-sm flex items-center justify-center ${btnStyle}"
      >
        ${n}
      </button>
    `);
  }

  const itemShortLabel = q.item || q.rotulo_curto || q.rotulo_radar || q.dimensao;
  const exampleText = q.exemplo || q.exemplos || '';

  return `
    <div id="question-row-${q.numero}" class="p-4 sm:p-5 transition-colors ${
      q.numero % 2 === 0 ? 'bg-slatebg/50' : 'bg-white'
    }">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div class="flex-1 space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg bg-navy text-white text-xs font-extrabold">
              #${String(q.numero).padStart(2, '0')}
            </span>
            <span class="text-xs font-bold uppercase tracking-wider text-cerulean">
              ${escapeHtml(itemShortLabel)}
            </span>
            <span id="status-badge-${q.numero}" class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badgeClass}">
              ${escapeHtml(situacao)}
            </span>
            <button
              type="button"
              data-toggle-example="${q.numero}"
              class="text-xs font-semibold text-cerulean hover:underline inline-flex items-center gap-1 ml-1"
            >
              💡 ${isExampleOpen ? 'Ocultar critério' : isComp ? 'Ver critério' : 'Ver exemplo'}
            </button>
          </div>

          <p class="text-sm sm:text-base font-medium text-slate-800 leading-snug">
            ${escapeHtml(q.pergunta)}
          </p>

          <div id="example-box-${q.numero}" class="${
            isExampleOpen ? 'block' : 'hidden'
          } mt-2 p-3 rounded-xl bg-cerulean-light/70 border border-cerulean/20 text-xs text-navy">
            <strong>${isComp ? 'Critério / Eixo' : `Exemplo (${escapeHtml(itemShortLabel)})`}:</strong> ${escapeHtml(exampleText)}
          </div>
        </div>

        <div class="bg-amberref-light/70 border border-amberref/30 rounded-2xl p-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
          <div>
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Nota de ${minScore} a 10:
            </div>
            <div class="flex flex-wrap gap-1">
              ${scoreButtons.join('')}
            </div>
          </div>

          <div class="sm:border-l sm:border-amberref/30 sm:pl-3 w-full sm:w-auto">
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Ou Sem Nota:
            </label>
            <select
              data-semnota-qnum="${q.numero}"
              class="w-full sm:w-44 px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-cerulean"
            >
              <option value="" ${currentSemNota === '' ? 'selected' : ''}>— Selecionar motivo —</option>
              <option value="Não se aplica" ${currentSemNota === 'Não se aplica' ? 'selected' : ''}>Não se aplica</option>
              <option value="Prefiro não responder" ${currentSemNota === 'Prefiro não responder' ? 'selected' : ''}>Prefiro não responder</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 5. Personal Results View (Roda da Saúde / Competências + Sombreado Anterior, 4 Aplicações, Relatório, Eletrovitae)
// ----------------------------------------------------------------------------
function renderQuatroAplicacoesTable() {
  const qa = state.questionnaireData?.quatro_aplicacoes;
  if (!qa || state.activeModule !== 'competencias') return '';

  const apps = qa.aplicacoes || [];
  const linhas = qa.linhas_eixos || [];

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <span class="px-2.5 py-0.5 rounded bg-cerulean text-white text-xs font-bold">
            Aba "Roda integrada" da Planilha Oficial
          </span>
          <h3 class="text-base sm:text-lg font-extrabold text-navy mt-1">
            Evolução nas 4 Aplicações e Variação por Eixo (Pontos)
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            A 1ª aplicação é a referência inicial. A coluna de Variação compara a última aplicação concluída com a 1ª aplicação.
          </p>
        </div>
      </div>

      <!-- Resumo das 4 Aplicações (Linhas 5 a 8 da planilha) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        ${apps
          .map(
            (ap) => `
          <div class="p-3.5 rounded-xl border ${
            ap.situacao === 'Concluída'
              ? 'bg-cerulean-light/40 border-cerulean/40'
              : 'bg-slatebg border-slate-200'
          }">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-navy">${escapeHtml(ap.rotulo)}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
                ap.situacao === 'Concluída'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-slate-200 text-slate-600'
              }">
                ${escapeHtml(ap.situacao)}
              </span>
            </div>
            <div class="text-xs text-slate-600 mt-1.5">
              Data: <strong>${escapeHtml(ap.data || '—')}</strong>
            </div>
            <div class="text-xs text-slate-600">
              Notas preenchidas: <strong>${ap.notas_preenchidas} de 50</strong>
            </div>
            ${
              ap.media_geral !== null && ap.media_geral !== undefined
                ? `<div class="text-xs font-extrabold text-cerulean mt-1">Média Geral: ${formatNumber(ap.media_geral, 2)}</div>`
                : ''
            }
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Tabela de Médias nas 4 Aplicações e Variação (Linhas 38 a 48 da planilha) -->
      <div class="overflow-x-auto">
        <table class="w-full text-xs sm:text-sm border-collapse">
          <thead>
            <tr class="bg-navy text-white text-left">
              <th class="py-2.5 px-3 rounded-tl-lg font-bold">Eixo de Liderança e Competências</th>
              <th class="py-2.5 px-2 text-center font-bold">1ª aplicação</th>
              <th class="py-2.5 px-2 text-center font-bold">2ª aplicação</th>
              <th class="py-2.5 px-2 text-center font-bold">3ª aplicação</th>
              <th class="py-2.5 px-2 text-center font-bold">4ª aplicação</th>
              <th class="py-2.5 px-3 rounded-tr-lg text-center font-bold">Variação (pontos)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${linhas
              .map((row, idx) => {
                let varHtml = '—';
                if (row.variacao !== null && row.variacao !== undefined) {
                  if (row.variacao > 0) {
                    varHtml = `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold text-xs">+${formatNumber(row.variacao, 1)}</span>`;
                  } else if (row.variacao < 0) {
                    varHtml = `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-extrabold text-xs">${formatNumber(row.variacao, 1)}</span>`;
                  } else {
                    varHtml = `<span class="text-slate-500 font-bold text-xs">0,0</span>`;
                  }
                }
                return `
                  <tr class="${idx % 2 === 1 ? 'bg-slatebg/60' : 'bg-white'} hover:bg-cerulean-light/30">
                    <td class="py-2.5 px-3 font-bold text-navy">${escapeHtml(row.eixo)}</td>
                    <td class="py-2.5 px-2 text-center font-semibold text-slate-700">${formatNumber(row.ap1, 1)}</td>
                    <td class="py-2.5 px-2 text-center font-semibold text-slate-700">${formatNumber(row.ap2, 1)}</td>
                    <td class="py-2.5 px-2 text-center font-semibold text-slate-700">${formatNumber(row.ap3, 1)}</td>
                    <td class="py-2.5 px-2 text-center font-semibold text-slate-700">${formatNumber(row.ap4, 1)}</td>
                    <td class="py-2.5 px-3 text-center">${varHtml}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPersonalResultsView() {
  if (!state.questionnaireData) {
    return `<div class="p-8 text-center text-slate-500">Carregando resultados...</div>`;
  }

  const { concluido, data_avaliacao, resultados, avaliacao_anterior, cargo_area } = state.questionnaireData;
  const isAdmin = state.user.role === 'admin';
  const isComp = state.activeModule === 'competencias';
  const exportUrl = isComp
    ? `api/competencias/export-excel?token=${encodeURIComponent(state.token)}`
    : `api/questionnaire/export-excel?token=${encodeURIComponent(state.token)}`;

  if (!concluido && resultados.resumo.total_respondidos < 50) {
    return `
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center max-w-2xl mx-auto my-8 space-y-4">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amberref-light text-amberref border border-amberref/30">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
          </svg>
        </div>
        <h2 class="text-xl font-bold text-navy">Finalize os 50 Itens para Acessar seus Resultados</h2>
        <p class="text-sm text-slate-600 leading-relaxed">
          Para visualizar sua <strong>${isComp ? 'Roda Integrada de Liderança e Competências em Radar' : 'Roda da Saúde Integral em Radar'}</strong>, o <strong>Relatório de Notas</strong>, o <strong>Eletrovitae dos 50 Itens</strong> e montar seu <strong>Plano de Ação</strong>, preencha os 50 itens e clique em <strong>"Finalizar e Ver Resultados"</strong>.
        </p>
        <p class="text-xs font-semibold text-cerulean">
          Progresso salvo até o momento: ${resultados.resumo.total_respondidos} de 50 itens respondidos.
        </p>
        <div class="pt-2">
          <button
            id="btn-go-to-questionnaire"
            class="px-6 py-3 rounded-xl bg-navy hover:bg-navy-light text-white font-semibold text-sm shadow-md transition-colors"
          >
            📝 Ir para a Avaliação
          </button>
        </div>
      </div>
    `;
  }

  const { resumo, relatorio_dimensoes, assuntos_a_explorar } = resultados;
  const hasPrev = !!avaliacao_anterior;

  return `
    <div class="space-y-6">
      <!-- Top Header & Export Buttons -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="px-2.5 py-0.5 rounded-md ${isComp ? 'bg-cerulean' : 'bg-navy'} text-white text-xs font-bold">
                ${isComp ? 'Roda de Competências' : 'Roda da Saúde'} (${escapeHtml(data_avaliacao)})
              </span>
              <span class="px-2.5 py-0.5 rounded-md bg-cerulean-light text-navy text-xs font-bold">
                ${escapeHtml(resumo.mensagem_status)}
              </span>
              ${
                hasPrev
                  ? `<span class="px-2.5 py-0.5 rounded-md bg-slate-200 text-slate-800 text-xs font-bold">
                       Comparando com Última Roda (${escapeHtml(avaliacao_anterior.data_avaliacao)})
                     </span>`
                  : ''
              }
              ${
                isAdmin
                  ? `<span class="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-xs font-semibold">Avaliação Pessoal da Admin (Não contabiliza em turmas)</span>`
                  : ''
              }
            </div>
            <h2 class="text-xl sm:text-2xl font-extrabold text-navy">
              ${escapeHtml(state.user.nome)} — ${isComp ? 'Roda Integrada de Liderança e Competências' : 'Roda da Saúde, Relatório de Notas e Eletrovitae'}
            </h2>
            <p class="text-xs text-slate-500 mt-1">
              ${isComp && cargo_area ? `Cargo / Área: <strong>${escapeHtml(cargo_area)}</strong> • ` : ''}
              Data da resposta atual: <strong>${escapeHtml(data_avaliacao)}</strong>
              ${hasPrev ? `• Última resposta anterior: <strong>${escapeHtml(avaliacao_anterior.data_avaliacao)}</strong> (preservada como sombreado no fundo da Roda)` : ''}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2.5 no-print">
            <button
              id="btn-go-action-plan"
              class="px-4 py-2.5 rounded-xl bg-amberref hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition-colors"
            >
              🎯 Abrir Plano de Ação
            </button>
            <a
              href="${exportUrl}"
              target="_blank"
              class="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-sm transition-colors inline-flex items-center gap-1.5"
            >
              📥 Baixar Planilha Excel (.xlsx)
            </a>
            <button
              onclick="window.print()"
              class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs border border-slate-300 transition-colors"
            >
              🖨️ Imprimir / Salvar PDF
            </button>
          </div>
        </div>

        <!-- Summary KPI Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
          <div class="p-3.5 rounded-xl bg-slatebg border border-slate-200">
            <div class="text-[11px] font-bold uppercase text-slate-500">Média Geral Atual</div>
            <div class="text-2xl font-extrabold text-navy mt-0.5">
              ${formatNumber(resumo.media_geral, 2)} <span class="text-xs font-normal text-slate-500">/ 10</span>
            </div>
            ${
              hasPrev
                ? `<div class="text-[11px] text-slate-500 mt-0.5">Anterior (${escapeHtml(avaliacao_anterior.data_avaliacao)}): <strong>${formatNumber(avaliacao_anterior.media_geral, 2)}</strong></div>`
                : ''
            }
          </div>
          <div class="p-3.5 rounded-xl bg-slatebg border border-slate-200">
            <div class="text-[11px] font-bold uppercase text-slate-500">Itens com Nota Válida</div>
            <div class="text-2xl font-extrabold text-cerulean mt-0.5">${resumo.total_com_nota} <span class="text-xs font-normal text-slate-500">de 50</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-slatebg border border-slate-200">
            <div class="text-[11px] font-bold uppercase text-slate-500">Itens Sem Nota</div>
            <div class="text-2xl font-extrabold text-slate-700 mt-0.5">${resumo.total_sem_nota} <span class="text-xs font-normal text-slate-500">itens</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-amberref-soft border border-amberref/30">
            <div class="text-[11px] font-bold uppercase text-amberref">${isComp ? 'Comportamentos a Desenvolver (≤ 6)' : 'Assuntos a Explorar (≤ 6)'}</div>
            <div class="text-2xl font-extrabold text-amberref mt-0.5">${resumo.total_assuntos_explorar} <span class="text-xs font-normal text-slate-600">itens</span></div>
          </div>
        </div>

        <!-- Sub-navigation Filter -->
        <div class="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-100 no-print">
          <button data-res-subtab="todos" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            state.resultsSubTab === 'todos' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }">
            Visão Completa (Todos)
          </button>
          <button data-res-subtab="roda" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            state.resultsSubTab === 'roda' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }">
            1. ${isComp ? 'Roda de Competências em Radar' : 'Roda da Saúde em Radar'}
          </button>
          <button data-res-subtab="relatorio" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            state.resultsSubTab === 'relatorio' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }">
            2. ${isComp ? 'Relatório por Eixo e 4 Aplicações' : 'Relatório de Notas'}
          </button>
          <button data-res-subtab="eletrovitae" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            state.resultsSubTab === 'eletrovitae' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }">
            3. ${isComp ? 'Perfil dos 50 Comportamentos' : 'Eletrovitae dos 50 Itens'}
          </button>
        </div>
      </div>

      <!-- 1. Roda em Radar + 2. Relatório de Notas por Dimensão/Eixo -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        ${
          state.resultsSubTab === 'todos' || state.resultsSubTab === 'roda'
            ? `
          <div class="${
            state.resultsSubTab === 'roda' ? 'lg:col-span-12' : 'lg:col-span-5'
          } bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 flex flex-col justify-between print-break">
            <div>
              <h3 class="text-base sm:text-lg font-extrabold text-navy">${isComp ? 'Roda Integrada de Liderança e Competências' : 'Roda da Saúde em Radar'}</h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Média das notas válidas de cada um dos 10 eixos (escala 0 a 10).
                ${
                  hasPrev
                    ? `<strong class="text-slate-700">A última Roda (${escapeHtml(avaliacao_anterior.data_avaliacao)}) está preservada como sombreado cinza no fundo e a nova (${escapeHtml(data_avaliacao)}) está desenhada em azul por cima.</strong>`
                    : 'A linha tracejada dourada indica a Referência 6.'
                }
              </p>
            </div>
            <div class="relative w-full max-w-md mx-auto my-4" style="min-height: 360px;">
              <canvas id="chart-personal-radar"></canvas>
            </div>
            <div class="text-[11px] text-slate-500 bg-slatebg p-3 rounded-xl border border-slate-200">
              <strong>Legenda:</strong> Azul = Roda Atual (${escapeHtml(data_avaliacao)}) ${
                hasPrev ? `• Sombreado Cinza = Última Roda (${escapeHtml(avaliacao_anterior.data_avaliacao)})` : ''
              } • Tracejado Dourado = Referência 6.
            </div>
          </div>
        `
            : ''
        }

        ${
          state.resultsSubTab === 'todos' || state.resultsSubTab === 'relatorio'
            ? `
          <div class="${
            state.resultsSubTab === 'relatorio' ? 'lg:col-span-12' : 'lg:col-span-7'
          } bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
            <div class="mb-4">
              <h3 class="text-base sm:text-lg font-extrabold text-navy">Relatório de Notas por ${isComp ? 'Eixo de Competência' : 'Dimensão'}</h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Consolidação dos 10 eixos${
                  hasPrev ? ` comparada com a avaliação anterior (${escapeHtml(avaliacao_anterior.data_avaliacao)})` : ''
                }.
              </p>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs sm:text-sm border-collapse">
                <thead>
                  <tr class="bg-navy text-white text-left">
                    <th class="py-2.5 px-3 rounded-tl-lg font-bold">${isComp ? 'Eixo' : 'Dimensão'}</th>
                    <th class="py-2.5 px-2 text-center font-bold">Com nota</th>
                    ${hasPrev ? `<th class="py-2.5 px-2 text-center font-bold">Anterior</th>` : ''}
                    <th class="py-2.5 px-2 text-center font-bold">Média Atual</th>
                    ${hasPrev ? `<th class="py-2.5 px-2 text-center font-bold">Evolução</th>` : ''}
                    <th class="py-2.5 px-2 text-center font-bold">Sem nota</th>
                    <th class="py-2.5 px-2.5 rounded-tr-lg text-center font-bold">Situação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${relatorio_dimensoes
                    .map((d, idx) => {
                      const isLow = d.media !== null && d.media <= 6;
                      const prevDim = hasPrev ? avaliacao_anterior.relatorio_dimensoes?.[idx] : null;
                      const prevMedia = prevDim ? prevDim.media : null;
                      let deltaHtml = '—';
                      if (hasPrev && d.media !== null && prevMedia !== null) {
                        const diff = Number((d.media - prevMedia).toFixed(2));
                        if (diff > 0) {
                          deltaHtml = `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">+${formatNumber(diff, 1)}</span>`;
                        } else if (diff < 0) {
                          deltaHtml = `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]">${formatNumber(diff, 1)}</span>`;
                        } else {
                          deltaHtml = `<span class="text-slate-400 text-[11px]">0,0</span>`;
                        }
                      }
                      return `
                      <tr class="${idx % 2 === 1 ? 'bg-slatebg/60' : 'bg-white'} hover:bg-cerulean-light/40">
                        <td class="py-2.5 px-3 font-bold text-navy">${escapeHtml(d.dimensao)}</td>
                        <td class="py-2.5 px-2 text-center font-medium">${d.com_nota}</td>
                        ${
                          hasPrev
                            ? `<td class="py-2.5 px-2 text-center text-slate-500 font-semibold">${formatNumber(prevMedia, 1)}</td>`
                            : ''
                        }
                        <td class="py-2.5 px-2 text-center font-extrabold ${
                          d.media === null
                            ? 'text-slate-400'
                            : isLow
                            ? 'text-amber-700'
                            : 'text-cerulean'
                        }">
                          ${formatNumber(d.media, 1)}
                        </td>
                        ${hasPrev ? `<td class="py-2.5 px-2 text-center">${deltaHtml}</td>` : ''}
                        <td class="py-2.5 px-2 text-center text-slate-600">${d.sem_nota}</td>
                        <td class="py-2.5 px-2.5 text-center">
                          <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            d.preenchimento === 'Concluída'
                              ? 'bg-emerald-100 text-emerald-800'
                              : d.preenchimento === 'Parcial' || d.preenchimento === 'Em curso'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }">
                            ${escapeHtml(d.preenchimento)}
                          </span>
                        </td>
                      </tr>
                    `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        `
            : ''
        }
      </div>

      <!-- 2b. Tabela Oficial das 4 Aplicações (Exclusiva do Módulo Roda de Competências) -->
      ${
        isComp && (state.resultsSubTab === 'todos' || state.resultsSubTab === 'relatorio' || state.resultsSubTab === 'roda')
          ? renderQuatroAplicacoesTable()
          : ''
      }

      <!-- 3. Eletrovitae dos 50 Itens -->
      ${
        state.resultsSubTab === 'todos' || state.resultsSubTab === 'eletrovitae'
          ? `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 class="text-base sm:text-lg font-extrabold text-navy">${isComp ? 'Perfil Linear dos 50 Comportamentos (Eletrovitae)' : 'Eletrovitae dos 50 Itens'}</h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Contém os 50 itens na ordem da avaliação. Para facilitar a leitura, o eixo mostra um rótulo a cada cinco itens.
              </p>
            </div>
            <div class="flex items-center gap-4 text-xs font-semibold shrink-0">
              <span class="inline-flex items-center gap-1.5 text-cerulean">
                <span class="w-3 h-3 rounded-full bg-cerulean inline-block"></span> Nota Atual (${escapeHtml(data_avaliacao)})
              </span>
              <span class="inline-flex items-center gap-1.5 text-amberref">
                <span class="w-4 h-0.5 bg-amberref inline-block"></span> Referência 6
              </span>
            </div>
          </div>
          <div class="w-full" style="height: 370px;">
            <canvas id="chart-personal-eletrovitae"></canvas>
          </div>
        </div>
      `
          : ''
      }

      <!-- 4. Seleção de Assuntos a Explorar (Notas <= 6) + Atalho para Plano de Ação -->
      ${
        state.resultsSubTab === 'todos' || state.resultsSubTab === 'relatorio'
          ? `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 class="text-base sm:text-lg font-extrabold text-navy">
                ${isComp ? 'Comportamentos a Desenvolver / Eixos Prioritários (Notas ≤ 6)' : 'Assuntos a Explorar / Áreas em Desfalque (Notas ≤ 6)'}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Itens com nota igual ou inferior a 6 entram na seleção prioritária para o seu Plano de Ação.
              </p>
            </div>
            <button
              id="btn-go-action-plan-bottom"
              class="px-4 py-2 rounded-xl bg-navy hover:bg-navy-light text-white text-xs font-bold shrink-0 no-print"
            >
              ✍️ Escrever Plano de Ação para estas Áreas
            </button>
          </div>
          ${
            assuntos_a_explorar.length === 0
              ? `<div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-medium">
                   Nenhum item recebeu nota igual ou inferior a 6 nesta avaliação. Todas as notas válidas ficaram acima de 6!
                 </div>`
              : `
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              ${assuntos_a_explorar
                .map(
                  (it) => `
                <div class="p-3.5 rounded-xl bg-amberref-soft border border-amberref/30 flex items-start justify-between gap-3">
                  <div>
                    <div class="text-[11px] font-bold uppercase text-slate-500">${escapeHtml(it.dimensao)}</div>
                    <div class="text-sm font-bold text-navy mt-0.5">${escapeHtml(it.rotulo)}</div>
                    <p class="text-xs text-slate-600 mt-1 leading-snug">${escapeHtml(it.pergunta)}</p>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-amberref text-white font-extrabold text-sm shrink-0">
                    ${it.nota}
                  </span>
                </div>
              `
                )
                .join('')}
            </div>
          `
          }
        </div>
      `
          : ''
      }
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 6. Action Plan View (Plano de Ação para cada Área em Desfalque)
// ----------------------------------------------------------------------------
function renderActionPlanView() {
  if (!state.questionnaireData?.resultados) {
    return `<div class="p-8 text-center text-slate-500">Carregando Plano de Ação...</div>`;
  }

  const { relatorio_dimensoes, itens } = state.questionnaireData.resultados;
  const deficitDims = getDeficitDimensions();
  const dimsToRender = state.showAllDimsInPlan ? relatorio_dimensoes : deficitDims;
  const isComp = state.activeModule === 'competencias';

  return `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <span class="px-2.5 py-0.5 rounded bg-amberref text-white text-xs font-bold">
              Desenvolvimento Pessoal • ${isComp ? 'Roda de Liderança e Competências' : 'Roda da Saúde Integral'}
            </span>
            <h2 class="text-xl sm:text-2xl font-extrabold text-navy mt-1">
              🎯 Plano de Ação por ${isComp ? 'Eixo Prioritário' : 'Área em Desfalque'}
            </h2>
            <p class="text-xs sm:text-sm text-slate-600 mt-1">
              ${
                isComp
                  ? 'Escolha os eixos prioritários (média ou comportamentos ≤ 6) e combine uma ação prática, uma meta (nota) e um prazo para a próxima avaliação.'
                  : 'Elabore seu plano de ação prático para cada dimensão que apresentou média ou itens com <strong>nota igual ou inferior a 6</strong> (assuntos a explorar).'
              }
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2.5 no-print">
            <button
              id="btn-toggle-all-dims-plan"
              class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs border border-slate-300 transition-colors"
            >
              ${state.showAllDimsInPlan ? 'Mostrar Apenas Eixos em Desfalque (≤ 6)' : 'Mostrar Todos os 10 Eixos'}
            </button>
            <button
              id="btn-save-action-plan-top"
              class="px-5 py-2.5 rounded-xl bg-cerulean hover:bg-cerulean-dark text-white font-bold text-xs shadow-md transition-colors"
            >
              💾 Salvar Plano de Ação
            </button>
            <button
              onclick="window.print()"
              class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs border border-slate-300 transition-colors"
            >
              🖨️ Imprimir Plano
            </button>
          </div>
        </div>
      </div>

      ${
        dimsToRender.length === 0
          ? `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-3">
          <h3 class="text-lg font-bold text-navy">Nenhuma área com nota igual ou inferior a 6 encontrada</h3>
          <p class="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
            Responda à avaliação completa ou clique no botão abaixo caso deseje escrever um plano de ação para qualquer um dos 10 eixos.
          </p>
          <button
            id="btn-enable-all-dims-empty"
            class="px-5 py-2.5 rounded-xl bg-navy hover:bg-navy-light text-white font-bold text-xs shadow"
          >
            Exibir Todos os 10 Eixos para Planejamento
          </button>
        </div>
      `
          : `
        <div class="space-y-5">
          ${dimsToRender
            .map((d) => {
              const lowItems = itens.filter(
                (it) => it.dimensao === d.dimensao && it.situacao === 'Nota até 6'
              );
              const plan = state.localActionPlan[d.dimensao] || {
                objetivo: '',
                acoes: '',
                meta_nota: '',
                prazo: '',
                status: 'Em andamento',
              };
              const isDeficit = (d.media !== null && d.media <= 6.0) || lowItems.length > 0;

              return `
              <div class="bg-white rounded-2xl shadow-sm border ${
                isDeficit ? 'border-amberref/50' : 'border-slate-200'
              } overflow-hidden print-break">
                <div class="${
                  isDeficit ? 'bg-navy' : 'bg-slate-700'
                } px-5 py-4 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="px-2.5 py-0.5 rounded text-xs font-bold ${
                        isDeficit ? 'bg-amberref text-white' : 'bg-white/20 text-white'
                      }">
                        ${isDeficit ? '⚠️ Eixo Prioritário / Desfalque' : 'Eixo'}
                      </span>
                      <h3 class="text-base sm:text-lg font-extrabold">${escapeHtml(d.dimensao)}</h3>
                      <span class="px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-bold">
                        Média Atual: ${formatNumber(d.media, 1)} / 10
                      </span>
                    </div>
                    <p class="text-xs text-slate-200 mt-1">${escapeHtml(d.o_que_avalia)}</p>
                  </div>
                  ${
                    plan.updated_at
                      ? `<span class="text-[11px] text-amberref-light">Salvo em: ${escapeHtml(plan.updated_at)}</span>`
                      : ''
                  }
                </div>

                <div class="p-5 space-y-4">
                  <!-- Deficit items inside this dimension -->
                  ${
                    lowItems.length > 0
                      ? `
                    <div>
                      <div class="text-xs font-bold uppercase tracking-wider text-amber-900 mb-2">
                        Indicadores com Nota ≤ 6 neste Eixo:
                      </div>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        ${lowItems
                          .map(
                            (it) => `
                          <div class="p-3 rounded-xl bg-amberref-soft border border-amberref/30 flex items-center justify-between gap-3">
                            <div>
                              <div class="text-xs font-bold text-navy">${escapeHtml(it.rotulo)}</div>
                              <div class="text-[11px] text-slate-600">${escapeHtml(it.pergunta)}</div>
                            </div>
                            <span class="px-2.5 py-1 rounded-lg bg-amberref text-white font-extrabold text-xs shrink-0">
                              Nota ${it.nota}
                            </span>
                          </div>
                        `
                          )
                          .join('')}
                      </div>
                    </div>
                  `
                      : ''
                  }

                  <!-- Action Plan Form Fields for this Dimension -->
                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
                    <div class="lg:col-span-4">
                      <label class="block text-xs font-bold uppercase tracking-wider text-navy mb-1.5">
                        1. Objetivo de Melhoria nesta Área *
                      </label>
                      <textarea
                        data-plan-dim="${escapeHtml(d.dimensao)}"
                        data-plan-field="objetivo"
                        rows="3"
                        placeholder="O que você deseja desenvolver em ${escapeHtml(d.dimensao)} nos próximos 3 meses?"
                        class="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-xs sm:text-sm bg-amberref-light/25"
                      >${escapeHtml(plan.objetivo || '')}</textarea>
                    </div>

                    <div class="lg:col-span-5">
                      <label class="block text-xs font-bold uppercase tracking-wider text-navy mb-1.5">
                        2. Ação Prática que Vou Realizar *
                      </label>
                      <textarea
                        data-plan-dim="${escapeHtml(d.dimensao)}"
                        data-plan-field="acoes"
                        rows="3"
                        placeholder="Descreva as ações práticas, rotinas e comportamentos que você vai aplicar..."
                        class="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-xs sm:text-sm bg-amberref-light/25"
                      >${escapeHtml(plan.acoes || '')}</textarea>
                    </div>

                    <div class="lg:col-span-3 flex flex-col justify-between gap-2.5">
                      <div class="grid grid-cols-2 gap-2">
                        <div>
                          <label class="block text-[11px] font-bold uppercase tracking-wider text-navy mb-1">
                            3. Meta (Nota)
                          </label>
                          <input
                            type="text"
                            data-plan-dim="${escapeHtml(d.dimensao)}"
                            data-plan-field="meta_nota"
                            value="${escapeHtml(plan.meta_nota || '')}"
                            placeholder="Ex: 8,0"
                            class="w-full px-2.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-xs bg-amberref-light/25"
                          />
                        </div>
                        <div>
                          <label class="block text-[11px] font-bold uppercase tracking-wider text-navy mb-1">
                            4. Prazo
                          </label>
                          <input
                            type="text"
                            data-plan-dim="${escapeHtml(d.dimensao)}"
                            data-plan-field="prazo"
                            value="${escapeHtml(plan.prazo || '')}"
                            placeholder="Ex: 90 dias"
                            class="w-full px-2.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cerulean text-xs bg-amberref-light/25"
                          />
                        </div>
                      </div>
                      <div>
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-navy mb-1">
                          5. Status
                        </label>
                        <select
                          data-plan-dim="${escapeHtml(d.dimensao)}"
                          data-plan-field="status"
                          class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-navy focus:outline-none focus:ring-2 focus:ring-cerulean"
                        >
                          <option value="Não iniciado" ${plan.status === 'Não iniciado' ? 'selected' : ''}>Não iniciado</option>
                          <option value="Em andamento" ${(!plan.status || plan.status === 'Em andamento') ? 'selected' : ''}>Em andamento</option>
                          <option value="Concluído" ${plan.status === 'Concluído' ? 'selected' : ''}>Concluído</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            `;
            })
            .join('')}
        </div>

        <div class="bg-white rounded-2xl shadow-md border border-slate-200 p-5 flex items-center justify-between gap-4 no-print">
          <span class="text-xs sm:text-sm text-slate-600">
            Lembre-se de clicar em <strong>Salvar Plano de Ação</strong> após preencher ou atualizar suas metas.
          </span>
          <button
            id="btn-save-action-plan-bottom"
            class="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-lg transition-colors"
          >
            💾 Salvar Plano de Ação
          </button>
        </div>
      `
      }
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 7. Tutorial e 10 Eixos View (Supports Both Saúde Integral & Competências)
// ----------------------------------------------------------------------------
function renderTutorialAndEixosView() {
  if (!state.questionnaireData) return '';
  const { tutorial, eixos } = state.questionnaireData;
  const isComp = state.activeModule === 'competencias';

  if (isComp) {
    const tutorialCards = Array.isArray(tutorial) ? tutorial : [];
    return `
      <div class="space-y-6">
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <span class="px-2.5 py-0.5 rounded bg-cerulean text-white text-xs font-bold">Guia Oficial • Aba Critérios</span>
          <h2 class="text-xl font-extrabold text-navy mt-2">Roda Integrada de Liderança e Competências — Critérios e Funcionamento</h2>
          <p class="text-xs text-slate-500 mt-0.5">50 comportamentos avaliados em 10 eixos • Acompanhamento em até 4 aplicações trimestrais</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            ${tutorialCards
              .map(
                (t) => `
              <div class="p-4 rounded-xl bg-slatebg border border-slate-200">
                <div class="text-sm font-bold text-navy">${escapeHtml(t.secao)}</div>
                <p class="text-xs text-slate-600 mt-1.5 leading-relaxed">${escapeHtml(t.texto)}</p>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 class="text-lg font-extrabold text-navy mb-1">Os 10 Eixos da Roda Integrada de Liderança e Competências</h3>
          <p class="text-xs text-slate-500 mb-4">Os eixos reúnem temas próximos das rodas originais (Roda de Liderança e Roda de Competências). Cada eixo possui cinco comportamentos distintos.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-xs sm:text-sm border-collapse">
              <thead>
                <tr class="bg-navy text-white text-left">
                  <th class="py-2.5 px-3 font-bold">#</th>
                  <th class="py-2.5 px-3 font-bold">Eixo</th>
                  <th class="py-2.5 px-3 font-bold">Temas de Origem</th>
                  <th class="py-2.5 px-3 font-bold">Rótulo no Radar</th>
                  <th class="py-2.5 px-3 font-bold text-center">Itens</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${eixos
                  .map(
                    (e) => `
                  <tr class="hover:bg-slatebg">
                    <td class="py-3 px-3 font-bold text-slate-500">${e.ordem}</td>
                    <td class="py-3 px-3 font-bold text-navy">${escapeHtml(e.dimensao)}</td>
                    <td class="py-3 px-3 text-slate-700">${escapeHtml(e.temas_origem || e.foco || '')}</td>
                    <td class="py-3 px-3 font-semibold text-cerulean">${escapeHtml(e.rotulo_radar || '')}</td>
                    <td class="py-3 px-3 text-center font-medium text-slate-600">${escapeHtml(e.itens || '')}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <span class="px-2.5 py-0.5 rounded bg-navy text-white text-xs font-bold">Guia Oficial da Planilha</span>
        <h2 class="text-xl font-extrabold text-navy mt-2">${escapeHtml(tutorial.titulo)} — Como Responder</h2>
        <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(tutorial.autoria)} • ${escapeHtml(tutorial.subtitulo)}</p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          ${tutorial.passos
            .map(
              (p) => `
            <div class="p-4 rounded-xl bg-slatebg border border-slate-200">
              <div class="text-sm font-bold text-navy">${escapeHtml(p.titulo)}</div>
              <p class="text-xs text-slate-600 mt-1.5 leading-relaxed">${escapeHtml(p.descricao)}</p>
            </div>
          `
            )
            .join('')}
        </div>

        <h3 class="text-sm font-bold text-navy mt-6 mb-3 uppercase tracking-wider">Escala de Notas (1 a 10)</h3>
        <div class="overflow-x-auto">
          <table class="w-full max-w-lg text-xs sm:text-sm border-collapse border border-slate-200 rounded-xl overflow-hidden">
            <thead>
              <tr class="bg-navy text-white text-left">
                <th class="py-2 px-4 font-bold">Notas</th>
                <th class="py-2 px-4 font-bold">Significado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${tutorial.escala
                .map(
                  (s) => `
                <tr>
                  <td class="py-2 px-4 font-bold text-navy bg-amberref-light/50">${escapeHtml(s.notas)}</td>
                  <td class="py-2 px-4 text-slate-700">${escapeHtml(s.significado)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <h3 class="text-sm font-bold text-navy mt-6 mb-3 uppercase tracking-wider">Orientações Metodológicas</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${tutorial.orientacoes
            .map(
              (o) => `
            <div class="p-3.5 rounded-xl bg-slatebg/60 border border-slate-200 text-xs">
              <strong class="text-navy block mb-0.5">${escapeHtml(o.topico)}:</strong>
              <span class="text-slate-600 leading-relaxed">${escapeHtml(o.descricao)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 class="text-lg font-extrabold text-navy mb-1">As 10 Dimensões da Saúde Integral (Aba Eixos)</h3>
        <p class="text-xs text-slate-500 mb-4">Conceitos das dimensões e acompanhamento da revisão de conteúdo.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs sm:text-sm border-collapse">
            <thead>
              <tr class="bg-navy text-white text-left">
                <th class="py-2.5 px-3 font-bold">#</th>
                <th class="py-2.5 px-3 font-bold">Dimensão</th>
                <th class="py-2.5 px-3 font-bold">O que avalia</th>
                <th class="py-2.5 px-3 font-bold text-center">Status</th>
                <th class="py-2.5 px-3 font-bold">Observação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${eixos
                .map(
                  (e) => `
                <tr class="hover:bg-slatebg">
                  <td class="py-3 px-3 font-bold text-slate-500">${e.ordem}</td>
                  <td class="py-3 px-3 font-bold text-navy whitespace-nowrap">${escapeHtml(e.dimensao)}</td>
                  <td class="py-3 px-3 text-slate-700">${escapeHtml(e.o_que_avalia)}</td>
                  <td class="py-3 px-3 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded text-[11px] font-semibold ${
                      e.revisao === 'Validado' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }">
                      ${escapeHtml(e.revisao)}
                    </span>
                  </td>
                  <td class="py-3 px-3 text-xs text-slate-500">${escapeHtml(e.observacao)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 8. Admin View: Anonymous Class Reports by Turma
// ----------------------------------------------------------------------------
function renderAdminClassReportView() {
  if (!state.adminReport) {
    return `<div class="p-8 text-center text-slate-500">Carregando relatório consolidado da turma...</div>`;
  }

  const isComp = state.activeModule === 'competencias';
  const {
    turma,
    resumo_turma,
    melhores_dimensoes,
    piores_dimensoes,
    melhores_indicadores,
    piores_indicadores,
    relatorio_dimensoes,
  } = state.adminReport;

  const turmaOptions = [
    `<option value="all" ${state.selectedAdminTurma === 'all' ? 'selected' : ''}>Todas as Turmas (Consolidado)</option>`,
    ...state.adminTurmas.map(
      (t) =>
        `<option value="${t.id}" ${String(state.selectedAdminTurma) === String(t.id) ? 'selected' : ''}>
          ${escapeHtml(t.cod_turma)} — ${escapeHtml(t.nome_curso || '')} (${t.total_alunos} alunos)
        </option>`
    ),
  ].join('');

  return `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="px-2.5 py-0.5 rounded bg-navy text-white text-xs font-bold">
                Painel Docente • ${isComp ? 'Roda de Competências da Turma' : 'Roda da Saúde da Turma'}
              </span>
              <span class="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-300">
                🔒 Sigilo Individual Ativo (Sem acesso a notas individuais)
              </span>
            </div>
            <h2 class="text-xl sm:text-2xl font-extrabold text-navy">
              ${escapeHtml(turma.cod_turma)} — ${escapeHtml(turma.nome_curso || '')}
            </h2>
            <p class="text-xs text-slate-500 mt-0.5">
              ${escapeHtml(turma.nome_filial || 'SENAI / FIEMG')} • Período Letivo: ${escapeHtml(turma.periodo_letivo || '2026')} • Módulo: <strong>${isComp ? 'Roda Integrada de Liderança e Competências' : 'Roda da Saúde Integral'}</strong>
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3 no-print">
            <div>
              <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Selecionar Turma:</label>
              <select
                id="admin-turma-select"
                class="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-cerulean"
              >
                ${turmaOptions}
              </select>
            </div>
            <button
              onclick="window.print()"
              class="self-end px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy font-semibold text-xs border border-slate-300 transition-colors"
            >
              🖨️ Imprimir Relatório da Turma
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div class="p-4 rounded-xl bg-slatebg border border-slate-200">
            <div class="text-[11px] font-bold uppercase text-slate-500">Média Geral de Pontuação da Turma</div>
            <div class="text-2xl sm:text-3xl font-extrabold text-navy mt-1">
              ${formatNumber(resumo_turma.media_geral_turma, 2)} <span class="text-xs font-normal text-slate-500">/ 10</span>
            </div>
          </div>
          <div class="p-4 rounded-xl bg-slatebg border border-slate-200">
            <div class="text-[11px] font-bold uppercase text-slate-500">Participação da Turma</div>
            <div class="text-2xl sm:text-3xl font-extrabold text-cerulean mt-1">
              ${resumo_turma.total_respondentes} <span class="text-sm font-semibold text-slate-500">de ${resumo_turma.total_alunos} alunos (${formatNumber(resumo_turma.taxa_participacao, 0)}%)</span>
            </div>
          </div>
          <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <div class="text-[11px] font-bold uppercase text-emerald-800">Melhor ${isComp ? 'Eixo Médio' : 'Dimensão Média'}</div>
            <div class="text-base sm:text-lg font-extrabold text-emerald-900 mt-1 truncate">
              ${melhores_dimensoes[0] ? `${escapeHtml(melhores_dimensoes[0].dimensao)} (${formatNumber(melhores_dimensoes[0].media_turma, 2)})` : 'Sem dados'}
            </div>
          </div>
          <div class="p-4 rounded-xl bg-amberref-soft border border-amberref/30">
            <div class="text-[11px] font-bold uppercase text-amber-900">Pior ${isComp ? 'Eixo Médio' : 'Dimensão Média'} (Atenção)</div>
            <div class="text-base sm:text-lg font-extrabold text-amber-900 mt-1 truncate">
              ${piores_dimensoes[0] ? `${escapeHtml(piores_dimensoes[0].dimensao)} (${formatNumber(piores_dimensoes[0].media_turma, 2)})` : 'Sem dados'}
            </div>
          </div>
        </div>
      </div>

      ${
        resumo_turma.total_respondentes === 0
          ? `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-2">
          <h3 class="text-lg font-bold text-navy">Nenhum aluno desta turma concluiu ${isComp ? 'a Roda de Competências' : 'a Roda da Saúde'} ainda</h3>
          <p class="text-xs sm:text-sm text-slate-500 max-w-xl mx-auto">
            Assim que os alunos da turma <strong>${escapeHtml(turma.cod_turma)}</strong> responderem ${isComp ? 'à Autoavaliação de Liderança e Competências' : 'ao questionário da Roda da Saúde Integral'}, o relatório coletivo aparecerá automaticamente aqui.
          </p>
        </div>
      `
          : `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="bg-white rounded-2xl shadow-sm border border-emerald-200 p-5 sm:p-6 print-break">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-base sm:text-lg font-extrabold text-emerald-900">
                🏆 Melhores Indicadores Médios da Turma
              </h3>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Pontos Fortes</span>
            </div>

            <div class="text-xs font-bold uppercase text-slate-500 mb-2">Top 3 ${isComp ? 'Eixos' : 'Dimensões'} com Maior Média:</div>
            <div class="space-y-2 mb-5">
              ${melhores_dimensoes
                .map(
                  (d, i) => `
                <div class="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
                  <div>
                    <span class="text-xs font-bold text-emerald-800">${i + 1}º Lugar • </span>
                    <span class="text-sm font-bold text-navy">${escapeHtml(d.dimensao)}</span>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-extrabold text-xs">
                    Média: ${formatNumber(d.media_turma, 2)}
                  </span>
                </div>
              `
                )
                .join('')}
            </div>

            <div class="text-xs font-bold uppercase text-slate-500 mb-2">Top 5 ${isComp ? 'Comportamentos' : 'Itens do Eletrovitae'} com Maior Média:</div>
            <div class="space-y-2">
              ${melhores_indicadores
                .map(
                  (it) => `
                <div class="p-2.5 rounded-xl bg-slatebg border border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <div class="text-xs font-bold text-navy">${escapeHtml(it.rotulo)} <span class="font-normal text-slate-500">(${escapeHtml(it.dimensao)})</span></div>
                    <div class="text-[11px] text-slate-600">${escapeHtml(it.pergunta)}</div>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-cerulean text-white font-extrabold text-xs shrink-0">
                    ${formatNumber(it.media_turma, 2)}
                  </span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-amberref/40 p-5 sm:p-6 print-break">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-base sm:text-lg font-extrabold text-amber-900">
                ⚠️ Piores Indicadores Médios da Turma
              </h3>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amberref-light text-amber-900">Foco de Atenção</span>
            </div>

            <div class="text-xs font-bold uppercase text-slate-500 mb-2">3 ${isComp ? 'Eixos' : 'Dimensões'} com Menor Média na Turma:</div>
            <div class="space-y-2 mb-5">
              ${piores_dimensoes
                .map(
                  (d, i) => `
                <div class="p-3 rounded-xl bg-amberref-soft border border-amberref/30 flex items-center justify-between">
                  <div>
                    <span class="text-xs font-bold text-amber-800">${i + 1}º Mais Baixo • </span>
                    <span class="text-sm font-bold text-navy">${escapeHtml(d.dimensao)}</span>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-amberref text-white font-extrabold text-xs">
                    Média: ${formatNumber(d.media_turma, 2)}
                  </span>
                </div>
              `
                )
                .join('')}
            </div>

            <div class="text-xs font-bold uppercase text-slate-500 mb-2">5 ${isComp ? 'Comportamentos' : 'Itens do Eletrovitae'} com Menor Média na Turma:</div>
            <div class="space-y-2">
              ${piores_indicadores
                .map(
                  (it) => `
                <div class="p-2.5 rounded-xl bg-slatebg border border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <div class="text-xs font-bold text-navy">${escapeHtml(it.rotulo)} <span class="font-normal text-slate-500">(${escapeHtml(it.dimensao)})</span></div>
                    <div class="text-[11px] text-slate-600">${escapeHtml(it.pergunta)}</div>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg bg-amber-700 text-white font-extrabold text-xs shrink-0">
                    ${formatNumber(it.media_turma, 2)}
                  </span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
            <h3 class="text-base sm:text-lg font-extrabold text-navy">${isComp ? 'Roda de Competências Média da Turma' : 'Roda da Saúde Média da Turma'}</h3>
            <p class="text-xs text-slate-500 mt-0.5">Média coletiva da turma nos 10 eixos (0 a 10).</p>
            <div class="relative w-full max-w-md mx-auto my-4" style="min-height: 330px;">
              <canvas id="chart-admin-radar"></canvas>
            </div>
          </div>

          <div class="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
            <h3 class="text-base sm:text-lg font-extrabold text-navy mb-3">Média da Turma por ${isComp ? 'Eixo de Competência' : 'Dimensão'} (10 Eixos)</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-xs sm:text-sm border-collapse">
                <thead>
                  <tr class="bg-navy text-white text-left">
                    <th class="py-2.5 px-3 rounded-tl-lg font-bold">${isComp ? 'Eixo de Competência' : 'Dimensão'}</th>
                    <th class="py-2.5 px-2.5 text-center font-bold">Média da Turma</th>
                    <th class="py-2.5 px-2.5 text-center font-bold">Alunos c/ Nota</th>
                    <th class="py-2.5 px-3 rounded-tr-lg text-center font-bold">% Respostas ≤ 6</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${relatorio_dimensoes
                    .map(
                      (d, idx) => `
                    <tr class="${idx % 2 === 1 ? 'bg-slatebg/60' : 'bg-white'}">
                      <td class="py-2.5 px-3 font-bold text-navy">${escapeHtml(d.dimensao)}</td>
                      <td class="py-2.5 px-2.5 text-center font-extrabold ${
                        d.media_turma !== null && d.media_turma <= 6 ? 'text-amber-700' : 'text-cerulean'
                      }">
                        ${formatNumber(d.media_turma, 2)}
                      </td>
                      <td class="py-2.5 px-2.5 text-center text-slate-600">${d.respondentes_com_nota}</td>
                      <td class="py-2.5 px-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          d.percentual_ate_6 >= 50 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                        }">
                          ${formatNumber(d.percentual_ate_6, 1)}%
                        </span>
                      </td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 print-break">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 class="text-base sm:text-lg font-extrabold text-navy">${isComp ? 'Curva Coletiva dos 50 Comportamentos da Turma' : 'Eletrovitae Médio da Turma (50 Indicadores)'}</h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Pontuação média coletiva da turma em cada um dos 50 itens, comparada à linha de Referência 6.
              </p>
            </div>
          </div>
          <div class="w-full" style="height: 370px;">
            <canvas id="chart-admin-eletrovitae"></canvas>
          </div>
        </div>
      `
      }
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 9. Admin View: Upload Excel, Manage Turmas (Delete Turma) & Students (Reset/Delete)
// ----------------------------------------------------------------------------
function renderAdminUsersAndUploadView() {
  const turmaFilterOpts = [
    `<option value="all" ${state.adminUserTurmaFilter === 'all' ? 'selected' : ''}>Todas as Turmas</option>`,
    ...state.adminTurmas.map(
      (t) =>
        `<option value="${t.id}" ${String(state.adminUserTurmaFilter) === String(t.id) ? 'selected' : ''}>
          ${escapeHtml(t.cod_turma)} — ${escapeHtml(t.nome_curso || '')}
        </option>`
    ),
  ].join('');

  const searchLower = state.adminUserSearch.trim().toLowerCase();
  const filteredUsers = state.adminUsers.filter((u) => {
    if (!searchLower) return true;
    return (
      (u.nome && u.nome.toLowerCase().includes(searchLower)) ||
      (u.email && u.email.toLowerCase().includes(searchLower)) ||
      (u.ra && u.ra.toLowerCase().includes(searchLower))
    );
  });

  return `
    <div class="space-y-6">
      <!-- Top Grid: Upload Excel & Add Single Student -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Upload Excel & Manage Turmas Card -->
        <div class="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
          <span class="px-2.5 py-0.5 rounded bg-amberref text-white text-xs font-bold">Importação Automática de Turma</span>
          <h3 class="text-lg font-extrabold text-navy mt-2">Carregar Planilha Excel de Alunos (.xlsx)</h3>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">
            Envie uma planilha no formato <strong>DADOS ALUNOS.XLSX</strong>. Automaticamente cada aluno ganha acesso autorizado com seu <strong>e-mail como login</strong> e <strong>senha padrão 123456</strong>.
          </p>

          <form id="admin-upload-excel-form" class="mt-4 space-y-3">
            <div class="border-2 border-dashed border-cerulean/40 rounded-2xl p-4 bg-cerulean-light/30 flex flex-col sm:flex-row items-center justify-between gap-3">
              <input
                id="excel-file-input"
                type="file"
                accept=".xlsx,.xlsm"
                required
                class="text-xs text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-navy file:text-white hover:file:bg-navy-light cursor-pointer"
              />
              <button
                type="submit"
                class="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cerulean hover:bg-cerulean-dark text-white font-bold text-xs shadow-md transition-colors shrink-0"
              >
                📤 Importar Planilha Excel
              </button>
            </div>
          </form>

          <!-- Turmas Cadastradas + Delete Turma Button -->
          <div class="mt-5 pt-4 border-t border-slate-100">
            <div class="text-xs font-bold uppercase text-slate-500 mb-2.5">Turmas Cadastradas no Sistema:</div>
            ${
              state.adminTurmas.length === 0
                ? `<div class="text-xs text-slate-400 italic">Nenhuma turma cadastrada no momento.</div>`
                : `
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                ${state.adminTurmas
                  .map(
                    (t) => `
                  <div class="p-3 rounded-xl bg-slatebg border border-slate-200 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div class="font-extrabold text-navy">${escapeHtml(t.cod_turma)}</div>
                      <div class="text-[11px] text-slate-600">${escapeHtml(t.nome_curso || '')}</div>
                      <div class="text-[11px] text-cerulean font-semibold mt-0.5">
                        ${t.total_alunos} alunos • 🌿 Saúde: ${t.questionarios_concluidos} • 🎯 Comp.: ${t.competencias_concluidos || 0}
                      </div>
                    </div>
                    <button
                      data-delete-turma="${t.id}"
                      data-turma-name="${escapeHtml(t.cod_turma)}"
                      class="px-2.5 py-1.5 rounded-lg bg-red-100 hover:bg-red-600 hover:text-white text-red-700 font-bold text-[11px] transition-colors shrink-0"
                      title="Deletar turma e todos os alunos vinculados"
                    >
                      🗑️ Deletar Turma
                    </button>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            }
          </div>
        </div>

        <!-- Manual Student Registration Card -->
        <div class="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
          <span class="px-2.5 py-0.5 rounded bg-navy text-white text-xs font-bold">Cadastro Individual</span>
          <h3 class="text-lg font-extrabold text-navy mt-2">Autorizar / Adicionar Aluno Manualmente</h3>
          <form id="admin-add-user-form" class="mt-3 space-y-3 text-xs">
            <div>
              <label class="block font-bold text-slate-600 mb-1">Nome Completo do Aluno *</label>
              <input id="add-user-nome" type="text" required placeholder="Nome completo" class="w-full px-3 py-2 rounded-xl border border-slate-300" />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label class="block font-bold text-slate-600 mb-1">E-mail (Login) *</label>
                <input id="add-user-email" type="email" required placeholder="aluno@email.com" class="w-full px-3 py-2 rounded-xl border border-slate-300" />
              </div>
              <div>
                <label class="block font-bold text-slate-600 mb-1">RA / Matrícula</label>
                <input id="add-user-ra" type="text" placeholder="000123456" class="w-full px-3 py-2 rounded-xl border border-slate-300" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label class="block font-bold text-slate-600 mb-1">Código da Turma *</label>
                <input id="add-user-turma" type="text" required value="${escapeHtml(state.adminTurmas[0]?.cod_turma || 'PG-EL4-01-26-N-12971')}" class="w-full px-3 py-2 rounded-xl border border-slate-300" />
              </div>
              <div>
                <label class="block font-bold text-slate-600 mb-1">Nome do Curso</label>
                <input id="add-user-curso" type="text" value="${escapeHtml(state.adminTurmas[0]?.nome_curso || 'MBA EM LIDERANÇA 4.0')}" class="w-full px-3 py-2 rounded-xl border border-slate-300" />
              </div>
            </div>
            <button type="submit" class="w-full py-2.5 px-4 rounded-xl bg-navy hover:bg-navy-light text-white font-bold shadow transition-colors">
              ➕ Cadastrar e Autorizar com Senha Inicial 123456
            </button>
          </form>
        </div>
      </div>

      <!-- Students List & Access Authorization Table -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h3 class="text-base sm:text-lg font-extrabold text-navy">
              Gestão de Alunos, Respostas e Autorizações (${filteredUsers.length} alunos)
            </h3>
            <p class="text-xs text-slate-500">
              Gerencie a liberação de acesso, redefina senhas, resete respostas (Saúde ou Competências) ou remova alunos. Conforme as regras de privacidade, nenhuma nota individual é exibida.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select id="admin-users-turma-filter" class="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-navy">
              ${turmaFilterOpts}
            </select>
            <input
              id="admin-users-search"
              type="text"
              value="${escapeHtml(state.adminUserSearch)}"
              placeholder="Buscar por nome, e-mail ou RA..."
              class="px-3 py-2 rounded-xl border border-slate-300 text-xs w-56"
            />
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs sm:text-sm border-collapse">
            <thead>
              <tr class="bg-navy text-white text-left">
                <th class="py-2.5 px-3 rounded-tl-lg font-bold">Aluno(a)</th>
                <th class="py-2.5 px-3 font-bold">E-mail (Login)</th>
                <th class="py-2.5 px-2.5 font-bold">Turma</th>
                <th class="py-2.5 px-2.5 text-center font-bold">Acesso</th>
                <th class="py-2.5 px-2.5 text-center font-bold">🌿 Saúde / 🎯 Competências</th>
                <th class="py-2.5 px-3 rounded-tr-lg text-right font-bold">Ações do Admin</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${filteredUsers
                .map(
                  (u, idx) => `
                <tr class="${!u.autorizado ? 'bg-amber-50' : idx % 2 === 1 ? 'bg-slatebg/50' : 'bg-white'}">
                  <td class="py-2.5 px-3">
                    <div class="font-bold text-navy">${escapeHtml(u.nome)}</div>
                    <div class="text-[11px] text-slate-500">RA: ${escapeHtml(u.ra || '—')} • ${escapeHtml(u.situacao_matricula || '—')}</div>
                  </td>
                  <td class="py-2.5 px-3 text-slate-700">${escapeHtml(u.email)}</td>
                  <td class="py-2.5 px-2.5 text-xs font-semibold text-cerulean">${escapeHtml(u.turma?.cod_turma || 'Sem turma')}</td>
                  <td class="py-2.5 px-2.5 text-center">
                    ${
                      u.autorizado
                        ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">Autorizado</span>`
                        : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200 text-amber-900">Pendente / Bloqueado</span>`
                    }
                  </td>
                  <td class="py-2.5 px-2.5 text-center space-y-1">
                    <div>
                      ${
                        u.questionario_concluido
                          ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-cerulean-light text-navy inline-block">🌿 Saúde: ${u.qtd_avaliacoes || 1}x (${escapeHtml(u.data_ultima_resposta || '')})</span>`
                          : u.tem_respostas
                          ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 inline-block">🌿 Saúde: Rascunho</span>`
                          : `<span class="px-2 py-0.5 rounded text-[10px] text-slate-400 inline-block">🌿 Saúde: Pendente</span>`
                      }
                    </div>
                    <div>
                      ${
                        u.competencias_concluido
                          ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amberref-light text-amber-900 inline-block">🎯 Comp.: ${u.qtd_competencias || 1}x (${escapeHtml(u.data_ultima_competencia || '')})</span>`
                          : u.tem_respostas_competencias
                          ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 inline-block">🎯 Comp.: Rascunho</span>`
                          : `<span class="px-2 py-0.5 rounded text-[10px] text-slate-400 inline-block">🎯 Comp.: Pendente</span>`
                      }
                    </div>
                  </td>
                  <td class="py-2.5 px-3 text-right whitespace-nowrap space-x-1">
                    <button
                      data-toggle-auth="${u.id}"
                      data-current-auth="${u.autorizado ? '1' : '0'}"
                      class="px-2 py-1 rounded-lg text-[11px] font-semibold ${
                        u.autorizado
                          ? 'bg-amber-100 hover:bg-amber-200 text-amber-900'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                      }"
                    >
                      ${u.autorizado ? 'Bloquear' : '✓ Autorizar'}
                    </button>
                    <button
                      data-reset-pw="${u.id}"
                      class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300"
                      title="Redefinir senha para 123456"
                    >
                      🔑 Senha 123456
                    </button>
                    <button
                      data-reset-assessment="${u.id}"
                      data-user-name="${escapeHtml(u.nome)}"
                      class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-sky-100 hover:bg-sky-200 text-sky-900 border border-sky-300"
                      title="Resetar respostas da Roda da Saúde deste aluno"
                    >
                      🔄 Resetar Saúde
                    </button>
                    <button
                      data-reset-competencias="${u.id}"
                      data-user-name="${escapeHtml(u.nome)}"
                      class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300"
                      title="Resetar respostas da Roda de Competências deste aluno"
                    >
                      🔄 Resetar Comp.
                    </button>
                    <button
                      data-delete-user="${u.id}"
                      data-user-name="${escapeHtml(u.nome)}"
                      class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-100 hover:bg-red-600 hover:text-white text-red-700 border border-red-200 transition-colors"
                      title="Deletar aluno do sistema"
                    >
                      🗑️ Deletar
                    </button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 10. Event Bindings for Main Authenticated Views
// ----------------------------------------------------------------------------
function bindMainEvents() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.onclick = () => logout();

  const btnChangePw = document.getElementById('btn-open-change-pw');
  if (btnChangePw) {
    btnChangePw.onclick = () => {
      state.user.primeiro_acesso = true;
      state.skipFirstAccessPromptSession = false;
      render();
    };
  }

  // Module Switcher Buttons (Saúde Integral vs Liderança e Competências)
  document.querySelectorAll('[data-switch-module]').forEach((btn) => {
    btn.onclick = async () => {
      const targetMod = btn.getAttribute('data-switch-module');
      if (targetMod === state.activeModule) return;
      state.activeModule = targetMod;
      state.selectedDimFilter = 'todas';
      state.novaAvaliacaoMode = false;
      state.openExamples = {};
      await loadQuestionnaireData();
      if (state.user.role === 'admin' && state.activeTab === 'admin_relatorio') {
        await loadAdminReport();
      }
      render();
    };
  });

  // Cargo / Área input for Roda de Competências
  const cargoInput = document.getElementById('comp-cargo-area');
  if (cargoInput) {
    cargoInput.oninput = (e) => {
      state.localCargoArea = e.target.value;
      state.unsavedChanges = true;
    };
  }

  // Start new wheel evaluation button (from top trimestral banner)
  const btnStartNewWheel = document.getElementById('btn-start-new-wheel');
  if (btnStartNewWheel) {
    btnStartNewWheel.onclick = () => {
      state.novaAvaliacaoMode = true;
      state.activeTab = 'questionario';
      showToast(
        state.activeModule === 'competencias'
          ? 'Modo de Nova Aplicação ativado! Ao finalizar, a avaliação entrará no histórico das 4 aplicações e a roda anterior ficará sombreada no fundo.'
          : 'Modo de Nova Avaliação ativado! Ao finalizar, sua última Roda da Saúde ficará como sombreado no fundo.',
        'info'
      );
      render();
    };
  }

  const btnClearFormNew = document.getElementById('btn-clear-form-new');
  if (btnClearFormNew) {
    btnClearFormNew.onclick = () => {
      state.localAnswers = {};
      state.unsavedChanges = true;
      render();
    };
  }

  // Navigation Tabs
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.onclick = async () => {
      const target = btn.getAttribute('data-nav');
      state.activeTab = target;
      if (target === 'admin_relatorio') {
        await loadAdminReport();
      } else if (target === 'admin_alunos') {
        await loadAdminTurmasAndUsers();
      }
      render();
    };
  });

  // Questionnaire events
  const dimSelect = document.getElementById('dim-filter-select');
  if (dimSelect) {
    dimSelect.onchange = (e) => {
      state.selectedDimFilter = e.target.value;
      render();
    };
  }

  // Score buttons (0..10 for Competências, 1..10 for Saúde)
  document.querySelectorAll('[data-score]').forEach((btn) => {
    btn.onclick = () => {
      const qnum = String(btn.getAttribute('data-qnum'));
      const score = Number(btn.getAttribute('data-score'));
      const current = state.localAnswers[qnum]?.nota;
      if (current === score) {
        delete state.localAnswers[qnum];
      } else {
        state.localAnswers[qnum] = { nota: score, sem_nota: null };
      }
      state.unsavedChanges = true;
      render();
    };
  });

  // Sem nota dropdowns
  document.querySelectorAll('[data-semnota-qnum]').forEach((sel) => {
    sel.onchange = (e) => {
      const qnum = String(sel.getAttribute('data-semnota-qnum'));
      const val = e.target.value;
      if (!val) {
        delete state.localAnswers[qnum];
      } else {
        state.localAnswers[qnum] = { nota: null, sem_nota: val };
      }
      state.unsavedChanges = true;
      render();
    };
  });

  // Toggle example buttons
  document.querySelectorAll('[data-toggle-example]').forEach((btn) => {
    btn.onclick = () => {
      const qnum = String(btn.getAttribute('data-toggle-example'));
      state.openExamples[qnum] = !state.openExamples[qnum];
      render();
    };
  });

  // Save draft & Finalize buttons
  const saveDraftHandler = async () => {
    const isComp = state.activeModule === 'competencias';
    const saveEndpoint = isComp ? '/api/competencias/save' : '/api/questionnaire/save';
    try {
      const res = await apiFetch(saveEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          respostas: state.localAnswers,
          cargo_area: state.localCargoArea,
          finalizar: false,
          nova_avaliacao: false,
        }),
      });
      state.questionnaireData = res;
      state.localAnswers = JSON.parse(JSON.stringify(res.respostas || {}));
      if (isComp) state.localCargoArea = res.cargo_area || '';
      state.unsavedChanges = false;
      showToast(res.message, 'success');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const finalizeHandler = async () => {
    const isComp = state.activeModule === 'competencias';
    const saveEndpoint = isComp ? '/api/competencias/save' : '/api/questionnaire/save';
    try {
      const res = await apiFetch(saveEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          respostas: state.localAnswers,
          cargo_area: state.localCargoArea,
          finalizar: true,
          nova_avaliacao: state.novaAvaliacaoMode || state.questionnaireData?.concluido,
        }),
      });
      state.questionnaireData = res;
      state.localAnswers = JSON.parse(JSON.stringify(res.respostas || {}));
      if (isComp) state.localCargoArea = res.cargo_area || '';
      state.novaAvaliacaoMode = false;
      state.unsavedChanges = false;
      state.activeTab = 'resultados';
      showToast(res.message, 'success');
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnSaveTop = document.getElementById('btn-save-draft');
  const btnSaveBot = document.getElementById('btn-save-draft-bottom');
  if (btnSaveTop) btnSaveTop.onclick = saveDraftHandler;
  if (btnSaveBot) btnSaveBot.onclick = saveDraftHandler;

  const btnFinTop = document.getElementById('btn-finalize-questionnaire');
  const btnFinBot = document.getElementById('btn-finalize-bottom');
  if (btnFinTop) btnFinTop.onclick = finalizeHandler;
  if (btnFinBot) btnFinBot.onclick = finalizeHandler;

  const btnGoQuest = document.getElementById('btn-go-to-questionnaire');
  if (btnGoQuest) {
    btnGoQuest.onclick = () => {
      state.activeTab = 'questionario';
      render();
    };
  }

  const btnGoPlan = document.getElementById('btn-go-action-plan');
  const btnGoPlanBot = document.getElementById('btn-go-action-plan-bottom');
  if (btnGoPlan) {
    btnGoPlan.onclick = () => {
      state.activeTab = 'plano_acao';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }
  if (btnGoPlanBot) {
    btnGoPlanBot.onclick = () => {
      state.activeTab = 'plano_acao';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // Results sub-tabs
  document.querySelectorAll('[data-res-subtab]').forEach((btn) => {
    btn.onclick = () => {
      state.resultsSubTab = btn.getAttribute('data-res-subtab');
      render();
    };
  });

  // Action Plan Events
  document.querySelectorAll('[data-plan-dim]').forEach((el) => {
    el.oninput = (e) => {
      const dim = el.getAttribute('data-plan-dim');
      const field = el.getAttribute('data-plan-field');
      if (!state.localActionPlan[dim]) {
        state.localActionPlan[dim] = { objetivo: '', acoes: '', prazo: '', status: 'Em andamento' };
      }
      state.localActionPlan[dim][field] = e.target.value;
    };
    el.onchange = el.oninput;
  });

  const toggleAllDimsPlan = document.getElementById('btn-toggle-all-dims-plan');
  if (toggleAllDimsPlan) {
    toggleAllDimsPlan.onclick = () => {
      state.showAllDimsInPlan = !state.showAllDimsInPlan;
      render();
    };
  }

  const enableAllEmpty = document.getElementById('btn-enable-all-dims-empty');
  if (enableAllEmpty) {
    enableAllEmpty.onclick = () => {
      state.showAllDimsInPlan = true;
      render();
    };
  }

  const savePlanHandler = async () => {
    const isComp = state.activeModule === 'competencias';
    const planEndpoint = isComp ? '/api/competencias/action-plan' : '/api/questionnaire/action-plan';
    try {
      const res = await apiFetch(planEndpoint, {
        method: 'POST',
        body: JSON.stringify({ plano_acao: state.localActionPlan }),
      });
      state.localActionPlan = res.plano_acao || {};
      if (state.questionnaireData) {
        state.questionnaireData.plano_acao = state.localActionPlan;
      }
      showToast(res.message, 'success');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnSavePlanTop = document.getElementById('btn-save-action-plan-top');
  const btnSavePlanBot = document.getElementById('btn-save-action-plan-bottom');
  if (btnSavePlanTop) btnSavePlanTop.onclick = savePlanHandler;
  if (btnSavePlanBot) btnSavePlanBot.onclick = savePlanHandler;

  // Admin Class Report Controls
  const adminTurmaSel = document.getElementById('admin-turma-select');
  if (adminTurmaSel) {
    adminTurmaSel.onchange = async (e) => {
      state.selectedAdminTurma = e.target.value;
      await loadAdminReport();
      render();
    };
  }

  // Admin Excel Upload
  const uploadForm = document.getElementById('admin-upload-excel-form');
  if (uploadForm) {
    uploadForm.onsubmit = async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('excel-file-input');
      if (!fileInput.files || !fileInput.files[0]) {
        showToast('Selecione um arquivo Excel (.xlsx).', 'warning');
        return;
      }
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      try {
        const res = await apiFetch('/api/admin/upload-excel', {
          method: 'POST',
          body: formData,
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        await loadAdminReport();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // Admin Delete Turma
  document.querySelectorAll('[data-delete-turma]').forEach((btn) => {
    btn.onclick = async () => {
      const tid = btn.getAttribute('data-delete-turma');
      const tname = btn.getAttribute('data-turma-name');
      if (
        !window.confirm(
          `Tem certeza que deseja DELETAR a turma "${tname}" e todos os alunos vinculados a ela? Esta ação não pode ser desfeita.`
        )
      ) {
        return;
      }
      try {
        const res = await apiFetch(`/api/admin/turmas/${tid}`, { method: 'DELETE' });
        showToast(res.message, 'success');
        state.selectedAdminTurma = 'all';
        state.adminUserTurmaFilter = 'all';
        await loadAdminTurmasAndUsers();
        await loadAdminReport();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Admin Add Student Form
  const addUserForm = document.getElementById('admin-add-user-form');
  if (addUserForm) {
    addUserForm.onsubmit = async (e) => {
      e.preventDefault();
      const nome = document.getElementById('add-user-nome').value.trim();
      const email = document.getElementById('add-user-email').value.trim();
      const ra = document.getElementById('add-user-ra').value.trim();
      const cod_turma = document.getElementById('add-user-turma').value.trim();
      const nome_curso = document.getElementById('add-user-curso').value.trim();
      try {
        const res = await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ nome, email, ra, cod_turma, nome_curso, autorizado: true }),
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // Admin Filter Users by Turma / Search
  const userTurmaFilter = document.getElementById('admin-users-turma-filter');
  if (userTurmaFilter) {
    userTurmaFilter.onchange = async (e) => {
      state.adminUserTurmaFilter = e.target.value;
      await loadAdminTurmasAndUsers();
      render();
    };
  }

  const userSearchInput = document.getElementById('admin-users-search');
  if (userSearchInput) {
    userSearchInput.oninput = (e) => {
      state.adminUserSearch = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const newInput = document.getElementById('admin-users-search');
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(pos, pos);
      }
    };
  }

  // Authorize / Block Student
  document.querySelectorAll('[data-toggle-auth]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-toggle-auth');
      const cur = btn.getAttribute('data-current-auth') === '1';
      try {
        const res = await apiFetch(`/api/admin/users/${uid}/authorize`, {
          method: 'PATCH',
          body: JSON.stringify({ autorizado: !cur }),
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Reset Student Password to 123456
  document.querySelectorAll('[data-reset-pw]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-reset-pw');
      try {
        const res = await apiFetch(`/api/admin/users/${uid}/reset-password`, {
          method: 'POST',
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Reset Student Saúde Integral Responses
  document.querySelectorAll('[data-reset-assessment]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-reset-assessment');
      const uname = btn.getAttribute('data-user-name');
      if (
        !window.confirm(
          `Deseja realmente RESETAR todas as respostas da Roda da Saúde Integral, histórico e plano de ação de "${uname}"?`
        )
      ) {
        return;
      }
      try {
        const res = await apiFetch(`/api/admin/users/${uid}/reset-assessment`, {
          method: 'POST',
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        await loadAdminReport();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Reset Student Roda de Competências Responses
  document.querySelectorAll('[data-reset-competencias]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-reset-competencias');
      const uname = btn.getAttribute('data-user-name');
      if (
        !window.confirm(
          `Deseja realmente RESETAR todas as respostas da Roda de Liderança e Competências, histórico das 4 aplicações e plano de ação de "${uname}"?`
        )
      ) {
        return;
      }
      try {
        const res = await apiFetch(`/api/admin/users/${uid}/reset-competencias`, {
          method: 'POST',
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        await loadAdminReport();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  // Delete Student
  document.querySelectorAll('[data-delete-user]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-delete-user');
      const uname = btn.getAttribute('data-user-name');
      if (
        !window.confirm(`Tem certeza que deseja DELETAR o(a) aluno(a) "${uname}" permanentemente?`)
      ) {
        return;
      }
      try {
        const res = await apiFetch(`/api/admin/users/${uid}`, {
          method: 'DELETE',
        });
        showToast(res.message, 'success');
        await loadAdminTurmasAndUsers();
        await loadAdminReport();
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });
}

// ----------------------------------------------------------------------------
// 11. Chart.js Renderers (Radar with Previous Wheel Shadow & Eletrovitae)
// ----------------------------------------------------------------------------
function initChartsIfNeeded() {
  if (state.activeTab === 'resultados' && state.questionnaireData?.resultados) {
    const { roda_radar, eletrovitae, itens } = state.questionnaireData.resultados;
    const prevAval = state.questionnaireData.avaliacao_anterior;
    const curDate = state.questionnaireData.data_avaliacao;

    const radarCanvas = document.getElementById('chart-personal-radar');
    if (radarCanvas) {
      chartInstances.personalRadar = createRodaRadarChart(
        radarCanvas,
        roda_radar,
        prevAval ? prevAval.roda_radar : null,
        curDate,
        prevAval ? prevAval.data_avaliacao : null
      );
    }
    const eletroCanvas = document.getElementById('chart-personal-eletrovitae');
    if (eletroCanvas) {
      chartInstances.personalEletrovitae = createEletrovitaeChart(eletroCanvas, eletrovitae, itens);
    }
  }

  if (state.activeTab === 'admin_relatorio' && state.adminReport) {
    const { roda_radar, eletrovitae, relatorio_itens } = state.adminReport;
    const adminRadarCanvas = document.getElementById('chart-admin-radar');
    if (adminRadarCanvas) {
      chartInstances.adminRadar = createRodaRadarChart(adminRadarCanvas, roda_radar, null, null, null);
    }
    const adminEletroCanvas = document.getElementById('chart-admin-eletrovitae');
    if (adminEletroCanvas) {
      chartInstances.adminEletrovitae = createEletrovitaeChart(
        adminEletroCanvas,
        eletrovitae,
        relatorio_itens
      );
    }
  }
}

function createRodaRadarChart(canvas, radarData, prevRadarData = null, curDateLabel = null, prevDateLabel = null) {
  const datasets = [
    {
      label: curDateLabel ? `Roda Atual (${curDateLabel})` : 'Média Atual',
      data: radarData.values,
      backgroundColor: 'rgba(44, 107, 146, 0.25)',
      borderColor: '#2C6B92',
      pointBackgroundColor: '#2C6B92',
      pointBorderColor: '#ffffff',
      pointHoverBackgroundColor: '#253B53',
      borderWidth: 3,
      pointRadius: 4.5,
      spanGaps: false,
      order: 1, // Drawn on top
    },
  ];

  if (prevRadarData && Array.isArray(prevRadarData.values)) {
    datasets.push({
      label: prevDateLabel ? `Última Roda - Sombreado (${prevDateLabel})` : 'Última Roda (Anterior)',
      data: prevRadarData.values,
      backgroundColor: 'rgba(100, 116, 139, 0.28)', // Shaded background shadow
      borderColor: 'rgba(71, 85, 105, 0.65)',
      borderDash: [4, 3],
      pointBackgroundColor: 'rgba(100, 116, 139, 0.8)',
      pointBorderColor: '#ffffff',
      borderWidth: 2,
      pointRadius: 3,
      spanGaps: false,
      order: 2, // Drawn behind current wheel
    });
  }

  datasets.push({
    label: 'Referência 6',
    data: radarData.referencia_6,
    backgroundColor: 'transparent',
    borderColor: '#B58428',
    borderDash: [5, 5],
    pointRadius: 0,
    borderWidth: 1.8,
    order: 3,
  });

  return new Chart(canvas, {
    type: 'radar',
    data: {
      labels: radarData.labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            backdropColor: 'rgba(255,255,255,0.85)',
            color: '#475569',
            font: { size: 10, weight: '600' },
          },
          pointLabels: {
            color: '#253B53',
            font: { size: 12, weight: '700' },
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.35)',
          },
          angleLines: {
            color: 'rgba(148, 163, 184, 0.35)',
          },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 11, weight: '600' },
          },
        },
      },
    },
  });
}

function createEletrovitaeChart(canvas, eletroData, itemsDetail) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: eletroData.labels,
      datasets: [
        {
          label: 'Nota',
          data: eletroData.values,
          borderColor: '#2C6B92',
          backgroundColor: 'rgba(44, 107, 146, 0.12)',
          pointBackgroundColor: (ctx) => {
            const v = ctx.raw;
            if (v === null || v === undefined) return 'transparent';
            return v <= 6 ? '#B58428' : '#2C6B92';
          },
          pointBorderColor: '#ffffff',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2.3,
          tension: 0.15,
          spanGaps: false,
        },
        {
          label: 'Referência 6',
          data: eletroData.referencia_6,
          borderColor: '#B58428',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        y: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 1,
            color: '#334155',
            font: { size: 11, weight: '600' },
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.25)',
          },
        },
        x: {
          ticks: {
            callback: function (val, index) {
              if (index === 0 || (index + 1) % 5 === 0) {
                return this.getLabelForValue(val);
              }
              return '';
            },
            autoSkip: false,
            maxRotation: 35,
            minRotation: 25,
            color: '#253B53',
            font: { size: 10, weight: '600' },
          },
          grid: {
            color: (ctx) =>
              (ctx.index + 1) % 5 === 0 ? 'rgba(37, 59, 83, 0.22)' : 'rgba(148, 163, 184, 0.12)',
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            afterBody: function (context) {
              const idx = context[0]?.dataIndex;
              if (idx !== undefined && itemsDetail && itemsDetail[idx]) {
                const it = itemsDetail[idx];
                return [`Dimensão: ${it.dimensao}`, `Pergunta: ${it.pergunta}`];
              }
              return [];
            },
          },
        },
      },
    },
  });
}

document.addEventListener('DOMContentLoaded', initApp);
