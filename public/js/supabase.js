/* ═══════════════════════════════════════════
   大西庫存管理系統 — Supabase 設定
   ═══════════════════════════════════════════ */

const SUPABASE_URL = 'https://cgogniiofjokmwkdgqrp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oZZbpVqu2adeIa38oJifmA_qBxcGC8t';

if (!window.supabase) {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('loginError');
    if (el) el.textContent = 'Supabase 套件載入失敗，請重新整理或檢查網路';
  });
}
const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

// 目前登入的 org（設定後所有 insert 自動帶入）
let _orgId = null;
function setOrgContext(orgId) { _orgId = orgId; }

/* ── 讀取使用者 Profile（含 org_id、role） ── */
async function dbLoadProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('id, org_id, role, display_name, email')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data; // null = 尚未設定組織
}

/* ── 讀取分店（動態，依 org RLS 自動過濾） ── */
async function dbLoadStores() {
  const { data, error } = await sb
    .from('stores')
    .select('id, name, type, color, bg')
    .order('type', { ascending: false }) // warehouse 優先
    .order('id');
  if (error) throw error;
  return data.map(s => ({
    id:    s.id,
    name:  s.name,
    type:  s.type,
    color: s.color || '#378ADD',
    bg:    s.bg    || '#E6F1FB',
  }));
}

/* ── 讀取品項（含各分店庫存） ── */
async function dbLoadProducts() {
  const { data, error } = await sb
    .from('products')
    .select('*, inventory(store_id, qty, threshold)')
    .order('name');
  if (error) throw error;
  return data.map(p => ({
    id:              p.id,
    name:            p.name,
    unit:            p.unit || '件',
    supplier:        p.supplier || '',
    supplierContact: p.supplier_contact || '',
    stock:     Object.fromEntries((p.inventory || []).map(i => [i.store_id, i.qty])),
    threshold: Object.fromEntries((p.inventory || []).map(i => [i.store_id, i.threshold])),
  }));
}

/* ── 讀取異動記錄（最新 100 筆） ── */
async function dbLoadTransactions() {
  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map(t => ({
    id:         t.id,
    created_at: t.created_at,
    time: new Date(t.created_at).toLocaleTimeString('zh-TW', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }),
    type:       t.type,
    product:    t.product_name,
    product_id: t.product_id,
    qty:        t.qty,
    from:       t.from_name || '',
    to:         t.to_name   || '',
    operator:   t.operator_name,
    note:       t.note || '',
  }));
}

/* ── 新增品項 ── */
async function dbAddProduct(name, unit, supplier, supplierContact, warehouseQty, warehouseThr) {
  const { data: prod, error: pe } = await sb
    .from('products')
    .insert({ name, unit, supplier, supplier_contact: supplierContact, org_id: _orgId })
    .select('id')
    .single();
  if (pe) throw pe;

  const warehouseId = STORES.find(s => s.type === 'warehouse')?.id;
  const rows = STORES.map(s => ({
    product_id: prod.id,
    store_id:   s.id,
    qty:        s.id === warehouseId ? warehouseQty : 0,
    threshold:  s.id === warehouseId ? warehouseThr : Math.round(warehouseThr * 0.4),
    org_id:     _orgId,
  }));
  const { error: ie } = await sb.from('inventory').insert(rows);
  if (ie) throw ie;
  return prod.id;
}

/* ── 更新品項 ── */
async function dbUpdateProduct(id, name, unit, supplier, supplierContact, warehouseQty, warehouseThr) {
  const { error: pe } = await sb
    .from('products')
    .update({ name, unit, supplier, supplier_contact: supplierContact })
    .eq('id', id);
  if (pe) throw pe;

  const warehouseId = STORES.find(s => s.type === 'warehouse')?.id;
  const { error: ie } = await sb.from('inventory')
    .upsert({ product_id: id, store_id: warehouseId, qty: warehouseQty, threshold: warehouseThr, org_id: _orgId });
  if (ie) throw ie;
}

/* ── 刪除品項 ── */
async function dbDeleteProduct(id) {
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) throw error;
}

/* ── 批次匯入品項 ── */
async function dbBatchImportProducts(rows) {
  const { data: prods, error: pe } = await sb
    .from('products')
    .insert(rows.map(r => ({
      name: r.name, unit: r.unit || '件',
      supplier: r.supplier || '', supplier_contact: r.supplierContact || '',
      org_id: _orgId,
    })))
    .select('id');
  if (pe) throw pe;

  const warehouseId = STORES.find(s => s.type === 'warehouse')?.id;
  const inventoryRows = [];
  prods.forEach((prod, i) => {
    const row = rows[i];
    STORES.forEach(s => {
      inventoryRows.push({
        product_id: prod.id,
        store_id:   s.id,
        qty:        s.id === warehouseId ? (row.warehouseQty || 0) : 0,
        threshold:  s.id === warehouseId ? (row.warehouseThr || 0) : Math.round((row.warehouseThr || 0) * 0.4),
        org_id:     _orgId,
      });
    });
  });

  const { error: ie } = await sb.from('inventory').insert(inventoryRows);
  if (ie) throw ie;
  return prods.length;
}

