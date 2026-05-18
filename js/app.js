// ============================================================
//  Finance Perso — Application
// ============================================================

const state = {
  user: null,
  token: null,
  charges: [],
  revenus: [],
  credit: [],
  epargne: [],
  view: 'dashboard',
  month: new Date().toISOString().slice(0, 7), // YYYY-MM
  chargesChart: null,
  creditChart: null,
  forecastChart: null
};

const PAGE_META = {
  dashboard:  { title: 'Dashboard',  subtitle: 'Vue d\'ensemble de vos finances',  showMonth: true  },
  charges:    { title: 'Charges',    subtitle: 'Suivi des dépenses du mois',       showMonth: true  },
  revenus:    { title: 'Revenus',    subtitle: 'Suivi des entrées d\'argent',      showMonth: true  },
  credit:     { title: 'Crédit',     subtitle: 'Suivi du remboursement',            showMonth: false },
  previsions: { title: 'Prévisions', subtitle: 'Projection de l\'épargne future',  showMonth: false }
};

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

// ------------------------------------------------------------
//  INIT
// ------------------------------------------------------------

window.addEventListener('load', waitForGoogle);

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
//  AUTH
// ------------------------------------------------------------

document.getElementById('signin-btn').addEventListener('click', () => {
  tokenClient.requestAccessToken({ prompt: 'consent' });
});

['signout-btn', 'signout-btn-mobile', 'signout-denied-btn'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', signout);
});

async function handleAuthResponse(resp) {
  if (resp.error) {
    toast('Erreur de connexion : ' + resp.error, 'error');
    return;
  }
  state.token = resp.access_token;
  gapi.client.setToken({ access_token: resp.access_token });

  try {
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + resp.access_token }
    }).then(r => r.json());

    state.user = userInfo.email;

    if (CONFIG.ALLOWED_EMAILS.length > 0) {
      const allowed = CONFIG.ALLOWED_EMAILS.map(e => e.toLowerCase());
      if (!allowed.includes(userInfo.email.toLowerCase())) {
        hide('login-view');
        show('denied-view');
        return;
      }
    }

    document.getElementById('user-email').textContent = userInfo.email;
    document.getElementById('user-avatar').textContent = (userInfo.email[0] || '?').toUpperCase();
    hide('login-view');
    show('app-view');
    syncMonthInputs(state.month);
    document.getElementById('forecast-target').value = addMonthsToYearMonth(state.month, 12);
    await ensureHeaders();
    await loadAllData();
  } catch (err) {
    toast('Erreur : ' + err.message, 'error');
  }
}

