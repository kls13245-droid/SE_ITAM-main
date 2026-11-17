import { useEffect, useState } from 'react';
import { X, ClipboardCheck, Loader2 } from 'lucide-react';
import { FIELD_STATUSES, HEALTH_VALUES, IPMI_STATUSES, PARTS, PM_STATUSES } from './fieldAssetConstants';

/*
 * 서버 여러 대 한꺼번에 바꾸기 (PM 때 여러 대를 한 번에 점검한 경우)
 *  - PM 점검 기록: 고른 서버 모두에 같은 점검일·결과·작업자·내용으로 기록을 넣는다.
 *    부품 상태는 고른 부품만 바꾸고, '그대로'인 부품은 서버마다 지금 값을 유지한다.
 *  - 정보 변경: 체크한 항목만 고른 서버 모두 같은 값으로 바꾼다.
 */

const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400';
const labelCls = 'block text-xs font-bold text-slate-600 mb-1';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const currentUser = () => { try { return localStorage.getItem('itam_user') || ''; } catch { return ''; } };
const tone = { '정상': 'bg-emerald-600 text-white', Fault: 'bg-red-600 text-white', Disable: 'bg-slate-500 text-white' };

// 한꺼번에 바꿀 수 있는 항목 (백엔드 BULK_FIELDS와 맞춤)
const FIELDS = [
  ['status', '상태', 'select', FIELD_STATUSES],
  ['ipmi_status', 'IPMI 상태', 'select', IPMI_STATUSES],
  ['warranty_end', '워런티 종료', 'date'],
  ['site_group', '현장', 'text'],
  ['complex', '단지', 'text'],
  ['product', '제품', 'text'],
  ['model_name', 'Model', 'text'],
  ['note', '비고 (덮어씀)', 'textarea'],
];

export default function FieldAssetBulk({ assets, onCancel, onSave }) {
  const [doPm, setDoPm] = useState(true);
  const [pm, setPm] = useState({
    pm_date: today(), pm_status: '완료', worker: currentUser(), note: '',
    health: Object.fromEntries(PARTS.map(([k]) => [k, ''])), // '' = 그대로
  });
  const [on, setOn] = useState({}); // 바꿀 항목 체크
  const [fields, setFields] = useState({ status: '가동', ipmi_status: '접속 가능' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const setHealth = (k, v) => setPm(p => ({ ...p, health: { ...p.health, [k]: p.health[k] === v ? '' : v } }));
  const allHealth = (v) => setPm(p => ({ ...p, health: Object.fromEntries(PARTS.map(([k]) => [k, v])) }));
  const chosenFields = Object.fromEntries(FIELDS.filter(([k]) => on[k]).map(([k]) => [k, fields[k] ?? '']));
  const nothing = !doPm && Object.keys(chosenFields).length === 0;

  const summary = [
    doPm && `PM 기록 ${pm.pm_date} ${pm.pm_status}`,
    ...FIELDS.filter(([k]) => on[k]).map(([k, label]) => `${label.replace(' (덮어씀)', '')} → ${fields[k] || '(비움)'}`),
  ].filter(Boolean);

  const submit = (e) => {
    e.preventDefault();
    if (nothing) return;
    if (!window.confirm(`서버 ${assets.length}대에 아래 내용을 적용할까요?\n\n${summary.join('\n')}`)) return;
    setSaving(true);
    Promise.resolve(onSave({ ids: assets.map(a => a.id), fields: chosenFields, pm: doPm ? pm : null }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center"><ClipboardCheck size={18} className="mr-2 text-blue-600" /> 서버 {assets.length}대 한꺼번에 바꾸기</h3>
            <p className="text-xs text-slate-500 mt-1 max-h-12 overflow-y-auto font-mono">{assets.map(a => a.hostname).join(', ')}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* PM 점검 기록 */}
          <section className={`border rounded-xl p-4 ${doPm ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}>
            <label className="flex items-center gap-2 font-bold text-sm text-slate-800 mb-3 cursor-pointer">
              <input type="checkbox" checked={doPm} onChange={(e) => setDoPm(e.target.checked)} /> PM 점검 기록 추가
              <span className="font-normal text-xs text-slate-500">고른 서버 모두에 같은 점검 기록이 한 건씩 들어갑니다</span>
            </label>
            {doPm && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>점검일 *</label>
                    <input type="date" required value={pm.pm_date} onChange={(e) => setPm({ ...pm, pm_date: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>결과</label>
                    <select value={pm.pm_status} onChange={(e) => setPm({ ...pm, pm_status: e.target.value })} className={inputCls}>
                      {PM_STATUSES.map(v => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>작업자</label>
                    <input value={pm.worker} onChange={(e) => setPm({ ...pm, worker: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={labelCls}>부품 상태 <span className="font-normal text-slate-400">(누르지 않은 부품은 서버마다 지금 값 그대로)</span></label>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => allHealth('정상')} className="text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded">모두 정상</button>
                      <button type="button" onClick={() => allHealth('')} className="text-[11px] font-bold text-slate-500 hover:bg-slate-100 px-1.5 py-0.5 rounded">모두 그대로</button>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {PARTS.map(([k, label]) => (
                      <div key={k} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2 py-1">
                        <span className="text-[11px] font-bold text-slate-600 w-10">{label}</span>
                        <div className="flex gap-0.5">
                          {HEALTH_VALUES.map(v => (
                            <button type="button" key={v} onClick={() => setHealth(k, v)}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pm.health[k] === v ? tone[v] : 'text-slate-400 hover:bg-slate-100'}`}>
                              {v === 'Disable' ? '미사용' : v}
                            </button>
                          ))}
                          {!pm.health[k] && <span className="text-[10px] text-slate-400 px-1 py-0.5">그대로</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>작업 내용</label>
                  <textarea rows={2} value={pm.note} onChange={(e) => setPm({ ...pm, note: e.target.value })} className={inputCls}
                    placeholder="예: 정기 PM, 펌웨어 점검, 로그 확인" />
                </div>
              </div>
            )}
          </section>

          {/* 정보 변경 */}
          <section className="border border-slate-200 rounded-xl p-4">
            <div className="font-bold text-sm text-slate-800 mb-1">정보 변경 <span className="font-normal text-xs text-slate-500">체크한 항목만 고른 서버 모두 같은 값으로 바뀝니다</span></div>
            <p className="text-xs text-slate-400 mb-3">호스트명·S/N·IP처럼 서버마다 다른 값은 한 대씩 고쳐 주세요.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
              {FIELDS.map(([k, label, type, opts]) => (
                <div key={k} className={type === 'textarea' ? 'md:col-span-2' : ''}>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-1 cursor-pointer">
                    <input type="checkbox" checked={!!on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} /> {label}
                  </label>
                  {type === 'select' ? (
                    <select disabled={!on[k]} value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} className={inputCls}>
                      <option value="">(비움)</option>
                      {opts.map(v => <option key={v}>{v}</option>)}
                    </select>
                  ) : type === 'textarea' ? (
                    <textarea rows={2} disabled={!on[k]} value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} className={inputCls} />
                  ) : (
                    <input type={type} disabled={!on[k]} value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} className={inputCls} />
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 truncate">{nothing ? '바꿀 내용을 고르세요' : summary.join(' · ')}</span>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
            <button type="submit" disabled={saving || nothing} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5">
              {saving && <Loader2 size={14} className="animate-spin" />} {assets.length}대에 적용
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
