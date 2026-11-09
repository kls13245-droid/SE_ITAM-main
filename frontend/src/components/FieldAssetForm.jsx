import { useEffect, useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { FIELD_STATUSES, HEALTH_VALUES, IPMI_STATUSES, PARTS, PM_STATUSES } from './fieldAssetConstants';

const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-bold text-slate-600 mb-1';
const today = () => new Date().toISOString().slice(0, 10);
const currentUser = () => { try { return localStorage.getItem('itam_user') || ''; } catch { return ''; } };

const EMPTY = {
  hostname: '', complex: '', site_group: '', product: '', status: '가동', model_name: '', serial_number: '',
  ipmi_ip: '', ipmi_status: '', public_ip: '', private_ip: '', warranty_end: '', note: '',
};

// 현장 장비 추가 / 수정 창. asset이 {}이면 새 장비.
export default function FieldAssetForm({ asset, options, onCancel, onSave }) {
  const isNew = !asset.id;
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY };
    Object.keys(EMPTY).forEach(k => { if (asset[k] != null) base[k] = asset[k]; });
    return { ...base, id: asset.id };
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (e) => {
    e.preventDefault();
    setSaving(true);
    // 수정할 때는 바뀐 값만 보낸다 (monday에서 온 다른 값은 그대로)
    const payload = isNew ? form : Object.fromEntries(
      Object.entries(form).filter(([k, v]) => k === 'id' || (asset[k] ?? '') !== v));
    // 바뀐 게 없으면 저장하지 않는다 (불필요하게 'ITAM에서 수정됨'이 되지 않도록)
    if (!isNew && Object.keys(payload).length === 1) { setSaving(false); onCancel(); return; }
    Promise.resolve(onSave(payload)).finally(() => setSaving(false));
  };

  const text = (k, label, props = {}) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input value={form[k] ?? ''} onChange={set(k)} className={inputCls} {...props} />
    </div>
  );
  const select = (k, label, values) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={form[k] ?? ''} onChange={set(k)} className={inputCls}>
        <option value="">선택 안 함</option>
        {[...new Set([...values, form[k]].filter(Boolean))].map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{isNew ? '현장 장비 추가' : `장비 정보 수정 · ${asset.hostname}`}</h3>
          <button type="button" onClick={onCancel} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {text('hostname', 'Hostname *', { required: true, autoFocus: isNew, className: `${inputCls} font-mono` })}
            {select('status', '상태', FIELD_STATUSES)}
            {text('complex', '단지', { list: 'fa-complex', placeholder: '예: Memory' })}
            {text('site_group', '현장 / 그룹', { list: 'fa-site', placeholder: '예: P1D DM' })}
            {text('product', '제품', { list: 'fa-product', placeholder: '예: DM' })}
            {text('model_name', 'Model', { placeholder: '예: DL360 Gen10' })}
            {text('serial_number', 'S/N', { className: `${inputCls} font-mono` })}
            {text('warranty_end', '워런티 종료', { type: 'date' })}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
            {text('ipmi_ip', 'IPMI IP', { className: `${inputCls} font-mono`, placeholder: '예: 100.100.110.1' })}
            {select('ipmi_status', 'IPMI 상태', IPMI_STATUSES)}
            {text('public_ip', 'Public IP', { className: `${inputCls} font-mono` })}
            {text('private_ip', 'Private IP', { className: `${inputCls} font-mono` })}
          </div>
          <div>
            <label className={labelCls}>비고</label>
            <textarea value={form.note ?? ''} onChange={set('note')} rows={3} className={inputCls} />
          </div>
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
            PM 날짜·결과·부품 상태는 장비 상세의 <b>점검 기록 추가</b>로 입력합니다. 가장 최근 기록이 목록에 반영됩니다.
            {!isNew && asset.monday_item_id && <> 이 장비는 저장 후 monday CSV를 다시 가져와도 덮어쓰지 않습니다.</>}
          </p>
          <datalist id="fa-complex">{options.complex.map(v => <option key={v} value={v} />)}</datalist>
          <datalist id="fa-site">{options.site_group.map(v => <option key={v} value={v} />)}</datalist>
          <datalist id="fa-product">{options.product.map(v => <option key={v} value={v} />)}</datalist>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center">
            <Save size={14} className="mr-1.5" /> {isNew ? '추가' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

// PM 점검 기록 입력 (상세 패널 안)
export function PMRecordForm({ asset, onCancel, onSave }) {
  const [form, setForm] = useState({
    pm_date: today(), pm_status: '완료', worker: currentUser(), note: '',
    health: Object.fromEntries(PARTS.map(([k]) => [k, asset.health?.[k] || '정상'])),
  });
  const [saving, setSaving] = useState(false);
  const setHealth = (k, v) => setForm(prev => ({ ...prev, health: { ...prev.health, [k]: v } }));
  const submit = (e) => {
    e.preventDefault();
    setSaving(true);
    Promise.resolve(onSave(form)).finally(() => setSaving(false));
  };
  const tone = { '정상': 'bg-emerald-600 text-white', Fault: 'bg-red-600 text-white', Disable: 'bg-slate-500 text-white' };

  return (
    <form onSubmit={submit} className="border border-blue-200 bg-blue-50/40 rounded-xl p-3 mb-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>점검일 *</label>
          <input type="date" required value={form.pm_date} onChange={(e) => setForm({ ...form, pm_date: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>결과</label>
          <select value={form.pm_status} onChange={(e) => setForm({ ...form, pm_status: e.target.value })} className={inputCls}>
            {PM_STATUSES.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>작업자</label>
          <input value={form.worker} onChange={(e) => setForm({ ...form, worker: e.target.value })} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>부품 상태</label>
        <div className="grid grid-cols-2 gap-1.5">
          {PARTS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-[11px] font-bold text-slate-600 w-10">{label}</span>
              <div className="flex gap-0.5">
                {HEALTH_VALUES.map(v => (
                  <button type="button" key={v} onClick={() => setHealth(k, v)}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${form.health[k] === v ? tone[v] : 'text-slate-400 hover:bg-slate-100'}`}>
                    {v === 'Disable' ? '미사용' : v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <label className={labelCls}>작업 내용</label>
        <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls}
          placeholder="예: 디스크 2번 교체, 캐시 배터리 경고 확인" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">취소</button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">기록 저장</button>
      </div>
    </form>
  );
}

// PM 점검 기록 목록 (최신순)
export function PMRecordList({ records, onDelete }) {
  if (records === null) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (records.length === 0) {
    return <p className="text-sm text-slate-400 bg-slate-50 rounded-lg p-3 border border-slate-100">아직 ITAM에 입력한 점검 기록이 없습니다. (monday에서 가져온 PM 날짜는 위 '현재 PM 상태'에 있습니다)</p>;
  }
  return (
    <ol className="space-y-2">
      {records.map(r => {
        const faults = PARTS.filter(([k]) => r.health?.[k] === 'Fault').map(([, l]) => l);
        return (
          <li key={r.id} className="border border-slate-200 rounded-lg p-2.5 text-sm group">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-bold text-slate-800">{r.pm_date}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.pm_status === '완료' ? 'bg-emerald-100 text-emerald-700' : r.pm_status === '확인 필요' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{r.pm_status}</span>
                {faults.length > 0 && <span className="text-[11px] font-bold text-red-600 truncate">⚠ {faults.join(', ')}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{r.worker}</span>
                <button onClick={() => onDelete(r)} className="text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100" title="기록 삭제"><Trash2 size={13} /></button>
              </div>
            </div>
            {r.note && <p className="text-slate-600 mt-1 whitespace-pre-wrap text-[13px]">{r.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}