function signout() {
  if (state.token) google.accounts.oauth2.revoke(state.token, () => {});
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
    handleApiError(err, `lecture "${sheetName}"`);
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

async function ensureHeaders() {
  try {
    // 1. Vérifier l'existence de toutes les feuilles attendues
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: CONFIG.SHEET_ID });
    const existing = meta.result.sheets.map(s => s.properties.title);

    // 2. Créer la feuille Epargne si elle n'existe pas
    if (!existing.includes(CONFIG.SHEETS.EPARGNE)) {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: CONFIG.SHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: CONFIG.SHEETS.EPARGNE } } }] }
      });
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.SHEET_ID,
        range: `${CONFIG.SHEETS.EPARGNE}!A1:C1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Date', 'Montant', 'Commentaire']] }
      });
    }

    // 3. Vérifier les en-têtes Statut sur Charges et Revenus
    const res = await gapi.client.sheets.spreadsheets.values.batchGet({
      spreadsheetId: CONFIG.SHEET_ID,
      ranges: [`${CONFIG.SHEETS.CHARGES}!A1:F1`, `${CONFIG.SHEETS.REVENUS}!A1:E1`]
    });
    const chargesH = (res.result.valueRanges?.[0]?.values?.[0]) || [];
    const revenusH = (res.result.valueRanges?.[1]?.values?.[0]) || [];

    const tasks = [];
    if (String(chargesH[5] || '').toLowerCase() !== 'statut') {
      tasks.push(gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.SHEET_ID,
        range: `${CONFIG.SHEETS.CHARGES}!F1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Statut']] }
      }));
    }
    if (String(revenusH[4] || '').toLowerCase() !== 'statut') {
      tasks.push(gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.SHEET_ID,
        range: `${CONFIG.SHEETS.REVENUS}!E1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Statut']] }
      }));
    }
    await Promise.all(tasks);
  } catch (err) {
    console.warn('ensureHeaders failed (non bloquant):', err);
  }
}

async function updateCell(sheetName, rowIndex, colLetter, value) {
  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${sheetName}!${colLetter}${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[value]] }
    });
    return true;
  } catch (err) {
    handleApiError(err, `update ${colLetter}${rowIndex + 2}`);
    return false;
  }
}

// Met à jour une ligne entière (toutes les colonnes en une fois)
async function updateRow(sheetName, rowIndex, values) {
  try {
    const endCol = String.fromCharCode(64 + values.length); // 1=A, 2=B, ...
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${sheetName}!A${rowIndex + 2}:${endCol}${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] }
    });
    return true;
  } catch (err) {
    handleApiError(err, `update row ${rowIndex + 2}`);
    return false;
  }
}

async function deleteRow(sheetName, rowIndex) {
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
    handleApiError(err, 'suppression');
    return false;
  }
}

function handleApiError(err, context) {
  console.error(err);
  const msg = err.result?.error?.message || err.message || 'Erreur inconnue';
  if (msg.includes('403') || err.status === 403)      toast('Accès refusé à la Sheet.', 'error');
  else if (msg.includes('404') || err.status === 404) toast('Sheet ou onglet introuvable.', 'error');
  else if (err.status === 401)                        { toast('Session expirée.', 'error'); signout(); }
  else                                                 toast(`Erreur (${context}) : ${msg}`, 'error');
}

// ------------------------------------------------------------
//  LOAD DATA
// ------------------------------------------------------------

function normalizeStatut(s) {
  return String(s || '').trim().toLowerCase() === 'fixe' ? 'Fixe' : 'Variable';
}

async function loadAllData() {
  const [charges, revenus, credit, epargne] = await Promise.all([
    readSheet(CONFIG.SHEETS.CHARGES),
    readSheet(CONFIG.SHEETS.REVENUS),
    readSheet(CONFIG.SHEETS.CREDIT),
    readSheet(CONFIG.SHEETS.EPARGNE)
  ]);

  state.epargne = epargne.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    montant: parseFloat(r[1]) || 0,
    commentaire: r[2] || ''
  }));

  state.charges = charges.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    libelle: r[1] || '',
    categorie: r[2] || '',
    montant: parseFloat(r[3]) || 0,
    paye_par: r[4] || '',
    statut: normalizeStatut(r[5])
  }));

  state.revenus = revenus.map((r, i) => ({
    _rowIndex: i,
    date: r[0] || '',
    libelle: r[1] || '',
    montant: parseFloat(r[2]) || 0,
    percu_par: r[3] || '',
    statut: normalizeStatut(r[4])
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

function isInMonth(entry, month) {
  if (!entry.date) return false;
  if (entry.statut === 'Fixe') return entry.date.slice(0, 7) <= month;
  return entry.date.startsWith(month);
}

// Calcule l'épargne totale à fin du mois donné :
//   baseline (dernière entrée Epargne)
// + cumul des nets mensuels (revenus - charges) du 1er mois de données jusqu'à `month`
// − somme des remboursements crédit jusqu'à `month`
function calculateEpargneTotal(month) {
  const epSorted = [...state.epargne].sort((a, b) => a.date.localeCompare(b.date));
  const last = epSorted[epSorted.length - 1];
  const baseline = last ? last.montant : 0;

  const allDates = [
    ...state.charges.map(c => c.date),
    ...state.revenus.map(r => r.date)
  ].filter(Boolean).sort();

  let cumul = 0;
  if (allDates.length > 0) {
    const firstMonth = allDates[0].slice(0, 7);
    if (firstMonth <= month) {
      const months = listMonthsBetween(firstMonth, month);
      months.forEach(m => {
        const ch = state.charges.filter(c => isInMonth(c, m)).reduce((s, c) => s + c.montant, 0);
        const re = state.revenus.filter(r => isInMonth(r, m)).reduce((s, r) => s + r.montant, 0);
        cumul += (re - ch);
      });
    }
  }

  // Remboursements crédit dont la date est <= mois sélectionné (on exclut le solde initial où rembourse=0)
  const creditPayments = state.credit
    .filter(c => c.date && c.rembourse > 0 && c.date.slice(0, 7) <= month)
    .reduce((s, c) => s + c.rembourse, 0);

  return baseline + cumul - creditPayments;
}

// Moyenne mensuelle de remboursement crédit (pour les projections futures)
function getAvgMonthlyRepayment() {
  const sorted = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const repayments = sorted.filter(c => c.rembourse > 0).map(c => c.rembourse);
  if (!repayments.length) return 0;
  return repayments.reduce((s, x) => s + x, 0) / repayments.length;
}

// ------------------------------------------------------------
//  RENDER
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
  const chargesMois = state.charges.filter(c => isInMonth(c, state.month));
  const revenusMois = state.revenus.filter(r => isInMonth(r, state.month));

  const totalCharges = chargesMois.reduce((s, c) => s + c.montant, 0);
  const totalRevenus = revenusMois.reduce((s, r) => s + r.montant, 0);
  const epargne = totalRevenus - totalCharges;

  document.getElementById('card-charges').textContent = fmtMoney(totalCharges);
  document.getElementById('card-revenus').textContent = fmtMoney(totalRevenus);
  document.getElementById('card-epargne').textContent = fmtMoney(epargne);

  // ÉPARGNE TOTALE = baseline (saisie page Crédit) + cumul des nets mensuels jusqu'au mois sélectionné
  const epargneTotale = calculateEpargneTotal(state.month);
  document.getElementById('card-epargne-totale').textContent = fmtMoney(epargneTotale);

  // Info sous le montant : montre la baseline manuelle
  const epSorted = [...state.epargne].sort((a, b) => a.date.localeCompare(b.date));
  const epLast = epSorted[epSorted.length - 1];
  const baseline = epLast ? epLast.montant : 0;
  const infoEl = document.getElementById('card-epargne-totale-info');
  if (epLast) {
    infoEl.textContent = `Base ${fmtMoney(baseline)} + cumul`;
  } else {
    infoEl.textContent = 'Pas de base — saisir sur Crédit';
  }

  document.getElementById('month-label-dashboard').textContent = fmtMonth(state.month);

  // Pie chart
  const byCategorie = {};
  chargesMois.forEach(c => {
    const k = c.categorie || 'Sans catégorie';
    byCategorie[k] = (byCategorie[k] || 0) + c.montant;
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
        labels,
        datasets: [{
          data,
          backgroundColor: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'],
          borderWidth: 0,
          spacing: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11, family: 'Inter' } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label} : ${fmtMoney(ctx.parsed)}` } }
        }
      }
    });
  }

  // Crédit
  const sortedCredit = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const lastCredit = sortedCredit.length ? sortedCredit[sortedCredit.length - 1] : null;
  const firstCredit = sortedCredit.length ? sortedCredit[0] : null;

  document.getElementById('card-credit').textContent = lastCredit ? fmtMoney(lastCredit.restant) : '— €';
  document.getElementById('card-credit-date').textContent = lastCredit ? `Maj : ${fmtDate(lastCredit.date)}` : 'Aucune donnée';

  // Progress bar in dashboard card
  const progressEl = document.getElementById('credit-progress');
  if (firstCredit && firstCredit.restant > 0 && lastCredit) {
    const pct = Math.max(0, Math.min(100, (1 - lastCredit.restant / firstCredit.restant) * 100));
    progressEl.style.width = pct + '%';
  } else {
    progressEl.style.width = '0%';
  }

  // Derniers mouvements
  const all = [
    ...state.charges.map(c => ({ ...c, type: 'charge' })),
    ...state.revenus.map(r => ({ ...r, type: 'revenu' }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  document.getElementById('recent-list').innerHTML = all.length === 0
    ? '<li class="text-gray-400 text-xs text-center py-2">Aucun mouvement</li>'
    : all.map(m => `
      <li class="flex justify-between items-center">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.type === 'charge' ? 'bg-rose-50' : 'bg-emerald-50'}">
            <svg class="w-4 h-4 ${m.type === 'charge' ? 'text-rose-600' : 'text-emerald-600'}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              ${m.type === 'charge'
                ? '<path stroke-linecap="round" stroke-linejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12"/>'}
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(m.libelle)}</p>
            <p class="text-xs text-gray-400">${fmtDate(m.date)}</p>
          </div>
        </div>
        <span class="text-sm font-semibold flex-shrink-0 ml-2 ${m.type === 'charge' ? 'text-rose-600' : 'text-emerald-600'}">
          ${m.type === 'charge' ? '-' : '+'}${fmtMoney(m.montant)}
        </span>
      </li>`).join('');
}

// ---------- CHARGES ----------

function renderCharges() {
  const chargesMois = state.charges
    .filter(c => isInMonth(c, state.month))
    .sort((a, b) => b.date.localeCompare(a.date));

  document.getElementById('charges-total').textContent = fmtMoney(chargesMois.reduce((s, c) => s + c.montant, 0));

  const tbody = document.getElementById('charges-tbody');
  tbody.innerHTML = chargesMois.length === 0
    ? `<tr><td colspan="7" class="text-center py-12 text-gray-400 text-sm">Aucune charge sur ce mois</td></tr>`
    : chargesMois.map(c => `
      <tr class="hover:bg-gray-50 transition">
        <td class="px-6 py-3.5 text-gray-600 whitespace-nowrap">${fmtDate(c.date)}</td>
        <td class="px-6 py-3.5 font-medium text-gray-900">${escapeHtml(c.libelle)}</td>
        <td class="px-6 py-3.5"><span class="inline-block bg-rose-50 text-rose-700 text-xs px-2 py-0.5 rounded-md font-medium">${escapeHtml(c.categorie)}</span></td>
        <td class="px-6 py-3.5 text-right font-semibold text-rose-600 whitespace-nowrap">${fmtMoney(c.montant)}</td>
        <td class="px-6 py-3.5">${statutBadge(c.statut, c._rowIndex, 'charge')}</td>
        <td class="px-6 py-3.5 text-gray-600">${escapeHtml(c.paye_par)}</td>
        <td class="px-6 py-3.5 text-right">${rowActions('charge', c._rowIndex)}</td>
      </tr>`).join('');
}

// ---------- REVENUS ----------

function renderRevenus() {
  const revenusMois = state.revenus
    .filter(r => isInMonth(r, state.month))
    .sort((a, b) => b.date.localeCompare(a.date));

  document.getElementById('revenus-total').textContent = fmtMoney(revenusMois.reduce((s, r) => s + r.montant, 0));

  const tbody = document.getElementById('revenus-tbody');
  tbody.innerHTML = revenusMois.length === 0
    ? `<tr><td colspan="6" class="text-center py-12 text-gray-400 text-sm">Aucun revenu sur ce mois</td></tr>`
    : revenusMois.map(r => `
      <tr class="hover:bg-gray-50 transition">
        <td class="px-6 py-3.5 text-gray-600 whitespace-nowrap">${fmtDate(r.date)}</td>
        <td class="px-6 py-3.5 font-medium text-gray-900">${escapeHtml(r.libelle)}</td>
        <td class="px-6 py-3.5 text-right font-semibold text-emerald-600 whitespace-nowrap">${fmtMoney(r.montant)}</td>
        <td class="px-6 py-3.5">${statutBadge(r.statut, r._rowIndex, 'revenu')}</td>
        <td class="px-6 py-3.5 text-gray-600">${escapeHtml(r.percu_par)}</td>
        <td class="px-6 py-3.5 text-right">${rowActions('revenu', r._rowIndex)}</td>
      </tr>`).join('');
}

// ---------- CREDIT ----------

function renderCredit() {
  // -- ÉPARGNE
  const epSorted = [...state.epargne].sort((a, b) => a.date.localeCompare(b.date));
  const epLast = epSorted[epSorted.length - 1] || null;
  document.getElementById('epargne-current').textContent = epLast ? fmtMoney(epLast.montant) : '— €';
  document.getElementById('epargne-date').textContent = epLast
    ? `Mis à jour le ${fmtDate(epLast.date)}`
    : 'Aucune donnée — clique ✏️ pour saisir';

  // -- CRÉDIT
  const sorted = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0] || null;
  const last = sorted[sorted.length - 1] || null;

  // Mise à jour du preview du formulaire (montant restant calculé)
  updateCreditPreview();

  // Montant initial
  document.getElementById('credit-initial').textContent = first ? fmtMoney(first.restant) : '— €';
  document.getElementById('credit-initial-date').textContent = first
    ? `Solde de départ au ${fmtDate(first.date)}`
    : 'Cliquer ✏️ pour initialiser';

  const editBtn = document.getElementById('credit-edit-initial');
  if (first) {
    editBtn.dataset.rowIndex = first._rowIndex;
    editBtn.dataset.currentValue = first.restant;
  } else {
    delete editBtn.dataset.rowIndex;
    delete editBtn.dataset.currentValue;
  }

  // Montant restant
  document.getElementById('credit-current').textContent = last ? fmtMoney(last.restant) : '— €';
  document.getElementById('credit-current-date').textContent = last
    ? `Dernière maj : ${fmtDate(last.date)}`
    : 'Aucune donnée';

  // Progress %
  let pct = 0;
  if (first && first.restant > 0 && last) {
    pct = Math.max(0, Math.min(100, (1 - last.restant / first.restant) * 100));
  }
  document.getElementById('credit-percent').textContent = pct.toFixed(1) + '%';
  document.getElementById('credit-progress-bar').style.width = pct + '%';

  // Table
  const display = [...state.credit].sort((a, b) => b.date.localeCompare(a.date));
  const tbody = document.getElementById('credit-tbody');
  tbody.innerHTML = display.length === 0
    ? `<tr><td colspan="5" class="text-center py-12 text-gray-400 text-sm">Aucun remboursement</td></tr>`
    : display.map(c => `
      <tr class="hover:bg-gray-50 transition">
        <td class="px-6 py-3.5 text-gray-600 whitespace-nowrap">${fmtDate(c.date)}</td>
        <td class="px-6 py-3.5 text-right text-emerald-600 font-semibold whitespace-nowrap">-${fmtMoney(c.rembourse)}</td>
        <td class="px-6 py-3.5 text-right text-indigo-600 font-bold whitespace-nowrap">${fmtMoney(c.restant)}</td>
        <td class="px-6 py-3.5 text-gray-600">${escapeHtml(c.commentaire)}</td>
        <td class="px-6 py-3.5 text-right">${deleteBtn('credit', c._rowIndex)}</td>
      </tr>`).join('');

  // Chart
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
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#6366f1',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtMoney(ctx.parsed.y) } } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v), font: { family: 'Inter' } }, grid: { color: '#f3f4f6' } },
          x: { ticks: { font: { family: 'Inter' } }, grid: { display: false } }
        }
      }
    });
  }
}

