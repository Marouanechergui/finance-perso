// ============================================================
//  Finance Perso — Application principale
// ============================================================

const state = {
  user: null,
  token: null,
  charges: [],
  revenus: [],
  credit: [],
  view: 'dashboard',
  month: new Date().toISOString().slice(0, 7), // YYYY-MM
  chargesChart: null,
  creditChart: null
};

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

// ------------------------------------------------------------
//  INITIALISATION
// ------------------------------------------------------------

window.addEventListener('load', () => {
  // Attendre que les SDK Google soient chargés
  waitForGoogle();
});

function waitForGoogle() {
  if (typeof gapi !== 'undefined' && typeof google !== 'undefined' && google.accounts) {
    initGapi();
    initGis();
  } else {
    setTimeout(waitForGoogle, 100);
  }
}

function initGapi() {
  gapi.load('client', async () => {
    await gapi.client.init({ discoveryDocs: [CONFIG.DISCOVERY_DOC] });
    gapiInited = true;
    maybeShowLogin();
  });
}

function initGis() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: handleAuthResponse
  });
  gisInited = true;
  maybeShowLogin();
}

function maybeShowLogin() {
  if (gapiInited && gisInited) {
    show('login-view');
    hide('loading-view');
  }
}

// ------------------------------------------------------------
//  AUTHENTIFICATION
// ------------------------------------------------------------

document.getElementById('signin-btn').addEventListener('click', () => {
  tokenClient.requestAccessToken({ prompt: 'consent' });
});

document.getElementById('signout-btn').addEventListener('click', signout);
document.getElementById('signout-denied-btn').addEventListener('click', signout);

async function handleAuthResponse(resp) {
  if (resp.error) {
    toast('Erreur de connexion : ' + resp.error, 'error');
    return;
  }
  state.token = resp.access_token;
  gapi.client.setToken({ access_token: resp.access_token });

  // Récupérer l'email de l'utilisateur
  try {
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + resp.access_token }
    }).then(r => r.json());

    state.user = userInfo.email;

    // Vérifier la whitelist (uniquement si elle est non vide)
    if (CONFIG.ALLOWED_EMAILS.length > 0) {
      const allowed = CONFIG.ALLOWED_EMAILS.map(e => e.toLowerCase());
      if (!allowed.includes(userInfo.email.toLowerCase())) {
        hide('login-view');
        show('denied-view');
        return;
      }
    }

    document.getElementById('user-email').textContent = userInfo.email;
    hide('login-view');
    show('app-view');
    document.getElementById('month-input').value = state.month;
    await loadAllData();
  } catch (err) {
    toast('Erreur : ' + err.message, 'error');
  }
}

function signout() {
  if (state.token) {
    google.accounts.oauth2.revoke(state.token, () => {});
  }
  state.token = null;
  state.user = null;
  gapi.client.setToken(null);
  hide('app-view');
  hide('denied-view');
  show('login-view');
}

// ------------------------------------------------------------
//  GOOGLE SHEETS API
// ------------------------------------------------------------

async function readSheet(sheetName) {
  try {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${sheetName}!A2:Z`
    });
    return res.result.values || [];
  } catch (err) {
    handleApiError(err, `lecture de l'onglet "${sheetName}"`);
    return [];
  }
}

async function appendRow(sheetName, values) {
  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [values] }
    });
    return true;
  } catch (err) {
    handleApiError(err, `ajout dans "${sheetName}"`);
    return false;
  }
}

async function deleteRow(sheetName, rowIndex) {
  // rowIndex = index 0-based dans state.<sheet>, donc ligne réelle = rowIndex + 2 (entête en ligne 1)
  try {
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: CONFIG.SHEET_ID });
    const sheet = meta.result.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Onglet "${sheetName}" introuvable`);

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.SHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex + 1,
              endIndex: rowIndex + 2
            }
          }
        }]
      }
    });
    return true;
  } catch (err) {
    handleApiError(err, 'suppression de la ligne');
    return false;
  }
}

function handleApiError(err, context) {
  console.error(err);
  const msg = err.result?.error?.message || err.message || 'Erreur inconnue';
  if (msg.includes('403') || err.status === 403) {
    toast(`Accès refusé à la Sheet. Vérifie qu'elle est partagée avec ton compte.`, 'error');
  } else if (msg.includes('404') || err.status === 404) {
    toast(`Sheet ou onglet introuvable. Vérifie le SHEET_ID et le nom des onglets.`, 'error');
  } else if (err.status === 401) {
    toast('Session expirée, reconnecte-toi.', 'error');
    signout();
  } else {
    toast(`Erreur (${context}) : ${msg}`, 'error');
  }
}

