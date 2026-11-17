import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Plus, Search, FileText, Loader2, X, Save, Trash2, Pencil, ArrowUp, ArrowDown,
  Copy, EyeOff, RefreshCw,
} from 'lucide-react';
import { apiJson, jsonBody } from '../api/client';

/*
 * 장애·유지보수 보고
 *  - 장애 / PM(후속 조치) / 유지 보수 건을 입력하고 날짜별 진행 기록을 쌓는다.
 *  - '주간보고 글'은 주간보고의 [장애 및 유지보수] 섹션에 붙여 넣을 글을 만들어 준다 (복사해서 붙여 넣기).
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

const COUNT_COLS = [['in_progress', '진행 중'], ['done', '완료'], ['waiting', '보류 및 대기']];

// 건수 표. '표 수정'을 누르면 칸을 직접 고칠 수 있다 (총 건수 = 세 칸의 합)
function CountsTable({ counts, year, onSaved, showToast }) {
  const [edit, setEdit] = useState(null); // {FAULT: {in_progress, done, waiting}, ...}
  const [saving, setSaving] = useState(false);
  const start = () => setEdit(Object.fromEntries(counts.map((r) => [r.kind, { in_progress: r.in_progress, done: r.done, waiting: r.waiting }])));
  const setCell = (kind, key, v) => setEdit((e) => ({ ...e, [kind]: { ...e[kind], [key]: v } }));
  const num = (v) => Math.max(0, parseInt(v, 10) || 0);
  const save = () => {
    setSaving(true);
    const values = Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, { in_progress: num(v.in_progress), done: num(v.done), waiting: num(v.waiting) }]));
    apiJson('/api/incidents/baseline/', jsonBody('PUT', { year, values }))
      .then(() => { showToast('건수 표를 저장했습니다.'); setEdit(null); onSaved(); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setSaving(false));
  };
  const adjusted = (r, key) => r.adjust?.[key] ? `ITAM 입력 ${r.itam[key]}건 ${r.adjust[key] > 0 ? '+' : ''}${r.adjust[key]} (직접 고친 값)` : '';

  return (
    <div>
      <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2">{year}년 장애 및 유지보수</th>
            <th className="px-3 py-2">총 건수</th>
            {COUNT_COLS.map(([k, label]) => <th key={k} className="px-3 py-2">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {counts.map((r) => {
            const e = edit?.[r.kind];
            return (
              <tr key={r.kind} className="border-t border-slate-100 text-center">
                <td className="text-left px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 font-bold">{e ? COUNT_COLS.reduce((t, [k]) => t + num(e[k]), 0) : r.total}</td>
                {COUNT_COLS.map(([k]) => (
                  <td key={k} className="px-3 py-1.5" title={adjusted(r, k)}>
                    {e ? (
                      <input type="number" min="0" value={e[k]} onChange={(ev) => setCell(r.kind, k, ev.target.value)}
                        className="w-20 border border-slate-300 rounded px-2 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                    ) : (
                      <span className={r.adjust?.[k] ? 'border-b border-dotted border-slate-400 cursor-help' : ''}>{r[k]}</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-end gap-2 mt-2">
        {edit ? (
          <>
            <span className="text-xs text-slate-500 mr-auto">고친 숫자와 ITAM에 입력된 건수의 차이가 보정값으로 저장됩니다. 나중에 건을 추가·완료하면 표도 그만큼 따라 바뀝니다.</span>
            <button className={btnGhost} onClick={() => setEdit(null)}>취소</button>
            <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장</button>
          </>
        ) : (
          <button className="text-xs text-slate-500 hover:text-blue-600 inline-flex items-center gap-1" onClick={start} disabled={!counts.length}>
            <Pencil size={12} /> 표 수정
          </button>
        )}
      </div>
    </div>
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
        <label className="text-sm text-slate-600 col-span-2">관련 장비 <span className="text-slate-400">(서버 현황의 호스트명을 고르면 연결됩니다)</span>
          <input className={input} list="incident-field-assets" value={form.asset_name || ''} onChange={pickAsset} placeholder="호스트명 또는 자유 입력" />
          <datalist id="incident-field-assets">
            {fieldAssets.map((a) => <option key={a.id} value={a.hostname}>{a.site_group}</option>)}
          </datalist>
          {form.field_asset_id ? <span className="text-xs text-emerald-600">서버 현황과 연결됨</span> : null}
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
// 주간보고 글 (복사해서 붙여 넣기)
// ---------------------------------------------------------------------------
function ReportTextPanel({ onClose, showToast }) {
  const [date, setDate] = useState(today());
  const [res, setRes] = useState(null);
  const load = (d) => apiJson('/api/incidents/report/text/', jsonBody('POST', { date: d })).then(setRes).catch((err) => showToast(err.message, 'error'));
  useEffect(() => { load(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = () => navigator.clipboard?.writeText(res.text).then(() => showToast('복사했습니다.'));

  return (
    <Modal title="주간보고 글" onClose={onClose} wide>
      <p className="text-sm text-slate-600 mb-3">주간보고의 「장애 및 유지보수」 섹션에 붙여 넣을 글입니다. 끝나지 않은 건 전부와 최근 7일 안에 끝난 건이 들어갑니다 ('주간보고에 넣지 않기' 건 제외).</p>
      <div className="flex items-end gap-2 mb-3">
        <label className="text-sm text-slate-600">보고 기준일
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className={btnGhost} onClick={() => load(date)}><RefreshCw size={14} /> 다시 만들기</button>
        {res && <span className="text-sm text-slate-500 ml-2">{res.week} · {res.incident_count}건</span>}
        <button className={`${btnPrimary} ml-auto`} onClick={copy} disabled={!res}><Copy size={14} /> 복사</button>
      </div>
      <pre className="text-xs bg-slate-50 border rounded-lg p-3 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">{res ? res.text : '불러오는 중…'}</pre>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function IncidentReports({ showToast, askDelete }) {
  const [data, setData] = useState({ items: [], counts: [], year: new Date().getFullYear() });
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [panel, setPanel] = useState(null); // 'report'
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
    warnings: ['진행 기록도 함께 지워집니다.'],
    url: `/api/incidents/${inc.id}/`,
    onDone: () => { setDetailId(null); load(); showToast('삭제했습니다.'); },
  });

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-xl font-bold text-slate-800 mr-auto flex items-center gap-2"><AlertTriangle className="text-red-500" size={22} /> 장애·유지보수 보고</h2>
        <button className={btnGhost} onClick={() => setPanel('report')}><FileText size={14} /> 주간보고 글</button>
        <button className={btnPrimary} onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> 새 건</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <CountsTable counts={data.counts} year={data.year} onSaved={load} showToast={showToast} />
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
      {panel === 'report' && <ReportTextPanel showToast={showToast} onClose={() => setPanel(null)} />}
    </div>
  );
}