// ---------- PREVISIONS ----------

function calculateForecast(startMonth, targetMonth) {
  // Pour chaque mois on prend :
  //   - Charges : Fixes (date <= mois) + Variables (date dans ce mois)
  //   - Revenus : idem
  //   - Crédit : si le mois a un remboursement saisi → ce montant. Sinon → moyenne historique.
  //   - Net = revenus - charges - crédit
  const months = listMonthsBetween(startMonth, targetMonth);
  const avgRepay = getAvgMonthlyRepayment();
  const todayMonth = new Date().toISOString().slice(0, 7);
  let cumulative = 0;
  const breakdown = months.map(m => {
    const charges = state.charges.filter(c => isInMonth(c, m));
    const revenus = state.revenus.filter(r => isInMonth(r, m));
    const totalCharges = charges.reduce((s, c) => s + c.montant, 0);
    const totalRevenus = revenus.reduce((s, r) => s + r.montant, 0);

    // Remboursement crédit : réel si saisi pour ce mois, sinon moyenne (estimation)
    const realRepayments = state.credit
      .filter(c => c.date && c.rembourse > 0 && c.date.startsWith(m))
      .reduce((s, c) => s + c.rembourse, 0);
    const creditPayment = (realRepayments > 0) ? realRepayments
                        : (m > todayMonth ? avgRepay : 0); // futurs mois sans saisie → moyenne

    const hasVariables = charges.some(c => c.statut !== 'Fixe') || revenus.some(r => r.statut !== 'Fixe');
    const net = totalRevenus - totalCharges - creditPayment;
    cumulative += net;
    return { month: m, revenus: totalRevenus, charges: totalCharges, credit: creditPayment, net, cumulative, hasVariables };
  });
  return {
    months: breakdown,
    totalCumulative: cumulative,
    avgMonthly: breakdown.length ? cumulative / breakdown.length : 0
  };
}