// ------------------------------------------------------------
//  CHARGEMENT DES DONNÉES
// ------------------------------------------------------------

async function loadAllData() {
  const [charges, revenus, credit] = await Promise.all([
    readSheet(CONFIG.SHEETS.CHARGES),
    readSheet(CONFIG.SHEETS.REVENUS),
    readSheet(CONFIG.SHEETS.CREDIT)
  ]);

  state.charges = charges.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    libelle: r[1] || '',
    categorie: r[2] || '',
    montant: parseFloat(r[3]) || 0,
    paye_par: r[4] || ''
  }));

  state.revenus = revenus.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    libelle: r[1] || '',
    montant: parseFloat(r[2]) || 0,
    percu_par: r[3] || ''
  }));

  state.credit = credit.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    rembourse: parseFloat(r[1]) || 0,
    restant: parseFloat(r[2]) || 0,
    commentaire: r[3] || ''
  }));

  renderAll();
}

// ------------------------------------------------------------
//  RENDU
// ------------------------------------------------------------

function renderAll() {
  renderDashboard();
  renderCharges();
  renderRevenus();
  renderCredit();
  refreshDatalists();
}

function refreshDatalists() {
  const categories = [...new Set(state.charges.map(c => c.categorie).filter(Boolean))];
  document.getElementById('categories-list').innerHTML =
    categories.map(c => `<option value="${escapeHtml(c)}">`).join('');

  const users = [...new Set([
    ...state.charges.map(c => c.paye_par),
    ...state.revenus.map(r => r.percu_par)
  ].filter(Boolean))];
  document.getElementById('users-list').innerHTML =
    users.map(u => `<option value="${escapeHtml(u)}">`).join('');
}

// ---------- DASHBOARD ----------

