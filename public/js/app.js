/* 大西庫存管理系統 — 主邏輯 app.js
   依賴載入順序: supabase CDN → data.js → supabase.js → app.js */

/* ═══════════════════ STATE ═══════════════════ */
let products = [];
let transactions = [];
let currentUser = null;
let isLoading = false;
let editingProdId = null;
let currentTxType = 'out';
let trendChart = null, pieChart = null, barChart = null;
let consumeStoreFilter = 0;
let consumeInputMode = 'delta';
let importRows = [];
let currentRole = 'staff';
let currentOrg  = null;
const isAdmin   = () => currentRole === 'owner' || currentRole === 'admin';
const TABS = ['overview', 'inventory', 'stores', 'charts', 'transactions', 'restock', 'consume', 'staff'];

/* ═══════════════════ UTILS ═══════════════════ */
const stockOf = (p, sid) => p.stock[sid] ?? 0;
const thrOf   = (p, sid) => p.threshold[sid] ?? 0;
const pctOf   = (p, sid) => thrOf(p, sid) ? Math.min(1, stockOf(p, sid) / thrOf(p, sid)) : 1;
const isLow   = (p, sid) => stockOf(p, sid) < thrOf(p, sid);
const anyLow  = p => STORES.some(s => isLow(p, s.id));

function barCls(p, sid) {
  const r = pctOf(p, sid);
  return r < 0.5 ? 'bar-danger' : r < 1 ? 'bar-warn' : 'bar-ok';
}
function badgeCls(p, sid) {
  const r = pctOf(p, sid);
  return r < 0.5 ? 'badge-danger' : r < 1 ? 'badge-warn' : 'badge-ok';
}
function badgeTxt(p, sid) {
  const r = pctOf(p, sid);
  return r < 0.5 ? '嚴重不足' : r < 1 ? '低庫存' : '正常';
}

/* ═══════════════════ TOAST ═══════════════════ */
function toast(msg, color = '#10b981') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = color + '55';
  el.style.color = color;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/* ═══════════════════ LOADING BAR ═══════════════════ */
function showLoading(on) {
  document.getElementById('loadingBar').style.display = on ? 'block' : 'none';
}

/* ═══════════════════ AUTH ═══════════════════ */
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');
  if (!email || !pass) { errEl.textContent = '請填寫帳號與密碼'; return; }
  btn.disabled = true;
  btn.textContent = '登入中…';
  errEl.textContent = '';
  try {
    const { user } = await authSignIn(email, pass);
    currentUser = user;
    showApp();
  } catch (e) {
    errEl.textContent = e.message.includes('Invalid login credentials') ? '帳號或密碼錯誤' : e.message;
    btn.disabled = false;
    btn.textContent = '登入';
  }
}

async function doLogout() {
  if (!currentUser) return;
  currentUser = null;
  products = [];
  transactions = [];
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = '登入';
  document.getElementById('loginError').textContent = '';
  if (sb) sb.removeAllChannels();
  await authSignOut();
}

async function showApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // 讀取 profile（含 org_id、role）
  let profile = null;
  try { profile = await dbLoadProfile(currentUser.id); } catch (_) {}

  if (!profile) {
    // 帳號沒有組織 → 顯示建立組織畫面
    showOnboarding();
    return;
  }

  currentOrg  = { id: profile.org_id };
  currentRole = profile.role;
  setOrgContext(profile.org_id);

  // 載入分店（動態）
  try { STORES = await dbLoadStores(); } catch (_) {}

  const displayName = profile.display_name || authGetDisplayName(currentUser);
  document.getElementById('headerUser').textContent = displayName;

  const badge = document.getElementById('roleBadge');
  const roleLabel = { owner: '老闆', admin: '管理者', staff: '員工' }[currentRole] || '員工';
  badge.textContent = roleLabel;
  badge.className   = 'role-badge ' + (isAdmin() ? 'role-admin' : 'role-staff');

  applyRoleUI();

  consumeStoreFilter = STORES.find(s => s.type === 'branch')?.id || STORES[0]?.id;
  loadAllData();
}

function applyRoleUI() {
  const admin = isAdmin();
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
}

/* ─── 建立組織畫面（新帳號第一次登入） ─── */
function showOnboarding() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('onboardingOverlay').style.display = 'flex';
}

async function doCreateOrg() {
  const orgName     = document.getElementById('obOrgName').value.trim();
  const displayName = document.getElementById('obName').value.trim();
  const errEl       = document.getElementById('obError');
  const btn         = document.getElementById('obBtn');
  if (!orgName || !displayName) { errEl.textContent = '請填寫所有欄位'; return; }

  btn.disabled = true;
  btn.textContent = '建立中…';
  errEl.textContent = '';
  try {
    const orgId = await dbCreateOrg(orgName, currentUser.id, displayName, currentUser.email);
    document.getElementById('onboardingOverlay').style.display = 'none';
    currentOrg  = { id: orgId };
    currentRole = 'owner';
    setOrgContext(orgId);
    STORES = await dbLoadStores();
    document.getElementById('app').style.display = 'flex';
    document.getElementById('headerUser').textContent = displayName;
    const badge = document.getElementById('roleBadge');
    badge.textContent = '老闆';
    badge.className   = 'role-badge role-admin';
    applyRoleUI();
    consumeStoreFilter = STORES.find(s => s.type === 'branch')?.id || STORES[0]?.id;
    loadAllData();
    toast('✅ 系統建立完成，歡迎使用！');
  } catch (e) {
    errEl.textContent = e.message;
    btn.disabled = false;
    btn.textContent = '建立我的系統';
  }
}

/* ═══════════════════ DATA LOADING ═══════════════════ */
let _syncTimer = null;

