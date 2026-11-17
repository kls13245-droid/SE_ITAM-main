import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Plus, Search, Send, Download, Loader2, X, Save, Trash2, Pencil, ArrowUp, ArrowDown,
  CheckCircle, Copy, History, EyeOff, RefreshCw,
} from 'lucide-react';
import { apiJson, jsonBody } from '../api/client';

/*
 * 장애·유지보수 보고
 *  - 장애 / PM(후속 조치) / 유지 보수 건을 입력하고 날짜별 진행 기록을 쌓는다.
 *  - '주간보고 반영'을 누르면 monday 주간보고 문서의 [장애 및 유지보수] 섹션만 새 내용으로 바꾼다.
 *    (미리보기 → 확인 → 반영. 미리보기 뒤 문서가 바뀌었으면 반영하지 않는다)
 */

const KINDS = [['FAULT', '장애'], ['PM', 'PM (후속 조치)'], ['MAINT', '유지 보수']];
const KIND_LABEL = Object.fromEntries(KINDS);
const KIND_STYLE = {
  FAULT: 'bg-red-50 text-red-700 border-red-200',
  PM: 'bg-sky-50 text-sky-700 border-sky-200',
  MAINT: 'bg-amber-50 text-amber-700 border-amber-200',
};
const STATUSES = [['IN_PROGRESS', '진행 중'], ['WAIT', '대기'], ['HOLD', '보류'], ['DONE', '완료']];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const STATUS_STYLE = {
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  WAIT: 'bg-slate-100 text-slate-600 border-slate-200',
  HOLD: 'bg-slate-100 text-slate-600 border-slate-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50';
const btnGhost = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-blue-600 border-blue-600 text-white hover:bg-blue-700`;
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const md = (v) => (v ? `${v.slice(5, 7)}/${v.slice(8, 10)}` : '');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const EMPTY = { kind: 'FAULT', title: '', status: 'IN_PROGRESS', occurred_on: today(), asset_name: '', field_asset_id: '', hide_in_report: false, first_log: '' };

function Badge({ cls, children }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${cls}`}>{children}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} max-h-[90vh] flex flex-col`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function CountsTable({ counts, year }) {
  return (
    <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="text-left px-3 py-2">{year}년 장애 및 유지보수</th>
          <th className="px-3 py-2">총 건수</th><th className="px-3 py-2">진행 중</th>
          <th className="px-3 py-2">완료</th><th className="px-3 py-2">보류 및 대기</th>
        </tr>
      </thead>
      <tbody>
        {counts.map((r) => (
          <tr key={r.kind} className="border-t border-slate-100 text-center">
            <td className="text-left px-3 py-2 font-medium">{r.label}</td>
            <td className="px-3 py-2" title={r.baseline ? `ITAM 이전 완료 ${r.baseline}건 포함` : ''}>{r.total}</td>
            <td className="px-3 py-2">{r.in_progress}</td><td className="px-3 py-2">{r.done}</td><td className="px-3 py-2">{r.waiting}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// 건 입력·수정
// ---------------------------------------------------------------------------
function IncidentForm({ initial, fieldAssets, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const isNew = !initial.id;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const pickAsset = (e) => {
    const name = e.target.value;
    const hit = fieldAssets.find((a) => a.hostname === name);
    setForm((f) => ({ ...f, asset_name: name, field_asset_id: hit ? hit.id : '' }));
  };

  const save = () => {
    setSaving(true);
    const payload = { ...form };
    if (!isNew) delete payload.first_log;
    apiJson(isNew ? '/api/incidents/' : `/api/incidents/${form.id}/`, jsonBody(isNew ? 'POST' : 'PUT', payload))
      .then((d) => { showToast(isNew ? '건을 추가했습니다.' : '저장했습니다.'); onSaved(d); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <Modal title={isNew ? '새 장애·유지보수 건' : '건 수정'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">유형
          <select className={input} value={form.kind} onChange={set('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="text-sm text-slate-600">상태
          <select className={input} value={form.status} onChange={set('status')}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="text-sm text-slate-600 col-span-2">제목 <span className="text-slate-400">(주간보고에 '[장애] 제목 | 상태'로 나갑니다)</span>
          <input className={input} value={form.title} onChange={set('title')} placeholder="예: 7F 서버 PSU 불량" autoFocus />
        </label>
        <label className="text-sm text-slate-600">발생일
          <input type="date" className={input} value={form.occurred_on || ''} onChange={set('occurred_on')} />
        </label>
        <label className="text-sm text-slate-600">완료일
          <input type="date" className={input} value={form.done_on || ''} onChange={set('done_on')} disabled={form.status !== 'DONE'} />
        </label>
        <label className="text-sm text-slate-600 col-span-2">관련 장비 <span className="text-slate-400">(현장 장비 호스트명을 고르면 연결됩니다)</span>
          <input className={input} list="incident-field-assets" value={form.asset_name || ''} onChange={pickAsset} placeholder="호스트명 또는 자유 입력" />
          <datalist id="incident-field-assets">
            {fieldAssets.map((a) => <option key={a.id} value={a.hostname}>{a.site_group}</option>)}
          </datalist>
          {form.field_asset_id ? <span className="text-xs text-emerald-600">현장 장비와 연결됨</span> : null}
        </label>
        {isNew && (
          <label className="text-sm text-slate-600 col-span-2">첫 진행 기록 <span className="text-slate-400">(선택, 발생일 날짜로 들어갑니다)</span>
            <textarea className={input} rows={2} value={form.first_log} onChange={set('first_log')} placeholder="예: 벤더 RMA 접수" />
          </label>
        )}
        <label className="text-sm text-slate-600 col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={!!form.hide_in_report} onChange={set('hide_in_report')} /> 주간보고에 넣지 않기
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className={btnGhost} onClick={onClose}>취소</button>
        <button className={btnPrimary} onClick={save} disabled={saving || !form.title.trim()}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 건 상세 (진행 기록)
// ---------------------------------------------------------------------------
function IncidentDetail({ id, onClose, onChanged, onEdit, onDelete, showToast }) {
  const [inc, setInc] = useState(null);
  const [draft, setDraft] = useState({ date: today(), text: '', level: 1 });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiJson(`/api/incidents/${id}/`).then(setInc).catch((err) => showToast(err.message, 'error'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (p) => { setBusy(true); return p.then((d) => { setInc(d); onChanged(); return d; }).catch((err) => showToast(err.message, 'error')).finally(() => setBusy(false)); };
  const addLog = () => run(apiJson(`/api/incidents/${id}/logs/`, jsonBody('POST', draft))).then((d) => d && setDraft((x) => ({ ...x, text: '' })));
  const saveLog = () => run(apiJson(`/api/incidents/logs/${editing.id}/`, jsonBody('PUT', editing))).then(() => setEditing(null));
  const delLog = (log) => run(apiJson(`/api/incidents/logs/${log.id}/`, { method: 'DELETE' }));
  const move = (i, dir) => {
    const ids = inc.logs.map((l) => l.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(apiJson(`/api/incidents/${id}/logs/reorder/`, jsonBody('POST', { ids })));
  };
  const setStatus = (status) => run(apiJson(`/api/incidents/${id}/`, jsonBody('PUT', { status })));

  if (!inc) return <Modal title="불러오는 중" onClose={onClose}><Loader2 className="animate-spin text-slate-400" /></Modal>;
  return (
    <Modal title={inc.title} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge cls={KIND_STYLE[inc.kind]}>{KIND_LABEL[inc.kind]}</Badge>
        <select className="border border-slate-200 rounded-lg px-2 py-1 text-sm" value={inc.status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-sm text-slate-500">발생 {inc.occurred_on}{inc.done_on ? ` · 완료 ${inc.done_on}` : ''}</span>
        {inc.asset_name && <span className="text-sm text-slate-500">· 장비 {inc.asset_name}</span>}
        {inc.hide_in_report && <Badge cls="bg-slate-100 text-slate-500 border-slate-200">주간보고 제외</Badge>}
        <div className="ml-auto flex gap-2">
          <button className={btnGhost} onClick={() => onEdit(inc)}><Pencil size={14} /> 수정</button>
          <button className={`${btn} bg-white border-red-200 text-red-600 hover:bg-red-50`} onClick={() => onDelete(inc)}><Trash2 size={14} /> 삭제</button>
        </div>
      </div>

      <div className="text-xs font-semibold text-slate-500 mb-2">진행 기록 <span className="font-normal">(주간보고에서 최근 7일 기록은 초록 배경으로 표시됩니다)</span></div>
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
        {inc.logs.length === 0 && <div className="p-3 text-sm text-slate-400">아직 기록이 없습니다.</div>}
        {inc.logs.map((log, i) => (editing?.id === log.id ? (
          <div key={log.id} className="p-2 flex gap-2 items-start bg-blue-50/40">
            <input type="date" className="border border-slate-200 rounded px-2 py-1 text-sm" value={editing.date || ''} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            <select className="border border-slate-200 rounded px-2 py-1 text-sm" value={editing.level} onChange={(e) => setEditing({ ...editing, level: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>들여쓰기 {n}</option>)}
            </select>
            <textarea className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm" rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            <button className={btnPrimary} onClick={saveLog} disabled={busy}><Save size={14} /></button>
            <button className={btnGhost} onClick={() => setEditing(null)}><X size={14} /></button>
          </div>
        ) : (
          <div key={log.id} className="p-2 flex items-start gap-2 group text-sm">
            <span className="text-slate-400 w-12 shrink-0 tabular-nums">{md(log.date)}</span>
            <span className="flex-1 whitespace-pre-wrap" style={{ paddingLeft: `${(log.level - 1) * 1.25}rem` }}>{log.level > 1 ? '└ ' : ''}{log.text}</span>
            <span className="text-xs text-slate-400 shrink-0">{log.created_by}</span>
            <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
              <button className="p-1 hover:bg-slate-100 rounded" onClick={() => move(i, -1)} title="위로"><ArrowUp size={14} /></button>
              <button className="p-1 hover:bg-slate-100 rounded" onClick={() => move(i, 1)} title="아래로"><ArrowDown size={14} /></button>
              <button className="p-1 hover:bg-slate-100 rounded" onClick={() => setEditing({ ...log })} title="고치기"><Pencil size={14} /></button>
              <button className="p-1 hover:bg-red-50 text-red-500 rounded" onClick={() => delLog(log)} title="지우기"><Trash2 size={14} /></button>
            </span>
          </div>
        )))}
      </div>

      <div className="flex gap-2 items-start">
        <input type="date" className="border border-slate-200 rounded-lg px-2 py-2 text-sm" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        <select className="border border-slate-200 rounded-lg px-2 py-2 text-sm" value={draft.level} onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>들여쓰기 {n}</option>)}
        </select>
        <textarea className={`${input} flex-1`} rows={2} value={draft.text} placeholder="진행 내용 (예: 교체 부품 입고, 금일 교체 예정)"
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.text.trim()) addLog(); }} />
        <button className={btnPrimary} onClick={addLog} disabled={busy || !draft.text.trim()}><Plus size={14} /> 기록</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 주간보고 반영 (monday)
// ---------------------------------------------------------------------------
function ReportPanel({ monday, onClose, onDone, showToast }) {
  const [date, setDate] = useState(today());
  const [itemId, setItemId] = useState('');
  const [pv, setPv] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [text, setText] = useState(null);

  const loadHistory = () => apiJson('/api/incidents/report/history/').then((d) => setHistory(d.items)).catch(() => {});
  const preview = (item = itemId) => {
    setLoading(true); setResult(null);
    apiJson('/api/incidents/report/preview/', jsonBody('POST', { date, item_id: item || undefined }))
      .then((d) => { setPv(d); setItemId(d.item.id); })
      .catch((err) => { setPv(null); showToast(err.message, 'error'); })
      .finally(() => setLoading(false));
  };
  const loadText = () => apiJson('/api/incidents/report/text/', jsonBody('POST', { date })).then(setText).catch((err) => showToast(err.message, 'error'));

  useEffect(() => { loadHistory(); if (monday.configured) preview(''); else loadText(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    setApplying(true);
    apiJson('/api/incidents/report/apply/', jsonBody('POST', { date, item_id: pv.item.id, fingerprint: pv.fingerprint }))
      .then((d) => { setResult(d); showToast(d.ok ? '주간보고에 반영했습니다.' : d.message, d.ok ? 'success' : 'error'); onDone?.(); })
      .catch((err) => { setResult({ ok: false, message: err.message }); showToast(err.message, 'error'); })
      .finally(() => { setApplying(false); setPv(null); loadHistory(); });
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => showToast('복사했습니다.'));

  return (
    <Modal title="주간보고 반영 (monday)" onClose={onClose} wide>
      {!monday.configured && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>서버에 monday API 토큰(MONDAY_API_TOKEN)이 없어 문서에 바로 넣을 수 없습니다. 아래 글을 복사해서 붙여 넣거나, 관리자에게 토큰 설정을 요청해 주세요.</div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-sm text-slate-600">보고 기준일
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {monday.configured && pv && (
          <label className="text-sm text-slate-600 min-w-64">주간보고 아이템
            <select className={input} value={itemId} onChange={(e) => { setItemId(e.target.value); preview(e.target.value); }}>
              {pv.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
          </label>
        )}
        {monday.configured
          ? <button className={btnGhost} onClick={() => preview()} disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 미리보기</button>
          : <button className={btnGhost} onClick={loadText}><RefreshCw size={14} /> 다시 만들기</button>}
      </div>

      {!monday.configured && text && (
        <div>
          <div className="flex justify-between items-center mb-1"><span className="text-xs text-slate-500">{text.week} · {text.incident_count}건</span>
            <button className={btnGhost} onClick={() => copy(text.text)}><Copy size={14} /> 복사</button></div>
          <pre className="text-xs bg-slate-50 border rounded-lg p-3 whitespace-pre-wrap max-h-96 overflow-y-auto">{text.text}</pre>
        </div>
      )}

      {pv && (
        <>
          <div className="text-sm text-slate-600 mb-3">
            <b>{pv.item.name}</b> 의 문서 <b>{pv.doc.name}</b> 에서 「{pv.heading}」 섹션을 바꿉니다.
            {' '}지금 {pv.old_block_count}줄 → 새 {pv.incident_count}건 ({pv.new_block_count}줄 + 건수 표). 다른 섹션은 건드리지 않습니다.
            {pv.doc.name && !pv.doc.name.includes(pv.week) && <div className="text-amber-700 text-xs mt-1">문서 이름에 {pv.week}가 없습니다. 아이템에 연결된 문서가 맞는지 확인해 주세요.</div>}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">지금 문서</div>
              <pre className="text-xs bg-slate-50 border rounded-lg p-3 whitespace-pre-wrap h-80 overflow-y-auto text-slate-500">{pv.old_preview || '(비어 있음)'}</pre>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">반영 후</div>
              <pre className="text-xs bg-emerald-50/40 border border-emerald-200 rounded-lg p-3 whitespace-pre-wrap h-80 overflow-y-auto">{pv.preview}</pre>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={btnGhost} onClick={() => copy(pv.preview)}><Copy size={14} /> 글 복사</button>
            <button className={btnPrimary} onClick={apply} disabled={applying}>{applying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 이 내용으로 반영</button>
          </div>
        </>
      )}

      {result && (
        <div className={`mt-4 p-3 rounded-lg text-sm flex gap-2 ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {result.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />} {result.message}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1"><History size={12} /> 반영 기록</div>
          <div className="text-xs divide-y border rounded-lg">
            {history.map((h) => (
              <div key={h.id} className="px-3 py-1.5 flex gap-3">
                <span className="text-slate-400 w-36 shrink-0">{fmtDateTime(h.created_at)}</span>
                <span className="w-16 shrink-0">{h.created_by}</span>
                <span className={h.ok ? 'text-emerald-700' : 'text-red-600'}>{h.item_name} · {h.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// monday 문서에서 가져오기 (처음 한 번)
// ---------------------------------------------------------------------------
function ImportPanel({ onClose, onDone, showToast }) {
  const [pv, setPv] = useState(null);
  const [baseline, setBaseline] = useState({});
  const [busy, setBusy] = useState(true);
  const date = today();

  const load = (item) => {
    setBusy(true);
    apiJson('/api/incidents/import/preview/', jsonBody('POST', { date, item_id: item }))
      .then((d) => { setPv(d); setBaseline(Object.fromEntries(d.baseline.map((b) => [b.kind, b.current ?? b.suggested]))); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    setBusy(true);
    apiJson('/api/incidents/import/apply/', jsonBody('POST', { date, item_id: pv.item.id, fingerprint: pv.fingerprint, baseline }))
      .then((d) => { showToast(`${d.added}건을 가져왔습니다${d.skipped ? ` (이미 있는 ${d.skipped}건 건너뜀)` : ''}.`); onDone(); onClose(); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title="monday 주간보고에서 가져오기" onClose={onClose} wide>
      <p className="text-sm text-slate-600 mb-3">지금 주간보고 문서의 「장애 및 유지보수」 섹션에 있는 건과 진행 기록을 ITAM으로 옮깁니다. 문서는 바꾸지 않습니다.</p>
      {busy && !pv && <Loader2 className="animate-spin text-slate-400" />}
      {pv && (
        <>
          <label className="text-sm text-slate-600 block mb-3 max-w-sm">주간보고 아이템
            <select className={input} value={pv.item.id} onChange={(e) => load(e.target.value)}>
              {pv.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
          </label>
          <div className="border rounded-lg divide-y max-h-72 overflow-y-auto mb-4">
            {pv.incidents.length === 0 && <div className="p-3 text-sm text-slate-400">가져올 건을 찾지 못했습니다. ('[장애] 제목 | 상태' 형식의 줄을 찾습니다)</div>}
            {pv.incidents.map((p, i) => (
              <div key={i} className={`p-2 text-sm ${p.duplicate ? 'opacity-50' : ''}`}>
                <div className="flex gap-2 items-center">
                  <Badge cls={KIND_STYLE[p.kind]}>{KIND_LABEL[p.kind]}</Badge>
                  <span className="font-medium">{p.title}</span>
                  <Badge cls={STATUS_STYLE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  <span className="text-xs text-slate-400">기록 {p.logs.length}개 · 발생 {p.occurred_on}</span>
                  {p.duplicate && <span className="text-xs text-slate-500">이미 있음 — 건너뜀</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs font-semibold text-slate-500 mb-1">ITAM 이전 완료 건수 <span className="font-normal">(문서 표의 총 건수 − 가져오는 건수. 올해 건수 표가 문서와 맞도록 더해 둡니다)</span></div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {pv.baseline.map((b) => (
              <label key={b.kind} className="text-sm text-slate-600">{b.label}
                <input type="number" min="0" className={input} value={baseline[b.kind] ?? ''} onChange={(e) => setBaseline({ ...baseline, [b.kind]: e.target.value })} />
                <span className="text-xs text-slate-400">{b.doc_row ? `문서 총 ${b.doc_row[0]}건 · 가져오는 ${b.items_in_doc}건` : '문서 표에서 못 찾음'}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={onClose}>취소</button>
            <button className={btnPrimary} onClick={apply} disabled={busy}><Download size={14} /> 가져오기</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function IncidentReports({ showToast, askDelete }) {
  const [data, setData] = useState({ items: [], counts: [], year: new Date().getFullYear(), monday: { configured: false } });
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [panel, setPanel] = useState(null); // 'report' | 'import'
  const [fieldAssets, setFieldAssets] = useState([]);

  const load = () => {
    const p = new URLSearchParams({ year });
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status === 'OPEN' ? 'IN_PROGRESS,WAIT,HOLD' : status);
    if (q.trim()) p.set('q', q.trim());
    return apiJson(`/api/incidents/?${p}`).then(setData).catch((err) => showToast(err.message, 'error')).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [year, kind, status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { apiJson('/api/field-assets/').then((d) => setFieldAssets(d.items || [])).catch(() => {}); }, []);

  const years = useMemo(() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2].map(String); }, []);

  const del = (inc) => askDelete({
    title: '장애·유지보수 건 삭제', target: inc.title,
    warnings: ['진행 기록도 함께 지워집니다. 이미 반영한 monday 문서에는 남아 있습니다 (다음 반영 때 빠집니다).'],
    url: `/api/incidents/${inc.id}/`,
    onDone: () => { setDetailId(null); load(); showToast('삭제했습니다.'); },
  });

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-xl font-bold text-slate-800 mr-auto flex items-center gap-2"><AlertTriangle className="text-red-500" size={22} /> 장애·유지보수 보고</h2>
        {data.items.length === 0 && !q && !kind && data.monday.configured && (
          <button className={btnGhost} onClick={() => setPanel('import')}><Download size={14} /> monday 문서에서 가져오기</button>
        )}
        <button className={btnGhost} onClick={() => setPanel('report')}><Send size={14} /> 주간보고 반영</button>
        <button className={btnPrimary} onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> 새 건</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <CountsTable counts={data.counts} year={data.year} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}<option value="0">전체 연도</option>
        </select>
        <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">모든 유형</option>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OPEN">안 끝난 건</option><option value="">모든 상태</option>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm bg-white" placeholder="제목·장비·기록 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr><th className="text-left px-3 py-2 w-24">유형</th><th className="text-left px-3 py-2">제목</th><th className="text-left px-3 py-2 w-40">장비</th>
              <th className="px-3 py-2 w-20">상태</th><th className="px-3 py-2 w-24">발생</th><th className="px-3 py-2 w-28">최근 기록</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center"><Loader2 className="animate-spin inline text-slate-400" /></td></tr>}
            {!loading && data.items.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-400">건이 없습니다. '새 건'으로 추가하세요.</td></tr>
            )}
            {data.items.map((i) => (
              <tr key={i.id} className="border-t border-slate-100 hover:bg-blue-50/40 cursor-pointer" onClick={() => setDetailId(i.id)}>
                <td className="px-3 py-2"><Badge cls={KIND_STYLE[i.kind]}>{KIND_LABEL[i.kind]}</Badge></td>
                <td className="px-3 py-2 font-medium text-slate-800">{i.title} {i.hide_in_report && <EyeOff size={12} className="inline text-slate-400" title="주간보고 제외" />}</td>
                <td className="px-3 py-2 text-slate-500 truncate max-w-40">{i.asset_name}</td>
                <td className="px-3 py-2 text-center"><Badge cls={STATUS_STYLE[i.status]}>{STATUS_LABEL[i.status]}</Badge></td>
                <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{md(i.occurred_on)}</td>
                <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{md(i.last_log_date)} <span className="text-xs text-slate-400">({i.log_count})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && <IncidentForm initial={form} fieldAssets={fieldAssets} showToast={showToast} onClose={() => setForm(null)}
        onSaved={(d) => { setForm(null); load(); setDetailId(d.id); }} />}
      {detailId && !form && <IncidentDetail id={detailId} showToast={showToast} onClose={() => setDetailId(null)} onChanged={load}
        onEdit={(inc) => setForm({ ...EMPTY, ...inc, field_asset_id: inc.field_asset_id || '', done_on: inc.done_on || '' })} onDelete={del} />}
      {panel === 'report' && <ReportPanel monday={data.monday} showToast={showToast} onClose={() => setPanel(null)} />}
      {panel === 'import' && <ImportPanel showToast={showToast} onClose={() => setPanel(null)} onDone={load} />}
    </div>
  );
}