function calculateCreditForecast(months) {
  // Estime le remboursement moyen mensuel à partir de l'historique
  if (state.credit.length < 2) {
    const last = state.credit[state.credit.length - 1];
    return last ? last.restant : 0;
  }
  const sorted = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const repayments = sorted.slice(1).map(c => c.rembourse).filter(r => r > 0);
  const avgRepay = repayments.length ? repayments.reduce((s, x) => s + x, 0) / repayments.length : 0;
  const last = sorted[sorted.length - 1];
  return Math.max(0, last.restant - avgRepay * months);
}

function renderForecast() {
  const targetInput = document.getElementById('forecast-target');
  const targetMonth = targetInput.value;
  if (!targetMonth) {
    toast('Choisis une date cible', 'error');
    return;
  }
  if (targetMonth < state.month) {
    toast('La date cible doit être après le mois en cours', 'error');
    return;
  }

  const forecast = calculateForecast(state.month, targetMonth);

  document.getElementById('forecast-empty').classList.add('hidden');
  document.getElementById('forecast-results').classList.remove('hidden');

  document.getElementById('forecast-total').textContent = fmtMoney(forecast.totalCumulative);
  document.getElementById('forecast-range').textContent = `De ${fmtMonth(state.month)} à ${fmtMonth(targetMonth)}`;
  document.getElementById('forecast-avg').textContent = fmtMoney(forecast.avgMonthly);
  document.getElementById('forecast-months-count').textContent = `Sur ${forecast.months.length} mois`;

  const creditProjected = calculateCreditForecast(forecast.months.length - 1);
  document.getElementById('forecast-credit').textContent = fmtMoney(creditProjected);

  // Chart
  if (state.forecastChart) state.forecastChart.destroy();
  state.forecastChart = new Chart(document.getElementById('forecast-chart'), {
    type: 'line',
    data: {
      labels: forecast.months.map(m => fmtMonth(m.month)),
      datasets: [{
        label: 'Épargne cumulée',
        data: forecast.months.map(m => m.cumulative),
        borderColor: '#6366f1',
        backgroundColor: ctx => {
          const c = ctx.chart.ctx.createLinearGradient(0, 0, 0, 250);
          c.addColorStop(0, 'rgba(99,102,241,0.3)');
          c.addColorStop(1, 'rgba(99,102,241,0)');
          return c;
        },
        fill: true,
        tension: 0.3,
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtMoney(ctx.parsed.y) } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v), font: { family: 'Inter' } }, grid: { color: '#f3f4f6' } },
        x: { ticks: { font: { family: 'Inter' }, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } }
      }
    }
  });

  // Table
  const tbody = document.getElementById('forecast-tbody');
  tbody.innerHTML = forecast.months.map((m, i) => {
    const badges = [];
    if (i === 0) badges.push('<span class="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded ml-1">actuel</span>');
    if (m.hasVariables) badges.push('<span class="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded ml-1" title="Contient des entrées variables réellement saisies">réel</span>');
    else                badges.push('<span class="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-1" title="Projection basée uniquement sur les entrées fixes">projeté</span>');
    return `
      <tr class="hover:bg-gray-50 transition ${i === 0 ? 'bg-indigo-50/30' : ''}">
        <td class="px-6 py-3 text-gray-700 font-medium whitespace-nowrap">${fmtMonth(m.month)}${badges.join('')}</td>
        <td class="px-6 py-3 text-right text-emerald-600 font-medium">${fmtMoney(m.revenus)}</td>
        <td class="px-6 py-3 text-right text-rose-600 font-medium">${fmtMoney(m.charges)}</td>
        <td class="px-6 py-3 text-right text-indigo-600 font-medium">${m.credit > 0 ? '-' + fmtMoney(m.credit) : '—'}</td>
        <td class="px-6 py-3 text-right font-semibold ${m.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${fmtMoney(m.net)}</td>
        <td class="px-6 py-3 text-right font-bold text-indigo-600">${fmtMoney(m.cumulative)}</td>
      </tr>
    `;
  }).join('');
}

