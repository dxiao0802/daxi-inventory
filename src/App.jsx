/**
 * 大西庫存管理系統 v2.0
 * 功能：庫存總覽、圖表分析、進出貨調貨、品項管理
 * 套件：@supabase/supabase-js, recharts
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts'
import { supabase } from './lib/supabase'

// ─────────────────────────────────────────
// 顏色設定
// ─────────────────────────────────────────
const COLORS = {
  '大西倉庫': '#f97316',
  '士捷分店': '#3b82f6',
  '石牌分店': '#8b5cf6',
  '旗艦分店': '#10b981',
}
const COLOR_LIST = ['#f97316','#3b82f6','#8b5cf6','#10b981','#f43f5e','#06b6d4']

function getStatus(pct) {
  if (pct < 40) return { label: '嚴重不足', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', pulse: true }
  if (pct < 75) return { label: '庫存偏低', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', pulse: false }
  return { label: '正常', color: '#10b981', bg: 'rgba(16,185,129,0.15)', pulse: false }
}

// ─────────────────────────────────────────
// CSS-in-JS 全域樣式
// ─────────────────────────────────────────
const G = {
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: '18px 20px',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#f1f5f9',
    padding: '8px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  },
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 5 },
  btn: {
    padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#f1f5f9',
  },
  btnPrimary: {
    padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit',
    background: 'linear-gradient(135deg,#f97316,#ea580c)',
    border: 'none', color: '#fff', fontWeight: 600,
  },
  btnDanger: {
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: 11, fontFamily: 'inherit',
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444',
  },
}

// ─────────────────────────────────────────
// StockBar 進度條
// ─────────────────────────────────────────
function StockBar({ qty, threshold, height = 6 }) {
  const pct = Math.min(100, Math.round((qty / (threshold || 1)) * 100))
  const st = getStatus(pct)
  return (
    <div style={{ position: 'relative', height, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, height: '100%',
        width: `${pct}%`, background: st.color, borderRadius: 99,
        transition: 'width .5s ease',
        animation: st.pulse ? 'pulseBar 1.4s ease-in-out infinite' : 'none',
      }} />
    </div>
  )
}

// ─────────────────────────────────────────
// Modal 通用元件
// ─────────────────────────────────────────
function Modal({ title, onClose, onSave, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: '#151b27', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 18, padding: 28, width: '100%', maxWidth: 480,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
          <button onClick={onClose} style={{ ...G.btn, padding: '4px 10px', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={G.btn}>取消</button>
          <button onClick={onSave} style={G.btnPrimary}>確認儲存</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// 缺貨快報
// ─────────────────────────────────────────
function ShortageBar({ shortage }) {
  const entries = Object.entries(shortage)
  if (!entries.length) return (
    <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#10b981' }}>
      ✅ 所有分店庫存正常
    </div>
  )
  return (
    <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: '.08em', marginBottom: 10 }}>分店缺貨快報</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {entries.map(([loc, items]) => (
          <div key={loc} style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: '5px 12px', fontSize: 12, display: 'flex', gap: 6 }}>
            <span style={{ color: COLORS[loc] || '#94a3b8', fontWeight: 600 }}>{loc}</span>
            <span style={{ color: '#64748b' }}>缺：</span>
            <span style={{ color: '#fca5a5' }}>{items.join('、')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// 異動表單 Modal
// ─────────────────────────────────────────
function TxModal({ onClose, onSubmit, locations, products }) {
  const [type, setType] = useState('outbound')
  const [form, setForm] = useState({ productId: '', fromId: '', toId: '', qty: '', operator: '', note: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const warehouses = locations.filter(l => l.type === 'warehouse')
  const branches = locations.filter(l => l.type === 'branch')

  const handleSave = () => {
    if (!form.productId || !form.qty || parseInt(form.qty) < 1) { alert('請填寫品項與數量'); return }
    if (type !== 'inbound' && !form.fromId) { alert('請選擇來源'); return }
    if (type !== 'outbound' && !form.toId) { alert('請選擇目的地'); return }
    onSubmit({ type, ...form, qty: parseInt(form.qty) })
    onClose()
  }

  const typeLabels = { inbound: '進貨入倉', outbound: '出貨領料', transfer: '分店調貨' }
  const sel = { ...G.input }

  return (
    <Modal title="新增異動單" onClose={onClose} onSave={handleSave}>
      {/* 類型切換 */}
      <div style={{ display: 'flex', gap: 8 }}>
        {Object.entries(typeLabels).map(([k, v]) => (
          <button key={k} onClick={() => setType(k)} style={{
            flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: type === k ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${type === k ? '#f97316' : 'rgba(255,255,255,0.08)'}`,
            color: type === k ? '#f97316' : '#64748b',
          }}>{v}</button>
        ))}
      </div>

      {/* 品項 */}
      <div>
        <label style={G.label}>品項 *</label>
        <select value={form.productId} onChange={e => set('productId', e.target.value)} style={sel}>
          <option value="">請選擇品項</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* 來源（進貨不需要）*/}
      {type !== 'inbound' && (
        <div>
          <label style={G.label}>{type === 'transfer' ? '調出地點 *' : '來源倉庫 *'}</label>
          <select value={form.fromId} onChange={e => set('fromId', e.target.value)} style={sel}>
            <option value="">請選擇</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {/* 目的地 */}
      {type !== 'outbound' && (
        <div>
          <label style={G.label}>{type === 'inbound' ? '進貨至 *' : '調入分店 *'}</label>
          <select value={form.toId} onChange={e => set('toId', e.target.value)} style={sel}>
            <option value="">請選擇</option>
            {(type === 'inbound' ? warehouses : branches).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {/* 數量 & 操作人 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={G.label}>數量 *</label>
          <input type="number" min="1" placeholder="0" value={form.qty} onChange={e => set('qty', e.target.value)} style={G.input} />
        </div>
        <div>
          <label style={G.label}>操作人員</label>
          <input placeholder="姓名" value={form.operator} onChange={e => set('operator', e.target.value)} style={G.input} />
        </div>
      </div>

      <div>
        <label style={G.label}>備註</label>
        <input placeholder="選填" value={form.note} onChange={e => set('note', e.target.value)} style={G.input} />
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────
// 品項編輯 Modal
// ─────────────────────────────────────────
function ItemModal({ onClose, onSave, locations, existing }) {
  const [name, setName] = useState(existing?.name || '')
  const [unit, setUnit] = useState(existing?.unit || '')
  const [thresholds, setThresholds] = useState(() => {
    const m = {}
    locations.forEach(l => { m[l.id] = existing?.thresholds?.[l.id] || 50 })
    return m
  })

  const handleSave = () => {
    if (!name.trim() || !unit.trim()) { alert('請填寫品項名稱與單位'); return }
    onSave({ name: name.trim(), unit: unit.trim(), thresholds })
  }

  return (
    <Modal title={existing ? `編輯：${existing.name}` : '新增品項'} onClose={onClose} onSave={handleSave}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <div>
          <label style={G.label}>品項名稱 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：蚵仔" style={G.input} />
        </div>
        <div>
          <label style={G.label}>單位 *</label>
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="例：斤" style={G.input} />
        </div>
      </div>
      <div>
        <label style={{ ...G.label, marginBottom: 10 }}>各地點安全水位</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {locations.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: COLORS[l.name] || '#94a3b8', minWidth: 80, fontWeight: 500 }}>{l.name}</span>
              <input
                type="number" min="0"
                value={thresholds[l.id] || 0}
                onChange={e => setThresholds(t => ({ ...t, [l.id]: parseInt(e.target.value) || 0 }))}
                style={{ ...G.input, width: 100 }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>{unit || '單位'}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [locations, setLocations] = useState([])
  const [products, setProducts] = useState([])
  const [inventory, setInventory] = useState([]) // rows from v_inventory_summary
  const [transactions, setTransactions] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal] = useState(null) // 'tx' | 'add-item' | { type:'edit-item', item }

  // ── 載入資料
  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: locs }, { data: prods }, { data: inv }, { data: txs }] = await Promise.all([
      supabase.from('locations').select('*').eq('is_active', true).order('type'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('v_inventory_summary').select('*'),
      supabase.from('transactions').select(`*, products(name), from_loc:from_location(name), to_loc:to_location(name)`)
        .order('created_at', { ascending: false }).limit(50),
    ])
    setLocations(locs || [])
    setProducts(prods || [])
    setInventory(inv || [])
    setTransactions(txs || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── 組成矩陣 { product_name: { location_name: row } }
  const matrix = useMemo(() => {
    const m = {}
    inventory.forEach(r => {
      if (!m[r.product_name]) m[r.product_name] = {}
      m[r.product_name][r.location_name] = r
    })
    return m
  }, [inventory])

  const productNames = useMemo(() => Object.keys(matrix), [matrix])

  const locNames = useMemo(() => {
    return locations
      .sort((a, b) => (a.type === 'warehouse' ? -1 : 1))
      .map(l => l.name)
  }, [locations])

  // ── 統計
  const stats = useMemo(() => {
    let low = 0, critical = 0
    inventory.forEach(r => {
      const p = Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100))
      if (p < 75) low++
      if (p < 40) critical++
    })
    return { low, critical }
  }, [inventory])

  const shortage = useMemo(() => {
    const map = {}
    inventory.forEach(r => {
      if (r.is_low_stock) {
        if (!map[r.location_name]) map[r.location_name] = []
        map[r.location_name].push(r.product_name)
      }
    })
    return map
  }, [inventory])

  // ── 提交異動
  const handleTxSubmit = async ({ type, productId, fromId, toId, qty, operator, note }) => {
    const warehouseId = locations.find(l => l.type === 'warehouse')?.id

    await supabase.from('transactions').insert({
      type,
      product_id: productId,
      from_location: type === 'inbound' ? null : fromId,
      to_location: type === 'outbound' ? null : toId,
      quantity: qty,
      operator: operator || null,
      note: note || null,
    })

    // 更新 inventory 快照
    if (type === 'inbound' && toId) {
      await supabase.rpc('increment_inventory', { p_location: toId, p_product: productId, p_delta: qty })
        .catch(() => updateInventoryManually(toId, productId, qty))
    } else if (type === 'outbound' && fromId) {
      await supabase.rpc('increment_inventory', { p_location: fromId, p_product: productId, p_delta: -qty })
        .catch(() => updateInventoryManually(fromId, productId, -qty))
    } else if (type === 'transfer') {
      await Promise.all([
        supabase.rpc('increment_inventory', { p_location: fromId, p_product: productId, p_delta: -qty })
          .catch(() => updateInventoryManually(fromId, productId, -qty)),
        supabase.rpc('increment_inventory', { p_location: toId, p_product: productId, p_delta: qty })
          .catch(() => updateInventoryManually(toId, productId, qty)),
      ])
    }
    load()
  }

  // rpc 失敗時的備用方案：直接 upsert
  const updateInventoryManually = async (locationId, productId, delta) => {
    const { data } = await supabase.from('inventory')
      .select('quantity').eq('location_id', locationId).eq('product_id', productId).single()
    const current = data?.quantity || 0
    await supabase.from('inventory').upsert({
      location_id: locationId,
      product_id: productId,
      quantity: Math.max(0, current + delta),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,product_id' })
  }

  // ── 新增品項
  const handleAddItem = async ({ name, unit, thresholds }) => {
    const sku = 'P-' + Date.now()
    const { data: newProduct } = await supabase.from('products')
      .insert({ sku, name, unit, avg_cost: 0, threshold: Object.values(thresholds)[0] || 50 })
      .select().single()
    if (newProduct) {
      await Promise.all(locations.map(l =>
        supabase.from('inventory').insert({
          location_id: l.id,
          product_id: newProduct.id,
          quantity: 0,
        })
      ))
    }
    setModal(null)
    load()
  }

  // ── 編輯品項
  const handleEditItem = async (productId, { name, unit, thresholds }) => {
    await supabase.from('products').update({ name, unit }).eq('id', productId)
    setModal(null)
    load()
  }

  // ── 刪除品項
  const handleDeleteItem = async (productId) => {
    if (!confirm('確定要刪除這個品項？此操作無法還原。')) return
    await supabase.from('products').update({ is_active: false }).eq('id', productId)
    load()
  }

  // ── Tab 樣式
  const tabStyle = (t) => ({
    padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
    background: tab === t ? 'rgba(249,115,22,0.15)' : 'transparent',
    border: `1px solid ${tab === t ? '#f97316' : 'transparent'}`,
    color: tab === t ? '#f97316' : '#64748b',
    fontFamily: 'inherit',
  })

  // ── 圖表資料
  const chartData = useMemo(() => {
    return productNames.map(name => {
      const row = { name }
      locNames.forEach(loc => {
        row[loc] = matrix[name]?.[loc]?.quantity || 0
      })
      return row
    })
  }, [productNames, locNames, matrix])

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#f1f5f9', fontFamily: "'IBM Plex Sans','Noto Sans TC',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        @keyframes pulseBar{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes expandRow{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        input:focus,select:focus{border-color:rgba(249,115,22,.5)!important}
        select option{background:#151b27}
      `}</style>

      {/* ── HEADER */}
      <header style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 28px',
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(13,17,23,0.98)', position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#f97316,#ea580c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🏪</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>大西庫存管理系統</div>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '.1em' }}>DAXI INVENTORY v2.0</div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {[['overview','📦 庫存總覽'],['charts','📊 圖表分析'],['tx','🔄 異動紀錄'],['items','⚙️ 品項管理']].map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>{l}</button>
          ))}
        </nav>
        <button onClick={() => setModal('tx')} style={G.btnPrimary}>＋ 新增異動</button>
      </header>

      <main style={{ padding: '22px 28px', maxWidth: 1300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 統計卡 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            { label: '品項種類', value: products.length, color: '#3b82f6' },
            { label: '分店數量', value: locations.length, color: '#8b5cf6' },
            { label: '低庫存警示', value: `${stats.low} 項`, color: stats.low > 0 ? '#f59e0b' : '#10b981', pulse: false },
            { label: '嚴重缺貨', value: `${stats.critical} 項`, color: stats.critical > 0 ? '#ef4444' : '#10b981', pulse: stats.critical > 0 },
          ].map(c => (
            <div key={c.label} style={{ ...G.card, animation: c.pulse ? 'blink 2s infinite' : 'none' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* 缺貨快報 */}
        <ShortageBar shortage={shortage} />

        {/* ════ 庫存總覽 ════ */}
        {tab === 'overview' && (
          <div style={{ ...G.card, padding: 0, overflow: 'auto' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#475569' }}>載入中...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500 }}>品項</th>
                    {locNames.map(loc => (
                      <th key={loc} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: COLORS[loc] || '#475569', fontWeight: 500 }}>{loc}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productNames.map(name => {
                    const isExp = expanded === name
                    return (
                      <>
                        <tr
                          key={name}
                          onClick={() => setExpanded(isExp ? null : name)}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: isExp ? 'rgba(249,115,22,0.03)' : 'transparent' }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, transform: isExp ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                                <path d="M2 4l4 4 4-4" stroke="#64748b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                              </svg>
                              {name}
                            </div>
                          </td>
                          {locNames.map(loc => {
                            const r = matrix[name]?.[loc]
                            if (!r) return <td key={loc} style={{ padding: '12px 14px', color: '#334155', fontSize: 12 }}>—</td>
                            const pct = Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100))
                            const st = getStatus(pct)
                            return (
                              <td key={loc} style={{ padding: '10px 14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: st.color, animation: st.pulse ? 'pulseBar 1.4s infinite' : 'none', fontWeight: st.pulse ? 600 : 400 }}>
                                    {r.quantity}{r.unit}
                                  </span>
                                  <span style={{ fontSize: 10, color: '#475569' }}>{pct}%</span>
                                </div>
                                <StockBar qty={r.quantity} threshold={r.threshold} height={5} />
                              </td>
                            )
                          })}
                        </tr>
                        {isExp && (
                          <tr key={`${name}-exp`}>
                            <td colSpan={locNames.length + 1} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ animation: 'expandRow .2s ease', background: 'rgba(255,255,255,0.02)', padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                                {/* 各店水位 */}
                                <div>
                                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, letterSpacing: '.08em' }}>各分店庫存水位</div>
                                  {locNames.map(loc => {
                                    const r = matrix[name]?.[loc]
                                    if (!r) return null
                                    const pct = Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100))
                                    const st = getStatus(pct)
                                    return (
                                      <div key={loc} style={{ marginBottom: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                          <span style={{ fontSize: 12, color: COLORS[loc] || '#94a3b8', fontWeight: 500 }}>{loc}</span>
                                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: st.bg, color: st.color, fontWeight: 600, animation: st.pulse ? 'pulseBar 1.4s infinite' : 'none' }}>{st.label}</span>
                                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>{r.quantity}/{r.threshold}{r.unit}</span>
                                          </div>
                                        </div>
                                        <StockBar qty={r.quantity} threshold={r.threshold} height={7} />
                                      </div>
                                    )
                                  })}
                                </div>
                                {/* Bar chart */}
                                <div>
                                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, letterSpacing: '.08em' }}>庫存量 vs 安全水位</div>
                                  <ResponsiveContainer width="100%" height={160}>
                                    <BarChart data={locNames.map(loc => ({ name: loc.slice(0,2), qty: matrix[name]?.[loc]?.quantity || 0, thr: matrix[name]?.[loc]?.threshold || 0 }))} barSize={18}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                      <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                                      <Bar dataKey="qty" name="庫存量" radius={[4,4,0,0]}>
                                        {locNames.map((loc, i) => <Cell key={i} fill={COLORS[loc] || COLOR_LIST[i]} />)}
                                      </Bar>
                                      <Bar dataKey="thr" name="安全水位" fill="rgba(255,255,255,0.08)" radius={[4,4,0,0]} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ════ 圖表分析 ════ */}
        {tab === 'charts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 各店整體水位卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              {locations.map(loc => {
                const rows = inventory.filter(r => r.location_name === loc.name)
                if (!rows.length) return null
                const avg = Math.round(rows.reduce((s, r) => s + Math.min(100, r.quantity / (r.threshold || 1) * 100), 0) / rows.length)
                const st = getStatus(avg)
                return (
                  <div key={loc.id} style={G.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: COLORS[loc.name] || '#f1f5f9' }}>{loc.name}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color }}>{avg}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{loc.type === 'warehouse' ? '中心倉庫' : '分店'}</div>
                    <StockBar qty={avg} threshold={100} height={8} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
                      {rows.map(r => {
                        const p = Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100))
                        const s2 = getStatus(p)
                        return (
                          <div key={r.product_name} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 5 }}>{r.product_name}</div>
                            <StockBar qty={r.quantity} threshold={r.threshold} height={5} />
                            <div style={{ fontSize: 10, color: s2.color, marginTop: 3 }}>{r.quantity}{r.unit} ({p}%)</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 大 BarChart */}
            <div style={G.card}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 16 }}>各分店品項庫存量對比</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, fontSize: 12, color: '#64748b' }}>
                {locNames.map((loc, i) => (
                  <span key={loc} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[loc] || COLOR_LIST[i], display: 'inline-block' }} />
                    {loc}
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  {locNames.map((loc, i) => (
                    <Bar key={loc} dataKey={loc} fill={COLORS[loc] || COLOR_LIST[i]} radius={[4,4,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 叫貨清單 */}
            <div style={G.card}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 14 }}>🚨 叫貨優先清單</div>
              {(() => {
                const items = inventory.filter(r => r.is_low_stock)
                  .map(r => ({ ...r, pct: Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100)) }))
                  .sort((a, b) => a.pct - b.pct)
                if (!items.length) return <div style={{ color: '#10b981', fontSize: 13 }}>✅ 目前無需叫貨</div>
                return items.map(r => {
                  const st = getStatus(r.pct)
                  const need = r.threshold - r.quantity
                  return (
                    <div key={`${r.product_name}-${r.location_name}`} style={{ borderLeft: `3px solid ${st.color}`, background: st.bg, borderRadius: '0 8px 8px 0', padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{r.product_name} <span style={{ color: COLORS[r.location_name] || '#64748b', fontSize: 12, fontWeight: 400 }}>{r.location_name}</span></div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>供應商：{r.supplier_name || '—'}　{r.supplier_phone || ''}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontFamily: 'monospace', color: st.color, fontWeight: 700 }}>剩 {r.quantity}/{r.threshold}{r.unit}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>建議叫 {need}{r.unit}</div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}

        {/* ════ 異動紀錄 ════ */}
        {tab === 'tx' && (
          <div style={{ ...G.card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['時間','類型','品項','來源','目的地','數量','備註'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr><td colSpan="7" style={{ padding: 30, textAlign: 'center', color: '#475569', fontSize: 13 }}>尚無異動紀錄</td></tr>
                ) : transactions.map(tx => {
                  const typeMap = { inbound: ['進貨', '#10b981', 'rgba(16,185,129,0.12)'], outbound: ['出貨', '#f59e0b', 'rgba(245,158,11,0.12)'], transfer: ['調貨', '#3b82f6', 'rgba(59,130,246,0.12)'] }
                  const [tLabel, tColor, tBg] = typeMap[tx.type] || ['未知', '#64748b', 'rgba(100,116,139,0.12)']
                  return (
                    <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                        {new Date(tx.created_at).toLocaleDateString('zh-TW')}<br />
                        {new Date(tx.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: tBg, color: tColor, fontWeight: 600 }}>{tLabel}</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>{tx.products?.name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8' }}>{tx.from_loc?.name || '外部'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8' }}>{tx.to_loc?.name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontFamily: 'monospace' }}>×{tx.quantity}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>{tx.note || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ════ 品項管理 ════ */}
        {tab === 'items' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setModal('add-item')} style={G.btnPrimary}>＋ 新增品項</button>
            </div>
            <div style={{ ...G.card, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['品項名稱', '單位', ...locNames.map(l => `${l} 庫存`), '操作'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500 }}>{p.name}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#64748b' }}>{p.unit}</td>
                      {locNames.map(loc => {
                        const r = matrix[p.name]?.[loc]
                        if (!r) return <td key={loc} style={{ padding: '12px 14px', color: '#334155', fontSize: 12 }}>—</td>
                        const pct2 = Math.min(100, Math.round(r.quantity / (r.threshold || 1) * 100))
                        const st = getStatus(pct2)
                        return (
                          <td key={loc} style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: st.color, animation: st.pulse ? 'pulseBar 1.4s infinite' : 'none' }}>
                              {r.quantity}/{r.threshold}
                            </span>
                          </td>
                        )
                      })}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setModal({ type: 'edit-item', product: p })} style={{ ...G.btn, fontSize: 11, padding: '4px 10px' }}>編輯</button>
                          <button onClick={() => handleDeleteItem(p.id)} style={G.btnDanger}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── MODALS */}
      {modal === 'tx' && (
        <TxModal
          onClose={() => setModal(null)}
          onSubmit={handleTxSubmit}
          locations={locations}
          products={products}
        />
      )}
      {modal === 'add-item' && (
        <ItemModal
          onClose={() => setModal(null)}
          onSave={handleAddItem}
          locations={locations}
        />
      )}
      {modal?.type === 'edit-item' && (
        <ItemModal
          onClose={() => setModal(null)}
          onSave={(data) => handleEditItem(modal.product.id, data)}
          locations={locations}
          existing={{
            name: modal.product.name,
            unit: modal.product.unit,
            thresholds: Object.fromEntries(locations.map(l => [l.id, matrix[modal.product.name]?.[l.name]?.threshold || 50])),
          }}
        />
      )}
    </div>
  )
}