function renderDashboard() {
  const chargesMois = state.charges.filter(c => c.date.startsWith(state.month));
  const revenusMois = state.revenus.filter(r => r.date.startsWith(state.month));

  const totalCharges = chargesMois.reduce((s, c) => s + c.montant, 0);
  const totalRevenus = revenusMois.reduce((s, r) => s + r.montant, 0);
  const epargne = totalRevenus - totalCharges;

  document.getElementById('card-charges').textContent = fmtMoney(totalCharges);
  document.getElementById('card-revenus').textContent = fmtMoney(totalRevenus);
  const epargneEl = document.getElementById('card-epargne');
  epargneEl.textContent = fmtMoney(epargne);
  epargneEl.className = 'text-2xl font-bold ' + (epargne >= 0 ? 'text-emerald-600' : 'text-rose-600');

  // Pie chart charges
  const byCategorie = {};
  chargesMois.forEach(c => {
    byCategorie[c.categorie || 'Sans catégorie'] = (byCategorie[c.categorie || 'Sans catégorie'] || 0) + c.montant;
  });

  const labels = Object.keys(byCategorie);
  const data = Object.values(byCategorie);

  if (state.chargesChart) state.chargesChart.destroy();

  if (labels.length === 0) {
    document.getElementById('no-charges-msg').classList.remove('hidden');
  } else {
    document.getElementById('no-charges-msg').classList.add('hidden');
    state.chargesChart = new Chart(document.getElementById('charges-chart'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: ['#6366f1','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444','#8b5cf6','#14b8a6','#f97316','#84cc16']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label} : ${fmtMoney(ctx.parsed)}` } }
        }
      }
    });
  }

  // Crédit restant (dernière entrée)
  const lastCredit = state.credit.length ? state.credit[state.credit.length - 1] : null;
  document.getElementById('card-credit').textContent = lastCredit ? fmtMoney(lastCredit.restant) : '— €';
  document.getElementById('card-credit-date').textContent = lastCredit ? `Maj : ${fmtDate(lastCredit.date)}` : 'Aucune donnée';

  // Derniers mouvements (5)
  const all = [
    ...state.charges.map(c => ({ ...c, type: 'charge' })),
    ...state.revenus.map(r => ({ ...r, type: 'revenu' }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  document.getElementById('recent-list').innerHTML = all.length === 0
    ? '<li class="py-2 text-slate-400 text-center">Aucun mouvement</li>'
    : all.map(m => `
      <li class="py-2 flex justify-between items-center">
        <div>
          <p class="text-slate-700">${escapeHtml(m.libelle)}</p>
          <p class="text-xs text-slate-400">${fmtDate(m.date)}</p>
        </div>
        <span class="${m.type === 'charge' ? 'text-rose-600' : 'text-emerald-600'} font-semibold">
          ${m.type === 'charge' ? '-' : '+'}${fmtMoney(m.montant)}
        </span>
      </li>`).join('');
}

// ---------- CHARGES ----------

function renderCharges() {
  const chargesMois = state.charges
    .filter(c => c.date.startsWith(state.month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = chargesMois.reduce((s, c) => s + c.montant, 0);
  document.getElementById('charges-total').textContent = fmtMoney(total);

  const tbody = document.getElementById('charges-tbody');
  tbody.innerHTML = chargesMois.length === 0
    ? `<tr><td colspan="6" class="text-center py-6 text-slate-400">Aucune charge sur ce mois</td></tr>`
    : chargesMois.map(c => `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-2 text-slate-600">${fmtDate(c.date)}</td>
        <td class="px-4 py-2">${escapeHtml(c.libelle)}</td>
        <td class="px-4 py-2"><span class="inline-block bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded">${escapeHtml(c.categorie)}</span></td>
        <td class="px-4 py-2 text-right font-semibold text-rose-600">${fmtMoney(c.montant)}</td>
        <td class="px-4 py-2 text-slate-600">${escapeHtml(c.paye_par)}</td>
        <td class="px-4 py-2 text-right">
          <button data-delete-charge="${c._rowIndex}" title="Supprimer cette charge" class="inline-flex items-center gap-1 px-2 py-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded border border-transparent hover:border-rose-200 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            <span class="text-xs font-medium hidden sm:inline">Supprimer</span>
          </button>
        </td>
      </tr>`).join('');
}

// ---------- REVENUS ----------

function renderRevenus() {
  const revenusMois = state.revenus
    .filter(r => r.date.startsWith(state.month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = revenusMois.reduce((s, r) => s + r.montant, 0);
  document.getElementById('revenus-total').textContent = fmtMoney(total);

  const tbody = document.getElementById('revenus-tbody');
  tbody.innerHTML = revenusMois.length === 0
    ? `<tr><td colspan="5" class="text-center py-6 text-slate-400">Aucun revenu sur ce mois</td></tr>`
    : revenusMois.map(r => `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-2 text-slate-600">${fmtDate(r.date)}</td>
        <td class="px-4 py-2">${escapeHtml(r.libelle)}</td>
        <td class="px-4 py-2 text-right font-semibold text-emerald-600">${fmtMoney(r.montant)}</td>
        <td class="px-4 py-2 text-slate-600">${escapeHtml(r.percu_par)}</td>
        <td class="px-4 py-2 text-right">
          <button data-delete-revenu="${r._rowIndex}" title="Supprimer ce revenu" class="inline-flex items-center gap-1 px-2 py-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded border border-transparent hover:border-rose-200 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            <span class="text-xs font-medium hidden sm:inline">Supprimer</span>
          </button>
        </td>
      </tr>`).join('');
}

// ---------- CREDIT ----------

function renderCredit() {
  const sorted = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.length ? sorted[sorted.length - 1] : null;

  document.getElementById('credit-current').textContent = last ? fmtMoney(last.restant) : '— €';
  document.getElementById('credit-current-date').textContent = last ? `Dernière maj : ${fmtDate(last.date)}` : 'Aucune donnée';

  const tbody = document.getElementById('credit-tbody');
  const displaySorted = [...state.credit].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = displaySorted.length === 0
    ? `<tr><td colspan="5" class="text-center py-6 text-slate-400">Aucun remboursement enregistré</td></tr>`
    : displaySorted.map(c => `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-2 text-slate-600">${fmtDate(c.date)}</td>
        <td class="px-4 py-2 text-right text-emerald-600 font-semibold">-${fmtMoney(c.rembourse)}</td>
        <td class="px-4 py-2 text-right text-indigo-600 font-bold">${fmtMoney(c.restant)}</td>
        <td class="px-4 py-2 text-slate-600">${escapeHtml(c.commentaire)}</td>
        <td class="px-4 py-2 text-right">
          <button data-delete-credit="${c._rowIndex}" title="Supprimer cette entrée" class="inline-flex items-center gap-1 px-2 py-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded border border-transparent hover:border-rose-200 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            <span class="text-xs font-medium hidden sm:inline">Supprimer</span>
          </button>
        </td>
      </tr>`).join('');

  // Chart évolution
  if (state.creditChart) state.creditChart.destroy();
  if (sorted.length === 0) {
    document.getElementById('no-credit-msg').classList.remove('hidden');
  } else {
    document.getElementById('no-credit-msg').classList.add('hidden');
    state.creditChart = new Chart(document.getElementById('credit-chart'), {
      type: 'line',
      data: {
        labels: sorted.map(c => fmtDate(c.date)),
        datasets: [{
          label: 'Reste à devoir',
          data: sorted.map(c => c.restant),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } } }
      }
    });
  }
}

// ------------------------------------------------------------
//  ÉVÉNEMENTS UI
// ------------------------------------------------------------

// Onglets
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    state.view = tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('border-indigo-600', 'text-indigo-600');
      b.classList.add('border-transparent', 'text-slate-600');
    });
    btn.classList.add('border-indigo-600', 'text-indigo-600');
    btn.classList.remove('border-transparent', 'text-slate-600');

    document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(tab + '-view').classList.remove('hidden');

    // Le sélecteur de mois n'est pas pertinent pour l'onglet Crédit
    document.getElementById('month-selector').style.display = tab === 'credit' ? 'none' : '';
  });
});

// Sélecteur de mois
document.getElementById('month-input').addEventListener('change', e => {
  state.month = e.target.value;
  renderDashboard();
  renderCharges();
  renderRevenus();
});

// Rafraîchir
document.getElementById('refresh-btn').addEventListener('click', async () => {
  toast('Rafraîchissement...');
  await loadAllData();
  toast('Données à jour ✓', 'success');
});

// Formulaire Charge
document.getElementById('charge-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ok = await appendRow(CONFIG.SHEETS.CHARGES, [
    fd.get('date'),
    fd.get('libelle'),
    fd.get('categorie'),
    fd.get('montant'),
    fd.get('paye_par') || ''
  ]);
  if (ok) {
    e.target.reset();
    toast('Charge ajoutée ✓', 'success');
    await loadAllData();
  }
});

// Formulaire Revenu
document.getElementById('revenu-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ok = await appendRow(CONFIG.SHEETS.REVENUS, [
    fd.get('date'),
    fd.get('libelle'),
    fd.get('montant'),
    fd.get('percu_par') || ''
  ]);
  if (ok) {
    e.target.reset();
    toast('Revenu ajouté ✓', 'success');
    await loadAllData();
  }
});

// Formulaire Crédit
document.getElementById('credit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ok = await appendRow(CONFIG.SHEETS.CREDIT, [
    fd.get('date'),
    fd.get('rembourse'),
    fd.get('restant'),
    fd.get('commentaire') || ''
  ]);
  if (ok) {
    e.target.reset();
    toast('Remboursement ajouté ✓', 'success');
    await loadAllData();
  }
});

// Suppressions (délégation)
document.body.addEventListener('click', async e => {
  const charge = e.target.closest('[data-delete-charge]');
  const revenu = e.target.closest('[data-delete-revenu]');
  const credit = e.target.closest('[data-delete-credit]');

  if (charge) {
    if (!confirm('Supprimer cette charge ?')) return;
    if (await deleteRow(CONFIG.SHEETS.CHARGES, +charge.dataset.deleteCharge)) {
      toast('Charge supprimée', 'success');
      await loadAllData();
    }
  } else if (revenu) {
    if (!confirm('Supprimer ce revenu ?')) return;
    if (await deleteRow(CONFIG.SHEETS.REVENUS, +revenu.dataset.deleteRevenu)) {
      toast('Revenu supprimé', 'success');
      await loadAllData();
    }
  } else if (credit) {
    if (!confirm('Supprimer cette entrée de crédit ?')) return;
    if (await deleteRow(CONFIG.SHEETS.CREDIT, +credit.dataset.deleteCredit)) {
      toast('Entrée supprimée', 'success');
      await loadAllData();
    }
  }
});

// ------------------------------------------------------------
//  UTILITAIRES
// ------------------------------------------------------------

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function fmtMoney(n) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm z-50 ' + ({
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-slate-800 text-white'
  }[type] || 'bg-slate-800 text-white');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