// ------------------------------------------------------------
//  COMPONENTS
// ------------------------------------------------------------

function statutBadge(s, rowIndex, kind) {
  const isFixe = s === 'Fixe';
  const base = 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md font-medium cursor-pointer transition border';
  const colors = isFixe
    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100';
  const icon = isFixe
    ? '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'
    : '';
  return `<button data-toggle-${kind}-statut="${rowIndex}" data-current="${s}" title="Cliquer pour basculer Fixe ↔ Variable" class="${base} ${colors}">${icon}${s}</button>`;
}

function deleteBtn(kind, rowIndex) {
  return `<button data-delete-${kind}="${rowIndex}" title="Supprimer" class="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
  </button>`;
}

function rowActions(kind, rowIndex) {
  // Bouton Modifier (crayon) — disponible pour 'charge' et 'revenu'
  const editButton = (kind === 'charge' || kind === 'revenu')
    ? `<button data-edit-${kind}="${rowIndex}" title="Modifier" class="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition mr-1">
         <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
       </button>`
    : '';
  return `<div class="inline-flex items-center">${editButton}${deleteBtn(kind, rowIndex)}</div>`;
}

// ------------------------------------------------------------
//  NAVIGATION (sidebar + mobile)
// ------------------------------------------------------------

function setActiveTab(tab) {
  state.view = tab;

  // Update sidebar
  document.querySelectorAll('aside .nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Update mobile nav
  document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  // Show the right view
  document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
  document.getElementById(tab + '-view').classList.remove('hidden');

  // Update header
  const meta = PAGE_META[tab];
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-subtitle').textContent = meta.subtitle;

  // Show/hide month selector
  document.getElementById('header-actions').style.display = meta.showMonth ? '' : 'none';
  document.getElementById('month-selector-mobile').style.display = meta.showMonth ? '' : 'none';

  // Scroll to top on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// ------------------------------------------------------------
//  MONTH SELECTORS (sync desktop + mobile)
// ------------------------------------------------------------

function syncMonthInputs(value) {
  document.getElementById('month-input').value = value;
  document.getElementById('month-input-mobile').value = value;
}

function onMonthChange(e) {
  state.month = e.target.value;
  syncMonthInputs(state.month);
  renderDashboard();
  renderCharges();
  renderRevenus();
}

document.getElementById('month-input').addEventListener('change', onMonthChange);
document.getElementById('month-input-mobile').addEventListener('change', onMonthChange);

// ------------------------------------------------------------
//  REFRESH
// ------------------------------------------------------------

['refresh-btn', 'refresh-btn-mobile'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', async () => {
    toast('Synchronisation...');
    await loadAllData();
    toast('Données à jour ✓', 'success');
  });
});