/* ── 提交異動 ── */
async function dbSubmitTx({ type, productId, productName, qty, fromName, toName, fromStoreId, toStoreId, operatorId, operatorName, note }) {

  async function getQty(storeId) {
    const { data, error } = await sb
      .from('inventory').select('qty')
      .eq('product_id', productId).eq('store_id', storeId).single();
    if (error) throw error;
    return data.qty || 0;
  }

  async function setQty(storeId, newQty) {
    const { error } = await sb.from('inventory')
      .update({ qty: newQty })
      .eq('product_id', productId).eq('store_id', storeId);
    if (error) throw error;
  }

  if (type === 'consume') {
    const fromQty = await getQty(fromStoreId);
    await setQty(fromStoreId, Math.max(0, fromQty - qty));
  } else if (type === 'out') {
    const fromQty = await getQty(fromStoreId);
    const toQty   = await getQty(toStoreId);
    await setQty(fromStoreId, Math.max(0, fromQty - qty));
    await setQty(toStoreId, toQty + qty);
  } else {
    const toQty = await getQty(toStoreId);
    await setQty(toStoreId, toQty + qty);
  }

  const { error: te } = await sb.from('transactions').insert({
    type, product_id: productId, product_name: productName, qty,
    from_name: fromName, to_name: toName,
    operator_id: operatorId, operator_name: operatorName,
    note: note || '', org_id: _orgId,
  });
  if (te) throw te;
}

/* ── 新增分店 ── */
async function dbAddStore(name, type, color, bg) {
  const { data: store, error } = await sb
    .from('stores')
    .insert({ org_id: _orgId, name, type, color, bg })
    .select('id')
    .single();
  if (error) throw error;

  // 為所有現有品項建立庫存記錄（數量 0），用 upsert 避免重複 key 錯誤
  const { data: prods } = await sb.from('products').select('id');
  if (prods?.length) {
    await sb.from('inventory').upsert(
      prods.map(p => ({ product_id: p.id, store_id: store.id, qty: 0, threshold: 0, org_id: _orgId })),
      { onConflict: 'product_id,store_id', ignoreDuplicates: true }
    );
  }
  return store.id;
}

/* ── 刪除分店 ── */
async function dbDeleteStore(id) {
  const { error } = await sb.from('stores').delete().eq('id', id);
  if (error) throw error;
}

/* ══════════════════════════════════════════════
   組織管理
   ══════════════════════════════════════════════ */

/* ── 建立新組織（新客戶自助註冊） ── */
async function dbCreateOrg(orgName, userId, displayName, email) {
  const { data: org, error: oe } = await sb
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single();
  if (oe) throw oe;

  const { error: pe } = await sb
    .from('profiles')
    .insert({ id: userId, org_id: org.id, role: 'owner', display_name: displayName, email });
  if (pe) throw pe;

  // 預設建立一個總倉
  const { error: se } = await sb
    .from('stores')
    .insert({ org_id: org.id, name: orgName + ' 總倉', type: 'warehouse', color: '#F97316', bg: '#FFF3E8' });
  if (se) throw se;

  return org.id;
}

/* ══════════════════════════════════════════════
   員工管理
   ══════════════════════════════════════════════ */

async function dbLoadEmployees() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, role, display_name, email, created_at')
    .order('created_at');
  if (error) throw error;
  return data;
}

async function dbUpdateEmployeeRole(userId, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

async function dbRemoveEmployee(userId) {
  const { error } = await sb.from('profiles').delete().eq('id', userId);
  if (error) throw error;
}

/* ══════════════════════════════════════════════
   邀請連結
   ══════════════════════════════════════════════ */

async function dbCreateInvite(role = 'staff') {
  const { data, error } = await sb
    .from('invites')
    .insert({ org_id: _orgId, role })
    .select('token, expires_at, role')
    .single();
  if (error) throw error;
  return data;
}

async function dbLoadInvites() {
  const { data, error } = await sb
    .from('invites')
    .select('id, token, role, expires_at, created_at')
    .is('used_by', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function dbValidateInvite(token) {
  const { data, error } = await sb
    .from('invites')
    .select('id, org_id, role, expires_at, organizations(name)')
    .eq('token', token)
    .is('used_by', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ══════════════════════════════════════════════
   Auth
   ══════════════════════════════════════════════ */

async function authGetSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function authSignIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function authSignOut() {
  await sb.auth.signOut();
}

async function authSignUp(email, password, metadata = {}) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: metadata } });
  if (error) throw error;
  return data;
}

function authGetDisplayName(user) {
  return user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email?.split('@')[0]
    || '使用者';
}

function authGetRole(user) {
  // fallback for pre-migration accounts
  return user?.app_metadata?.role || user?.user_metadata?.role || 'admin';
}