// silent=true：背景靜默同步（不亮 loading bar），用於即時訂閱觸發
async function loadAllData(silent = false) {
  if (isLoading) return;
  isLoading = true;
  if (!silent) showLoading(true);
  try {
    [products, transactions] = await Promise.all([dbLoadProducts(), dbLoadTransactions()]);
    updateStats();
    const activeTab = TABS.find((_, i) => document.querySelectorAll('.nav-btn')[i]?.classList.contains('active'));
    if (activeTab) switchTab(activeTab);
    else renderOverview();
  } catch (e) {
    if (!silent) toast('載入資料失敗：' + e.message, '#ef4444');
  } finally {
    isLoading = false;
    if (!silent) showLoading(false);
  }
}

/* ═══════════════════ STATS ═══════════════════ */
function updateStats() {
  const low   = products.filter(p => STORES.some(s => isLow(p, s.id)));
  const today = transactions.filter(t => t.created_at &&
    new Date(t.created_at).toDateString() === new Date().toDateString());

  document.getElementById('sTotal').textContent = products.length;
  document.getElementById('sLow').textContent   = low.length;
  document.getElementById('sTx').textContent    = today.length;

  const pill = document.getElementById('alertPill');
  if (low.length > 0) {
    pill.style.display = '';
    pill.textContent = '⚠ ' + low.length + ' 項低庫存';
  } else {
    pill.style.display = 'none';
  }
}

/* ═══════════════════ MORE DRAWER ═══════════════════ */
function openMoreDrawer() {
  document.getElementById('moreDrawerBg').classList.add('open');
  document.getElementById('moreDrawer').classList.add('open');
}
function closeMoreDrawer() {
  document.getElementById('moreDrawerBg').classList.remove('open');
  document.getElementById('moreDrawer').classList.remove('open');
}
function switchTabFromDrawer(id) {
  closeMoreDrawer();
  switchTab(id);
}

/* ═══════════════════ TAB SWITCH ═══════════════════ */
function switchTab(id) {
  TABS.forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === id);
  });
  // 頂部 nav
  document.querySelectorAll('.nav-btn').forEach((btn, i) => {
    btn.classList.toggle('active', TABS[i] === id);
    btn.setAttribute('aria-current', TABS[i] === id ? 'page' : 'false');
  });
  // 底部 tab bar
  document.querySelectorAll('.btab[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === id);
  });
  const renders = {
    overview:     () => { updateStats(); renderOverview(); },
    inventory:    renderInventory,
    stores:       renderStores,
    charts:       renderCharts,
    transactions: renderTransactions,
    restock:      renderRestock,
    consume:      renderConsume,
    staff:        renderStaff,
  };
  renders[id]?.();
}

/* ═══════════════════ OVERVIEW ═══════════════════ */
function renderOverview() {
  const el = document.getElementById('overviewBars');
  if (!products.length) {
    el.innerHTML = '<div class="empty-state">尚無品項</div>';
    return;
  }
  const wid = STORES.find(s => s.type === 'warehouse')?.id;
  el.innerHTML = products.map(p => {
    const sid = wid;
    const w = Math.min(100, pctOf(p, sid) * 100).toFixed(1);
    return `
      <div class="overview-bar-row">
        <div class="overview-bar-labels">
          <span class="overview-bar-name">${anyLow(p) ? '⚠ ' : ''}${p.name}</span>
          <span class="overview-bar-val">${stockOf(p, sid)} / ${thrOf(p, sid)} ${p.unit}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${barCls(p, sid)}" style="width:${w}%"></div>
        </div>
      </div>`;
  }).join('');
}