// ------------------------------------------------------------
//  FORMS
// ------------------------------------------------------------

document.getElementById('charge-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (await appendRow(CONFIG.SHEETS.CHARGES, [
    fd.get('date'), fd.get('libelle'), fd.get('categorie'),
    fd.get('montant'), fd.get('paye_par') || '', fd.get('statut') || 'Variable'
  ])) {
    e.target.reset();
    toast('Charge ajoutée ✓', 'success');
    await loadAllData();
  }
});

document.getElementById('revenu-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (await appendRow(CONFIG.SHEETS.REVENUS, [
    fd.get('date'), fd.get('libelle'), fd.get('montant'),
    fd.get('percu_par') || '', fd.get('statut') || 'Fixe'
  ])) {
    e.target.reset();
    toast('Revenu ajouté ✓', 'success');
    await loadAllData();
  }
});

// Helper : calcule le nouveau restant en fonction du remboursement
function computeNewRestant(rembourse) {
  const sorted = [...state.credit].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  if (!last) return null; // aucune entrée existante
  return Math.max(0, last.restant - (parseFloat(rembourse) || 0));
}

// Met à jour le texte de preview sous le formulaire crédit
function updateCreditPreview() {
  const input = document.getElementById('credit-rembourse-input');
  const preview = document.getElementById('credit-form-preview');
  if (!input || !preview) return;
  const value = parseFloat(input.value);
  if (isNaN(value) || value <= 0) {
    preview.classList.add('hidden');
    return;
  }
  const newRestant = computeNewRestant(value);
  if (newRestant === null) {
    preview.classList.remove('hidden');
    preview.textContent = '⚠️ Initialise d\'abord le montant total ci-dessus';
    preview.classList.remove('text-indigo-600');
    preview.classList.add('text-amber-600');
  } else {
    preview.classList.remove('hidden');
    preview.textContent = `→ Nouveau restant : ${fmtMoney(newRestant)}`;
    preview.classList.add('text-indigo-600');
    preview.classList.remove('text-amber-600');
  }
}

document.getElementById('credit-rembourse-input').addEventListener('input', updateCreditPreview);

document.getElementById('credit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const rembourse = parseFloat(fd.get('rembourse')) || 0;
  const newRestant = computeNewRestant(rembourse);
  if (newRestant === null) {
    toast('Initialise d\'abord le montant total du crédit (carte en haut)', 'error');
    return;
  }
  if (await appendRow(CONFIG.SHEETS.CREDIT, [
    fd.get('date'), rembourse, newRestant, fd.get('commentaire') || ''
  ])) {
    e.target.reset();
    updateCreditPreview();
    toast(`Remboursement ajouté ✓ Reste : ${fmtMoney(newRestant)}`, 'success');
    await loadAllData();
  }
});

// ------------------------------------------------------------
//  ÉPARGNE — édition inline (ajoute une nouvelle entrée à chaque save)
// ------------------------------------------------------------

(function setupEpargneEdit() {
  const editBtn = document.getElementById('epargne-edit-btn');
  const viewEl = document.getElementById('epargne-view');
  const editEl = document.getElementById('epargne-edit');
  const inputEl = document.getElementById('epargne-input');
  const saveBtn = document.getElementById('epargne-save');
  const cancelBtn = document.getElementById('epargne-cancel');

  function enterEditMode() {
    const epSorted = [...state.epargne].sort((a, b) => a.date.localeCompare(b.date));
    const last = epSorted[epSorted.length - 1];
    inputEl.value = last ? last.montant : '';
    viewEl.classList.add('hidden');
    editEl.classList.remove('hidden');
    editBtn.classList.add('hidden');
    inputEl.focus(); inputEl.select();
  }
  function exitEditMode() {
    editEl.classList.add('hidden');
    viewEl.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  }
  async function saveValue() {
    const parsed = parseFloat(String(inputEl.value || '').replace(',', '.').trim());
    if (isNaN(parsed) || parsed < 0) {
      toast('Montant invalide (ex: 12500)', 'error');
      inputEl.focus();
      return;
    }
    saveBtn.disabled = true; saveBtn.textContent = '...';
    const today = new Date().toISOString().slice(0, 10);
    const ok = await appendRow(CONFIG.SHEETS.EPARGNE, [today, parsed, 'Mise à jour manuelle']);
    saveBtn.disabled = false; saveBtn.textContent = '✓ Enregistrer';
    if (ok) {
      toast('Épargne mise à jour ✓', 'success');
      exitEditMode();
      await loadAllData();
    }
  }

  editBtn.addEventListener('click', enterEditMode);
  cancelBtn.addEventListener('click', exitEditMode);
  saveBtn.addEventListener('click', saveValue);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveValue(); }
    if (e.key === 'Escape') { e.preventDefault(); exitEditMode(); }
  });
})();

// Bouton "Calculer" prévisions
document.getElementById('forecast-btn').addEventListener('click', renderForecast);
document.getElementById('forecast-target').addEventListener('change', () => {
  // Auto-recalcul si déjà affiché
  if (!document.getElementById('forecast-results').classList.contains('hidden')) {
    renderForecast();
  }
});

// ------------------------------------------------------------
//  CREDIT INLINE EDIT
// ------------------------------------------------------------

(function setupCreditEdit() {
  const editBtn = document.getElementById('credit-edit-initial');
  const viewEl = document.getElementById('credit-initial-view');
  const editEl = document.getElementById('credit-initial-edit');
  const inputEl = document.getElementById('credit-initial-input');
  const saveBtn = document.getElementById('credit-initial-save');
  const cancelBtn = document.getElementById('credit-initial-cancel');

  function enterEditMode() {
    inputEl.value = editBtn.dataset.currentValue || '';
    viewEl.classList.add('hidden');
    editEl.classList.remove('hidden');
    editBtn.classList.add('hidden');
    inputEl.focus(); inputEl.select();
  }
  function exitEditMode() {
    editEl.classList.add('hidden');
    viewEl.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  }
  async function saveValue() {
    const parsed = parseFloat(String(inputEl.value || '').replace(',', '.').trim());
    if (isNaN(parsed) || parsed < 0) {
      toast('Montant invalide (ex: 145000)', 'error');
      inputEl.focus();
      return;
    }
    const rowIndex = editBtn.dataset.rowIndex;
    saveBtn.disabled = true; saveBtn.textContent = '...';
    let ok = false;
    if (rowIndex === undefined || rowIndex === '') {
      const today = new Date().toISOString().slice(0, 10);
      ok = await appendRow(CONFIG.SHEETS.CREDIT, [today, 0, parsed, 'Solde initial']);
    } else {
      ok = await updateCell(CONFIG.SHEETS.CREDIT, +rowIndex, 'C', parsed);
    }
    saveBtn.disabled = false; saveBtn.textContent = '✓ Enregistrer';
    if (ok) {
      toast('Montant total mis à jour ✓', 'success');
      exitEditMode();
      await loadAllData();
    }
  }

  editBtn.addEventListener('click', enterEditMode);
  cancelBtn.addEventListener('click', exitEditMode);
  saveBtn.addEventListener('click', saveValue);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveValue(); }
    if (e.key === 'Escape') { e.preventDefault(); exitEditMode(); }
  });
})();

// ------------------------------------------------------------
//  EDIT MODAL (pour Charges et Revenus)
// ------------------------------------------------------------