/* ═══════════════════ INVENTORY ═══════════════════ */
function renderInventory() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const list = q
    ? products.filter(p => p.name.toLowerCase().includes(q))
    : products;

  const el = document.getElementById('inventoryList');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state">沒有符合的品項</div>';
    return;
  }

  el.innerHTML = list.map(p => {
    const storeCells = STORES.map(s => {
      const w = Math.min(100, pctOf(p, s.id) * 100).toFixed(1);
      return `
        <div class="store-stock-cell">
          <div class="store-stock-name">${s.name}</div>
          <div class="store-stock-bar">
            <div class="bar-track"><div class="bar-fill ${barCls(p, s.id)}" style="width:${w}%"></div></div>
          </div>
          <span class="store-stock-val">${stockOf(p, s.id)}</span>
          <span class="store-stock-unit"> ${p.unit}</span>
        </div>`;
    }).join('');

    return `
      <div class="product-card" id="prod-${p.id}">
        <div class="product-header">
          <div>
            <div class="product-name">${p.name}</div>
            <div class="product-supplier">${p.supplier || ''} ${p.supplierContact ? '· ' + p.supplierContact : ''}</div>
          </div>
          <span class="badge ${badgeCls(p, 1)}">${badgeTxt(p, 1)}</span>
        </div>
        <div class="store-stock-grid">${storeCells}</div>
        ${isAdmin() ? `
        <div class="product-actions">
          <button class="btn btn-secondary btn-sm" onclick="openEditProd('${p.id}')">✏️ 編輯</button>
          <button class="btn btn-secondary btn-sm btn-danger" onclick="deleteProd('${p.id}')">🗑️ 刪除</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

/* ═══════════════════ STORES (水位頁) ═══════════════════ */
function renderStores() {
  const grid = document.getElementById('storeGrid');

  if (!STORES.length) {
    grid.innerHTML = '<div class="empty-state">尚無分店，請新增</div>';
  } else {
    grid.innerHTML = STORES.map(s => {
      const lowCount = products.filter(p => isLow(p, s.id)).length;
      const bars = products.map(p => {
        const w = Math.min(100, pctOf(p, s.id) * 100).toFixed(1);
        return `
          <div class="store-prod-bar">
            <div class="store-prod-bar-labels">
              <span class="store-prod-label">${p.name.split('（')[0].trim()}</span>
              <span class="store-prod-val">${stockOf(p, s.id)} ${p.unit}</span>
            </div>
            <div class="bar-track" style="height:6px">
              <div class="bar-fill ${barCls(p, s.id)}" style="width:${w}%"></div>
            </div>
          </div>`;
      }).join('');

      return `
        <div class="store-card" style="border-color:${s.color}25">
          <div class="store-card-header">
            <div class="store-dot" style="background:${s.color};box-shadow:0 0 8px ${s.color}88"></div>
            <div style="flex:1">
              <div class="store-name">${s.name}</div>
              <div class="store-type">${s.type === 'warehouse' ? '中心倉庫' : '分店'}${lowCount ? ' · ⚠ ' + lowCount + ' 項低庫存' : ''}</div>
            </div>
            ${isAdmin() ? `<button class="btn btn-secondary btn-sm btn-danger" style="margin-left:8px;flex-shrink:0" onclick="deleteStore('${s.id}','${s.name.replace(/'/g, "\\'")}')">🗑️</button>` : ''}
          </div>
          ${bars || '<div style="font-size:12px;color:var(--dim);padding:6px 0">尚無品項</div>'}
        </div>`;
    }).join('');
  }

  const txEl = document.getElementById('storeTxList');
  const list = transactions.slice(0, 10);
  txEl.innerHTML = list.length
    ? list.map(tx => txHtml(tx)).join('')
    : '<div class="empty-state">尚無異動記錄</div>';
}

/* ═══════════════════ STORE MODAL ═══════════════════ */
const STORE_COLORS = [
  { color: '#10b981', bg: '#d1fae5' },
  { color: '#3b82f6', bg: '#dbeafe' },
  { color: '#f59e0b', bg: '#fef3c7' },
  { color: '#ef4444', bg: '#fee2e2' },
  { color: '#8b5cf6', bg: '#ede9fe' },
  { color: '#f97316', bg: '#fff3e8' },
  { color: '#06b6d4', bg: '#cffafe' },
  { color: '#ec4899', bg: '#fce7f3' },
];

function openAddStore() {
  document.getElementById('storeModalTitle').textContent = '🏬 新增分店';
  document.getElementById('fStoreName').value = '';
  document.getElementById('fStoreType').value = 'branch';
  _setStoreColor(STORE_COLORS[0].color, STORE_COLORS[0].bg);
  _renderStoreColorPresets();
  document.getElementById('storeModal').classList.add('open');
}

function closeStoreModal() {
  document.getElementById('storeModal').classList.remove('open');
}

function _renderStoreColorPresets() {
  const selected = document.getElementById('fStoreColor').value;
  document.getElementById('storeColorPresets').innerHTML = STORE_COLORS.map(c =>
    `<button type="button" class="store-color-btn${c.color === selected ? ' selected' : ''}"
      style="background:${c.color}"
      onclick="_setStoreColor('${c.color}','${c.bg}')"></button>`
  ).join('');
}

function _setStoreColor(color, bg) {
  document.getElementById('fStoreColor').value = color;
  document.getElementById('fStoreColor').dataset.bg = bg;
  _renderStoreColorPresets();
}

async function saveStore() {
  const name  = document.getElementById('fStoreName').value.trim();
  const type  = document.getElementById('fStoreType').value;
  const color = document.getElementById('fStoreColor').value;
  const bg    = document.getElementById('fStoreColor').dataset.bg || '#e6f1fb';
  if (!name) { toast('請填寫分店名稱', '#ef4444'); return; }

  try {
    await dbAddStore(name, type, color, bg);
    closeStoreModal();
    STORES = await dbLoadStores();
    toast('✅ 分店已新增：' + name);
    renderStores();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

async function deleteStore(id, name) {
  if (!confirm(`確定要刪除「${name}」？\n注意：此分店的庫存記錄也會一併刪除。`)) return;
  try {
    await dbDeleteStore(id);
    STORES = await dbLoadStores();
    toast('🗑️ 分店已刪除', '#f59e0b');
    renderStores();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

/* ═══════════════════ TRANSACTIONS ═══════════════════ */
function txHtml(tx) {
  let badgeClass, badgeText, detail;
  if (tx.type === 'consume') {
    badgeClass = 'tx-consume'; badgeText = '消耗';
    detail = `${tx.from} · ${tx.operator}${tx.note ? ' · ' + tx.note : ''}`;
  } else if (tx.type === 'in') {
    badgeClass = 'tx-in'; badgeText = '進貨';
    detail = `${tx.from} → ${tx.to} · ${tx.operator}${tx.note ? ' · ' + tx.note : ''}`;
  } else {
    badgeClass = 'tx-out'; badgeText = '出貨';
    detail = `${tx.from} → ${tx.to} · ${tx.operator}${tx.note ? ' · ' + tx.note : ''}`;
  }
  return `
    <div class="tx-item">
      <div class="tx-time">${tx.time}</div>
      <span class="tx-badge ${badgeClass}">${badgeText}</span>
      <div class="tx-body">
        <div class="tx-prod">${tx.product}</div>
        <div class="tx-detail">${detail}</div>
      </div>
      <div class="tx-qty">×${tx.qty}</div>
    </div>`;
}

function renderTransactions() {
  const el = document.getElementById('txList');
  el.innerHTML = transactions.length
    ? transactions.slice(0, 50).map(txHtml).join('')
    : '<div class="empty-state">尚無異動記錄</div>';
}

/* ═══════════════════ RESTOCK ═══════════════════ */
function renderRestock() {
  const low = [];
  products.forEach(p => STORES.forEach(s => {
    if (isLow(p, s.id)) low.push({ p, s });
  }));
  low.sort((a, b) => pctOf(a.p, a.s.id) - pctOf(b.p, b.s.id));

  const el = document.getElementById('restockList');
  if (!low.length) {
    el.innerHTML = '<div class="empty-state" style="color:#10b981">✅ 所有品項庫存正常，無需叫貨</div>';
    updateDiscord([]);
    return;
  }

  el.innerHTML = low.map(({ p, s }) => {
    const need = thrOf(p, s.id) - stockOf(p, s.id);
    return `
      <div class="restock-item">
        <div>
          <div class="restock-name">${p.name}</div>
          <div class="restock-meta">${s.name}</div>
          <div class="restock-meta">${p.supplier || ''} ${p.supplierContact ? '· ' + p.supplierContact : ''}</div>
          <div class="restock-meta" style="margin-top:6px">
            建議叫貨：<strong style="color:#f59e0b">${need} ${p.unit}</strong>
          </div>
        </div>
        <div>
          <div class="restock-qty">${stockOf(p, s.id)} / ${thrOf(p, s.id)}</div>
          <div class="restock-sub">現有 / 水位</div>
          <div style="margin-top:8px;text-align:right">
            <span class="badge ${badgeCls(p, s.id)}">${badgeTxt(p, s.id)}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  updateDiscord(low);
}

function updateDiscord(low) {
  const today = new Date().toLocaleDateString('zh-TW');
  let text = `📦 **大西庫存 Daily Digest** | ${today}\n\n`;
  if (!low.length) {
    text += '✅ 所有品項庫存正常';
  } else {
    text += '⚠️ **低庫存警示 (' + low.length + ' 項)**\n';
    low.forEach(({ p, s }) => {
      const need = thrOf(p, s.id) - stockOf(p, s.id);
      text += `- ${p.name} (${s.name}): 剩 ${stockOf(p,s.id)} ${p.unit} / 水位 ${thrOf(p,s.id)} ${p.unit} | 建議叫 ${need} ${p.unit} | ${p.supplier} ${p.supplierContact}\n`;
    });
  }
  const pre = document.getElementById('discordPreview');
  if (pre) pre.textContent = text;
}

/* ═══════════════════ CHARTS ═══════════════════ */
function renderCharts() {
  const gridColor = 'rgba(255,255,255,0.07)';
  const tickColor = '#64748b';
  const today = new Date();

  // 近 7 日標籤
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const dayLabels = days.map(d =>
    (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0')
  );

  const branchStores = STORES.filter(s => s.type === 'branch');
  const seriesColors = ['#10b981', '#f59e0b', '#8b5cf6', '#3b82f6'];

  // 各分店每日出貨量
  const outByStoreByDay = branchStores.map(s =>
    days.map(d =>
      transactions.filter(t =>
        t.type === 'out' &&
        t.created_at &&
        new Date(t.created_at).toDateString() === d.toDateString() &&
        t.to === s.name
      ).reduce((sum, t) => sum + t.qty, 0)
    )
  );

  // 趨勢折線圖
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: branchStores.map((s, i) => ({
        label: s.name,
        data: outByStoreByDay[i],
        borderColor: seriesColors[i],
        backgroundColor: seriesColors[i] + '18',
        pointBackgroundColor: seriesColors[i],
        borderWidth: 2, pointRadius: 3, tension: .35,
        fill: false,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
      },
    },
  });
  document.getElementById('trendLegend').innerHTML = branchStores.map((s, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${seriesColors[i]}"></div>${s.name}</div>`
  ).join('');

  // 本週各分店出貨量（圓餅）
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekOut = branchStores.map(s =>
    transactions.filter(t =>
      t.type === 'out' && t.created_at &&
      new Date(t.created_at) >= weekStart && t.to === s.name
    ).reduce((sum, t) => sum + t.qty, 0)
  );
  const weekTotal = weekOut.reduce((a, v) => a + v, 0);

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: {
      labels: branchStores.map(s => s.name),
      datasets: [{
        data: weekOut,
        backgroundColor: branchStores.map(s => s.color),
        borderWidth: 3,
        borderColor: '#0d1117',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '58%',
      plugins: { legend: { display: false } },
      layout: { padding: 10 },
    },
  });
  document.getElementById('pieLegend').innerHTML = branchStores.map((s, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${s.color}"></div>${s.name} <strong style="color:var(--text)">${weekTotal ? Math.round(weekOut[i] / weekTotal * 100) : 0}%</strong></div>`
  ).join('');

  // 分店每日出貨長條圖
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: branchStores.map((s, i) => ({
        label: s.name,
        data: outByStoreByDay[i],
        backgroundColor: seriesColors[i] + 'cc',
        borderRadius: 4,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
      },
    },
  });
}

/* ═══════════════════ PRODUCT MODAL ═══════════════════ */
function openAddProd() {
  editingProdId = null;
  document.getElementById('prodModalTitle').textContent = '➕ 新增品項';
  ['fName', 'fUnit', 'fSupplier', 'fContact'].forEach(id => document.getElementById(id).value = '');
  ['fQty', 'fThr'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('prodModal').classList.add('open');
}

function openEditProd(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editingProdId = id;
  document.getElementById('prodModalTitle').textContent = '✏️ 編輯：' + p.name;
  document.getElementById('fName').value     = p.name;
  document.getElementById('fQty').value      = p.stock[STORES.find(s => s.type === 'warehouse')?.id] || 0;
  document.getElementById('fThr').value      = p.threshold[STORES.find(s => s.type === 'warehouse')?.id] || 0;
  document.getElementById('fUnit').value     = p.unit;
  document.getElementById('fSupplier').value = p.supplier || '';
  document.getElementById('fContact').value  = p.supplierContact || '';
  document.getElementById('prodModal').classList.add('open');
}

function closeProdModal() { document.getElementById('prodModal').classList.remove('open'); }

async function saveProd() {
  const name = document.getElementById('fName').value.trim();
  const qty  = parseInt(document.getElementById('fQty').value) || 0;
  const thr  = parseInt(document.getElementById('fThr').value) || 0;
  if (!name) { toast('請填寫品名', '#ef4444'); return; }

  const unit     = document.getElementById('fUnit').value.trim() || '件';
  const supplier = document.getElementById('fSupplier').value.trim();
  const contact  = document.getElementById('fContact').value.trim();

  try {
    if (editingProdId !== null) {
      await dbUpdateProduct(editingProdId, name, unit, supplier, contact, qty, thr);
      toast('✅ 品項已更新');
    } else {
      await dbAddProduct(name, unit, supplier, contact, qty, thr);
      toast('✅ 品項已新增');
    }
    closeProdModal();
    await loadAllData();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

async function deleteProd(id) {
  const p = products.find(x => x.id === id);
  if (!confirm(`確定要刪除「${p?.name}」？`)) return;
  try {
    await dbDeleteProduct(id);
    toast('🗑️ 品項已刪除', '#f59e0b');
    await loadAllData();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

/* ═══════════════════ TRANSACTION MODAL ═══════════════════ */
function openTxModal() {
  const warehouseId = STORES.find(s => s.type === 'warehouse')?.id;
  document.getElementById('txProd').innerHTML = products.map(p =>
    `<option value="${p.id}">${p.name}（倉庫現有：${p.stock[warehouseId] ?? 0} ${p.unit}）</option>`
  ).join('');
  const storeOpts = STORES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('txFrom').innerHTML = storeOpts;
  document.getElementById('txTo').innerHTML   = storeOpts;
  const firstBranch = STORES.find(s => s.type === 'branch');
  if (firstBranch) document.getElementById('txTo').value = firstBranch.id;

  // 自動填入目前登入者姓名
  document.getElementById('txOp').value  = authGetDisplayName(currentUser);
  document.getElementById('txQty').value  = '';
  document.getElementById('txNote').value = '';
  setTxType('out');
  document.getElementById('txModal').classList.add('open');
}

function closeTxModal() { document.getElementById('txModal').classList.remove('open'); }

function setTxType(t) {
  currentTxType = t;
  document.getElementById('typeOut').className = 'tx-type-btn' + (t === 'out' ? ' active-out' : '');
  document.getElementById('typeIn').className  = 'tx-type-btn' + (t === 'in'  ? ' active-in'  : '');
  document.getElementById('fromLabel').textContent = t === 'out' ? '來源倉庫' : '供應商';
}

async function submitTx() {
  const pid  = document.getElementById('txProd').value;
  const qty  = parseInt(document.getElementById('txQty').value);
  const op   = document.getElementById('txOp').value.trim();
  const note = document.getElementById('txNote').value.trim();

  if (!qty || qty < 1 || !op) { toast('請填寫數量', '#ef4444'); return; }

  const p = products.find(x => x.id === pid);
  if (!p) return;

  const fromId = document.getElementById('txFrom').value;
  const toId   = document.getElementById('txTo').value;

  const fromName = currentTxType === 'out' ? STORES.find(s => s.id === fromId)?.name : '供應商';
  const toName   = STORES.find(s => s.id === toId)?.name || '未知';

  try {
    await dbSubmitTx({
      type: currentTxType,
      productId: pid,
      productName: p.name,
      qty, fromName, toName,
      fromStoreId: fromId,
      toStoreId: toId,
      operatorId: currentUser?.id,
      operatorName: op,
      note,
    });
    closeTxModal();
    toast(`✅ ${currentTxType === 'out' ? '出貨' : '進貨'} ${qty} ${p.unit} 已記錄`);
    await loadAllData();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

/* ═══════════════════ CONSUME TAB ═══════════════════ */
function renderConsume() {
  const branches = STORES.filter(s => s.type === 'branch');
  if (!consumeStoreFilter) consumeStoreFilter = branches[0]?.id;
  const selectedStore = STORES.find(s => s.id === consumeStoreFilter);

  // 分店選擇器
  document.getElementById('consumeStoreSelector').innerHTML = branches.map(s => {
    const isActive = s.id === consumeStoreFilter;
    const style = isActive
      ? `background:${s.color}22;border-color:${s.color}55;color:${s.color}`
      : '';
    return `<button class="consume-store-btn${isActive ? ' active' : ''}" style="${style}" onclick="setConsumeStore(${s.id})">${s.name}</button>`;
  }).join('');

  // 品項列表
  if (!products.length) {
    document.getElementById('consumeProdList').innerHTML = '<div class="empty-state">尚無品項</div>';
  } else {
    document.getElementById('consumeProdList').innerHTML = products.map(p => {
      const qty = stockOf(p, consumeStoreFilter);
      const w   = Math.min(100, pctOf(p, consumeStoreFilter) * 100).toFixed(1);
      const cls = barCls(p, consumeStoreFilter);
      const qtyColor = cls === 'bar-danger' ? 'var(--red)' : cls === 'bar-warn' ? 'var(--yellow)' : 'var(--green)';
      return `
        <div class="consume-prod-row">
          <div class="consume-prod-info">
            <div class="consume-prod-name">${p.name}</div>
            <div class="consume-prod-stock">
              <div class="bar-track consume-mini-bar"><div class="bar-fill ${cls}" style="width:${w}%"></div></div>
              <span style="color:${qtyColor};font-family:var(--font-mono);font-size:12px">${qty} ${p.unit}</span>
            </div>
          </div>
          <button class="consume-btn" onclick="openConsumeModal('${p.id}', ${consumeStoreFilter})">消耗</button>
        </div>`;
    }).join('');
  }

  // 此分店的消耗記錄
  const storeConsumeHistory = transactions
    .filter(t => t.type === 'consume' && t.from === selectedStore?.name)
    .slice(0, 20);
  document.getElementById('consumeTxList').innerHTML = storeConsumeHistory.length
    ? storeConsumeHistory.map(txHtml).join('')
    : '<div class="empty-state">此店鋪尚無消耗記錄</div>';
}

function setConsumeStore(sid) {
  consumeStoreFilter = sid;
  renderConsume();
}

/* ── 消耗 Modal ── */
function setConsumeMode(mode) {
  consumeInputMode = mode;
  document.getElementById('cModeDelta').className  = 'tx-type-btn' + (mode === 'delta'  ? ' active-consume' : '');
  document.getElementById('cModeRemain').className = 'tx-type-btn' + (mode === 'remain' ? ' active-consume' : '');
  document.getElementById('cQtyLabel').textContent = mode === 'remain' ? '剩餘數量 *' : '消耗數量 *';
  document.getElementById('cQty').value = '';
  updateConsumeStockHint();
}

function openConsumeModal(prodId = null, storeId = null) {
  const branches = STORES.filter(s => s.type === 'branch');

  document.getElementById('cProd').innerHTML = products.map(p =>
    `<option value="${p.id}"${p.id === prodId ? ' selected' : ''}>${p.name}</option>`
  ).join('');

  document.getElementById('cStore').innerHTML = branches.map(s =>
    `<option value="${s.id}"${s.id === storeId ? ' selected' : ''}>${s.name}</option>`
  ).join('');

  document.getElementById('cQty').value  = '';
  document.getElementById('cNote').value = '';
  document.getElementById('cOp').value   = authGetDisplayName(currentUser);

  setConsumeMode('delta');
  updateConsumeStockHint();
  document.getElementById('consumeModal').classList.add('open');
}

function closeConsumeModal() {
  document.getElementById('consumeModal').classList.remove('open');
}

function updateConsumeStockHint() {
  const pid  = document.getElementById('cProd').value;
  const sid  = document.getElementById('cStore').value;
  const p    = products.find(x => x.id === pid);
  const hint = document.getElementById('cCurrentStock');
  if (p && sid) {
    const qty = stockOf(p, sid);
    const thr = thrOf(p, sid);
    const color = qty < thr ? 'var(--red)' : qty < thr * 1.2 ? 'var(--yellow)' : 'var(--muted)';
    hint.style.color = color;

    if (consumeInputMode === 'remain') {
      const remainInput = parseInt(document.getElementById('cQty').value);
      if (!isNaN(remainInput) && remainInput >= 0) {
        const consumed = qty - remainInput;
        const consumeColor = consumed > 0 ? 'var(--purple)' : consumed < 0 ? 'var(--red)' : 'var(--muted)';
        hint.innerHTML = `目前庫存：${qty} ${p.unit}（安全水位 ${thr} ${p.unit}）`
          + `<br><span style="color:${consumeColor}">→ 將記錄消耗：${consumed >= 0 ? consumed : '⚠ 輸入值超過現有庫存'} ${consumed >= 0 ? p.unit : ''}</span>`;
      } else {
        hint.textContent = `目前庫存：${qty} ${p.unit}（安全水位 ${thr} ${p.unit}）`;
      }
    } else {
      hint.textContent = `目前庫存：${qty} ${p.unit}（安全水位 ${thr} ${p.unit}）`;
    }
  } else {
    hint.textContent = '';
  }
}

async function submitConsume() {
  const pid       = document.getElementById('cProd').value;
  const sid       = document.getElementById('cStore').value;
  const inputVal  = parseInt(document.getElementById('cQty').value);
  const op        = document.getElementById('cOp').value.trim();
  const note      = document.getElementById('cNote').value.trim();

  if (isNaN(inputVal) || inputVal < 0) { toast('請輸入數量', '#ef4444'); return; }
  if (!op)                              { toast('請填寫操作人員', '#ef4444'); return; }

  const p = products.find(x => x.id === pid);
  const s = STORES.find(x => x.id === sid);
  if (!p || !s) return;

  let qty;
  if (consumeInputMode === 'remain') {
    const current = stockOf(p, sid);
    qty = current - inputVal;
    if (qty < 0) { toast(`剩餘量（${inputVal}）超過現有庫存（${current} ${p.unit}）`, '#ef4444'); return; }
    if (qty === 0 && inputVal === current) { toast('剩餘量與現有庫存相同，無需記錄', '#f59e0b'); return; }
  } else {
    qty = inputVal;
  }

  if (qty < 1) { toast('消耗數量必須大於 0', '#ef4444'); return; }

  try {
    await dbSubmitTx({
      type: 'consume',
      productId: pid,
      productName: p.name,
      qty,
      fromName: s.name,
      toName: '',
      fromStoreId: sid,
      toStoreId: sid,
      operatorId: currentUser?.id,
      operatorName: op,
      note,
    });
    closeConsumeModal();
    const modeNote = consumeInputMode === 'remain' ? `（剩餘 ${inputVal} ${p.unit}）` : '';
    toast(`✅ 消耗 ${qty} ${p.unit} 已記錄${modeNote}`);
    await loadAllData();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

/* ═══════════════════ STAFF TAB ═══════════════════ */
async function renderStaff() {
  document.getElementById('staffInviteList').innerHTML = '<div class="empty-state">載入中…</div>';
  document.getElementById('staffMemberList').innerHTML = '<div class="empty-state">載入中…</div>';

  try {
    const [employees, invites] = await Promise.all([dbLoadEmployees(), dbLoadInvites()]);

    // 邀請連結列表
    const invEl = document.getElementById('staffInviteList');
    if (!invites.length) {
      invEl.innerHTML = '<div class="empty-state">目前沒有有效邀請連結</div>';
    } else {
      invEl.innerHTML = invites.map(inv => {
        const link = location.origin + location.pathname + '?invite=' + inv.token;
        const exp  = new Date(inv.expires_at).toLocaleDateString('zh-TW');
        const roleLabel = { owner: '老闆', admin: '管理者', staff: '員工' }[inv.role] || inv.role;
        return `
          <div class="staff-invite-row">
            <div>
              <span class="role-badge ${inv.role === 'staff' ? 'role-staff' : 'role-admin'}">${roleLabel}</span>
              <span class="staff-invite-exp">到期：${exp}</span>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="copyInviteLink('${link}')">📋 複製連結</button>
          </div>`;
      }).join('');
    }

    // 成員列表
    const memEl = document.getElementById('staffMemberList');
    memEl.innerHTML = employees.map(emp => {
      const isSelf = emp.id === currentUser.id;
      const roleLabel = { owner: '老闆', admin: '管理者', staff: '員工' }[emp.role] || emp.role;
      const badgeCls  = (emp.role === 'owner' || emp.role === 'admin') ? 'role-admin' : 'role-staff';
      return `
        <div class="staff-member-row">
          <div class="staff-member-info">
            <div class="staff-member-name">${emp.display_name || '—'}${isSelf ? ' <span style="color:var(--dim);font-size:11px">（你）</span>' : ''}</div>
            <div class="staff-member-email">${emp.email || ''}</div>
          </div>
          <div class="staff-member-actions">
            ${!isSelf && emp.role !== 'owner' ? `
              <select class="staff-role-select" onchange="updateEmpRole('${emp.id}', this.value)">
                <option value="admin"  ${emp.role === 'admin'  ? 'selected' : ''}>管理者</option>
                <option value="staff"  ${emp.role === 'staff'  ? 'selected' : ''}>員工</option>
              </select>
              <button class="btn btn-secondary btn-sm btn-danger" onclick="removeEmp('${emp.id}', '${emp.display_name || emp.email}')">移除</button>
            ` : `<span class="role-badge ${badgeCls}">${roleLabel}</span>`}
          </div>
        </div>`;
    }).join('');

  } catch (e) {
    toast('載入失敗：' + e.message, '#ef4444');
  }
}

async function generateInvite(role) {
  try {
    const inv  = await dbCreateInvite(role);
    const link = location.origin + location.pathname + '?invite=' + inv.token;
    copyInviteLink(link);
    toast('✅ 邀請連結已複製到剪貼簿（7 天有效）');
    renderStaff();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

function copyInviteLink(link) {
  navigator.clipboard?.writeText(link).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
  toast('✅ 邀請連結已複製');
}

async function updateEmpRole(userId, role) {
  try {
    await dbUpdateEmployeeRole(userId, role);
    toast('✅ 權限已更新');
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
    renderStaff();
  }
}

async function removeEmp(userId, name) {
  if (!confirm(`確定要移除「${name}」的系統存取權？`)) return;
  try {
    await dbRemoveEmployee(userId);
    toast('🗑️ 已移除');
    renderStaff();
  } catch (e) {
    toast('❌ ' + e.message, '#ef4444');
  }
}

/* ─── 邀請連結登入（?invite=token 偵測） ─── */
async function checkInviteParam() {
  const token = new URLSearchParams(location.search).get('invite');
  if (!token) return false;

  const inv = await dbValidateInvite(token).catch(() => null);
  if (!inv) {
    document.getElementById('loginError').textContent = '邀請連結無效或已過期';
    return false;
  }

  // 切換到員工註冊表單
  const orgName   = inv.organizations?.name || '所在系統';
  const roleLabel = { staff: '員工', admin: '管理者' }[inv.role] || inv.role;
  document.getElementById('inviteOrgName').textContent  = `您受邀加入「${orgName}」，身份：${roleLabel}`;
  document.getElementById('inviteToken').value          = token;
  document.getElementById('inviteOrgId').value          = inv.org_id;
  document.getElementById('inviteRole').value           = inv.role;
  showLoginTab('invite');
  return true;
}

async function doRegisterInvite() {
  const name    = document.getElementById('inviteName').value.trim();
  const email   = document.getElementById('inviteEmail').value.trim();
  const pass    = document.getElementById('invitePass').value;
  const token   = document.getElementById('inviteToken').value;
  const orgId   = document.getElementById('inviteOrgId').value;
  const role    = document.getElementById('inviteRole').value;
  const errEl   = document.getElementById('inviteError');
  const btn     = document.getElementById('inviteBtn');

  if (!name || !email || !pass) { errEl.textContent = '請填寫所有欄位'; return; }
  if (pass.length < 6)          { errEl.textContent = '密碼至少 6 個字元'; return; }

  btn.disabled = true; btn.textContent = '註冊中…'; errEl.textContent = '';
  try {
    await authSignUp(email, pass, {
      display_name: name, org_id: orgId, role, invite_token: token,
    });
    toast('✅ 註冊成功！請用剛設定的帳號密碼登入');
    showLoginTab('login');
    history.replaceState({}, '', location.pathname);
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = '加入系統';
  }
}

/* ─── 新老闆自助註冊 ─── */
async function doRegisterOwner() {
  const orgName     = document.getElementById('regOrgName').value.trim();
  const displayName = document.getElementById('regName').value.trim();
  const email       = document.getElementById('regEmail').value.trim();
  const pass        = document.getElementById('regPass').value;
  const errEl       = document.getElementById('regError');
  const btn         = document.getElementById('regBtn');

  if (!orgName || !displayName || !email || !pass) { errEl.textContent = '請填寫所有欄位'; return; }
  if (pass.length < 6) { errEl.textContent = '密碼至少 6 個字元'; return; }

  btn.disabled = true; btn.textContent = '建立中…'; errEl.textContent = '';
  try {
    const { user } = await authSignUp(email, pass, { display_name: displayName });
    if (!user) throw new Error('註冊失敗，請重試');
    await dbCreateOrg(orgName, user.id, displayName, email);
    toast('✅ 系統建立成功！請用剛設定的帳號密碼登入');
    showLoginTab('login');
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = '建立我的系統';
  }
}

function showLoginTab(tab) {
  ['login', 'register', 'invite'].forEach(t => {
    document.getElementById('lTab-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('lBtn-' + t)?.classList.toggle('active', t === tab);
  });
}

/* ═══════════════════ IMPORT (Excel / CSV) ═══════════════════ */
function downloadImportTemplate() {
  const csv = '﻿品名,單位,倉庫庫存,安全水位,供應商,聯絡電話\n鮮蚵（生）,公斤,50,20,大西水產,02-1234-5678\n花枝,公斤,30,15,大西水產,02-1234-5678';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = '品項匯入範本.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function openImportModal() {
  importRows = [];
  document.getElementById('importFile').value = '';
  document.getElementById('importFileName').textContent = '';
  document.getElementById('importPreviewSection').style.display = 'none';
  document.getElementById('importError').style.display = 'none';
  const btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.style.opacity = '0.4';
  btn.textContent = '✅ 確認匯入';
  document.getElementById('importModal').classList.add('open');

  if (!window.XLSX) {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    document.head.appendChild(s);
    await new Promise((ok, fail) => { s.onload = ok; s.onerror = fail; });
  }
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('open');
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('importFileName').textContent = file.name;
  document.getElementById('importError').style.display = 'none';
  document.getElementById('importPreviewSection').style.display = 'none';
  importRows = [];

  try {
    const ab  = await file.arrayBuffer();
    const wb  = XLSX.read(ab, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (raw.length < 2) throw new Error('檔案沒有資料（至少需要標題行 + 一筆資料）');

    const header = raw[0].map(h => String(h).trim());
    const col = k => header.findIndex(h => h.includes(k));
    const colMap = {
      name:            Math.max(col('品名'), col('name')),
      unit:            col('單位'),
      warehouseQty:    Math.max(col('倉庫庫存'), col('庫存')),
      warehouseThr:    Math.max(col('安全水位'), col('水位')),
      supplier:        col('供應商'),
      supplierContact: Math.max(col('聯絡'), col('電話')),
    };

    if (colMap.name < 0)
      throw new Error('找不到「品名」欄位，請使用範本格式');

    const rows = [], errors = [];
    for (let i = 1; i < raw.length; i++) {
      const r    = raw[i];
      const name = String(r[colMap.name] ?? '').trim();
      if (!name) continue;
      if (!name) { errors.push(`第 ${i + 1} 列：缺少品名`); continue; }
      rows.push({
        name,
        unit:            colMap.unit >= 0            ? String(r[colMap.unit] || '件').trim() : '件',
        warehouseQty:    colMap.warehouseQty >= 0    ? parseInt(r[colMap.warehouseQty]) || 0 : 0,
        warehouseThr:    colMap.warehouseThr >= 0    ? parseInt(r[colMap.warehouseThr]) || 0 : 0,
        supplier:        colMap.supplier >= 0        ? String(r[colMap.supplier] || '').trim() : '',
        supplierContact: colMap.supplierContact >= 0 ? String(r[colMap.supplierContact] || '').trim() : '',
      });
    }

    importRows = rows;
    _renderImportPreview(rows, errors);
  } catch (e) {
    const el = document.getElementById('importError');
    el.textContent = '解析失敗：' + e.message;
    el.style.display = 'block';
  }
}

function _renderImportPreview(rows, errors) {
  const errorEl  = document.getElementById('importError');
  const confirmBtn = document.getElementById('importConfirmBtn');

  if (!rows.length) {
    errorEl.textContent = errors.length ? errors.join('\n') : '沒有可匯入的資料';
    errorEl.style.display = 'block';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.4';
    return;
  }

  const preview = rows.slice(0, 5);
  document.getElementById('importPreviewTable').innerHTML = `
    <table class="import-table">
      <thead><tr><th>品名</th><th>單位</th><th>倉庫庫存</th><th>安全水位</th><th>供應商</th></tr></thead>
      <tbody>${preview.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${r.unit}</td>
          <td>${r.warehouseQty}</td>
          <td>${r.warehouseThr}</td>
          <td>${r.supplier}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('importSummary').textContent =
    `共 ${rows.length} 筆品項` + (rows.length > 5 ? '（預覽前 5 筆）' : '');
  document.getElementById('importPreviewSection').style.display = 'block';

  if (errors.length) {
    errorEl.textContent = '⚠ ' + errors.join(' | ');
    errorEl.style.display = 'block';
  } else {
    errorEl.style.display = 'none';
  }

  confirmBtn.disabled = false;
  confirmBtn.style.opacity = '1';
}

async function confirmImport() {
  if (!importRows.length) return;
  const btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.textContent = '匯入中…';
  try {
    const count = await dbBatchImportProducts(importRows);
    closeImportModal();
    toast(`✅ 成功匯入 ${count} 筆品項`);
    await loadAllData();
  } catch (e) {
    const el = document.getElementById('importError');
    el.textContent = '匯入失敗：' + e.message;
    el.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '✅ 確認匯入';
  }
}

/* ═══════════════════ INIT ═══════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 先檢查是否有邀請連結
    const hasInvite = await checkInviteParam().catch(() => false);

    const session = await authGetSession();
    if (session?.user && !hasInvite) {
      currentUser = session.user;
      showApp();
    }
  } catch (e) {
    const el = document.getElementById('loginError');
    if (el) el.textContent = '連線失敗：' + (e.message || '請重新整理');
  }

  // Enter 鍵送出登入
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('loginEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
  });

  // 點擊 overlay 背景關閉 modal
  ['prodModal', 'txModal', 'consumeModal', 'importModal', 'onboardingOverlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) document.getElementById(id).classList.remove('open');
    });
  });

  // 即時同步：debounce 600ms 防止連發，silent 不亮 loading bar
  function scheduleSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => loadAllData(true), 600);
  }
  if (sb) {
    sb.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' },    scheduleSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, scheduleSync)
      .subscribe();
  }

  // 登入 token 到期自動登出（守衛：手動登出已清 currentUser，避免重複觸發）
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && currentUser) doLogout();
  });
});