let currentEdit = { kind: null, rowIndex: null };

function openEditModal(kind, rowIndex) {
  const list = (kind === 'charge') ? state.charges : state.revenus;
  const entry = list.find(e => e._rowIndex === rowIndex);
  if (!entry) { toast('Entrée introuvable', 'error'); return; }

  currentEdit = { kind, rowIndex };
  const form = document.getElementById('edit-modal-form');

  document.getElementById('edit-modal-title').textContent = kind === 'charge' ? 'Modifier la charge' : 'Modifier le revenu';
  document.getElementById('edit-categorie-wrapper').style.display = kind === 'charge' ? '' : 'none';
  document.getElementById('edit-person-label').textContent = kind === 'charge' ? 'Payé par' : 'Perçu par';

  form.date.value = entry.date || '';
  form.libelle.value = entry.libelle || '';
  form.montant.value = entry.montant || '';
  form.statut.value = entry.statut || 'Variable';
  if (kind === 'charge') {
    form.categorie.value = entry.categorie || '';
    form.person.value = entry.paye_par || '';
  } else {
    form.categorie.value = '';
    form.person.value = entry.percu_par || '';
  }

  document.getElementById('edit-modal').classList.remove('hidden');
  setTimeout(() => form.libelle.focus(), 50);
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  currentEdit = { kind: null, rowIndex: null };
}

document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target.id === 'edit-modal') closeEditModal(); // clic sur l'overlay
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('edit-modal').classList.contains('hidden')) closeEditModal();
});

document.getElementById('edit-modal-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentEdit.kind) return;
  const fd = new FormData(e.target);
  const saveBtn = document.getElementById('edit-modal-save');
  saveBtn.disabled = true; saveBtn.textContent = '...';

  let values, sheetName;
  if (currentEdit.kind === 'charge') {
    values = [
      fd.get('date'),
      fd.get('libelle'),
      fd.get('categorie') || '',
      fd.get('montant'),
      fd.get('person') || '',
      fd.get('statut') || 'Variable'
    ];
    sheetName = CONFIG.SHEETS.CHARGES;
  } else {
    values = [
      fd.get('date'),
      fd.get('libelle'),
      fd.get('montant'),
      fd.get('person') || '',
      fd.get('statut') || 'Fixe'
    ];
    sheetName = CONFIG.SHEETS.REVENUS;
  }

  const ok = await updateRow(sheetName, currentEdit.rowIndex, values);
  saveBtn.disabled = false; saveBtn.textContent = '✓ Enregistrer';
  if (ok) {
    toast(currentEdit.kind === 'charge' ? 'Charge modifiée ✓' : 'Revenu modifié ✓', 'success');
    closeEditModal();
    await loadAllData();
  }
});

// ------------------------------------------------------------
//  DELETE + TOGGLE STATUT + EDIT (event delegation)
// ------------------------------------------------------------

document.body.addEventListener('click', async e => {
  const charge = e.target.closest('[data-delete-charge]');
  const revenu = e.target.closest('[data-delete-revenu]');
  const credit = e.target.closest('[data-delete-credit]');
  const togC   = e.target.closest('[data-toggle-charge-statut]');
  const togR   = e.target.closest('[data-toggle-revenu-statut]');
  const editC  = e.target.closest('[data-edit-charge]');
  const editR  = e.target.closest('[data-edit-revenu]');

  if (editC) { openEditModal('charge', +editC.dataset.editCharge); return; }
  if (editR) { openEditModal('revenu', +editR.dataset.editRevenu); return; }

  if (togC) {
    const rowIndex = +togC.dataset.toggleChargeStatut;
    const newStatut = togC.dataset.current === 'Fixe' ? 'Variable' : 'Fixe';
    if (await updateCell(CONFIG.SHEETS.CHARGES, rowIndex, 'F', newStatut)) {
      toast(`Charge → ${newStatut}`, 'success');
      await loadAllData();
    }
    return;
  }
  if (togR) {
    const rowIndex = +togR.dataset.toggleRevenuStatut;
    const newStatut = togR.dataset.current === 'Fixe' ? 'Variable' : 'Fixe';
    if (await updateCell(CONFIG.SHEETS.REVENUS, rowIndex, 'E', newStatut)) {
      toast(`Revenu → ${newStatut}`, 'success');
      await loadAllData();
    }
    return;
  }

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
//  UTILS
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

function fmtMonth(yearMonth) {
  if (!yearMonth) return '';
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function listMonthsBetween(start, end) {
  const result = [];
  let [y, m] = start.split('-').map(Number);
  const [eY, eM] = end.split('-').map(Number);
  while (y < eY || (y === eY && m <= eM)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

function addMonthsToYearMonth(ym, count) {
  let [y, m] = ym.split('-').map(Number);
  m += count;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.className = 'fixed bottom-24 lg:bottom-6 right-4 lg:right-6 px-4 py-3 rounded-xl shadow-xl text-sm z-50 max-w-sm font-medium ' + ({
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-gray-900 text-white'
  }[type] || 'bg-gray-900 text-white');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
