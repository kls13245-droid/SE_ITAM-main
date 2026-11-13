import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Plus, Upload, Download, Presentation, FileSpreadsheet, Trash2, Save, Search, Database,
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Loader2, X, Pencil,
} from 'lucide-react';
import { apiJson, jsonBody, API_BASE_URL } from '../api/client';

/*
 * 투자심의 자료 (ADB-Doc)
 *  - 심의건: 구매 사양 엑셀을 올리고 'PPT 만들기'를 누르면 서버가 PPT와 배포용 엑셀을 만든다 (PC용 InvestPPT.exe와 같은 엔진)
 *  - 기준정보: 심의 매크로 엑셀의 '이름 관리자' 내용 (품목 CIS 코드, 선택 목록, CPU 사양)
 */

const STATUSES = ['작성중', '심의중', '완료'];
const STATUS_STYLE = {
  작성중: 'bg-slate-100 text-slate-600 border-slate-200',
  심의중: 'bg-blue-50 text-blue-700 border-blue-200',
  완료: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const EMPTY_FORM = { title: '', line: '', product: '', year: String(new Date().getFullYear()), file: null };
const CIS_OK = /^Q4\w{2}-\w+$/;

const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const upload = (url, file, extra = {}) => {
  const fd = new FormData();
  if (file) fd.append('file', file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v ?? ''));
  return apiJson(url, { method: 'POST', body: fd });
};

// 파일 고르기 버튼 (input을 숨기고 버튼 모양으로)
function FileButton({ accept, onPick, children, className, disabled }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className={className}>{children}</button>
    </>
  );
}

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50';
const btnGhost = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-blue-600 border-blue-600 text-white hover:bg-blue-700`;
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500';

export default function ReviewDocs({ showToast, askDelete }) {
  const [tab, setTab] = useState('cases');
  return (
    <div className="flex-1 flex flex-col min-w-0 animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center"><FileText className="mr-2 text-violet-500" /> 투자심의 자료</h2>
        <div className="flex bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
          {[['cases', '심의건'], ['master', '기준정보 (이름 관리자)']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === k ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'cases' ? <Cases showToast={showToast} askDelete={askDelete} /> : <Master showToast={showToast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 심의건
// ---------------------------------------------------------------------------
function Cases({ showToast, askDelete }) {
  const [items, setItems] = useState([]);
  const [template, setTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');

  const load = () => apiJson('/api/reviews/')
    .then(d => { setItems(d.items); setTemplate(d.template); return d; })
    .catch(err => showToast(err.message, 'error'))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const select = (id) => {
    setSelectedId(id); setCreating(false); setDetail(null);
    if (id) apiJson(`/api/reviews/${id}/`).then(setDetail).catch(err => showToast(err.message, 'error'));
  };

  const onChanged = (c) => { setDetail(c); load(); };
  const filtered = items.filter(c => !q || [c.title, c.line, c.product, c.year].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0">
      <div className="lg:w-96 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-100 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="업무명, 라인, 제품 검색" className={`${input} pl-8 py-1.5`} />
          </div>
          <button onClick={() => { select(null); setCreating(true); }} className={btnPrimary}><Plus size={14} /> 새 심의건</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? <div className="p-6 text-center text-sm text-slate-400">불러오는 중...</div>
            : filtered.length === 0 ? <div className="p-6 text-center text-sm text-slate-400">등록된 심의건이 없습니다.<br />'새 심의건'에서 구매 사양 엑셀을 올려 시작하세요.</div>
            : filtered.map(c => (
              <button key={c.id} onClick={() => select(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-violet-50 ${selectedId === c.id ? 'bg-violet-50 border-l-4 border-l-violet-500' : ''}`}>
                <div className="flex justify-between items-center gap-2">
                  <span className="font-bold text-slate-800 truncate">{c.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 flex justify-between">
                  <span className="truncate">{[c.year, c.line, c.product].filter(Boolean).join(' · ') || '-'}</span>
                  <span className="shrink-0">산출물 {c.output_count ?? 0}건</span>
                </div>
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <TemplateBar template={template} onChanged={(name) => { setTemplate(name); showToast('PPT 템플릿을 바꿨습니다.'); }} showToast={showToast} />
        {creating ? (
          <CreateCase showToast={showToast} onCancel={() => setCreating(false)}
            onCreated={(c) => { load(); select(c.id); showToast('심의건을 만들었습니다.'); }} />
        ) : detail ? (
          <CaseDetail key={detail.id} c={detail} hasTemplate={!!template} showToast={showToast} onChanged={onChanged}
            onDelete={() => askDelete({
              title: '심의건 삭제', target: detail.title, url: `/api/reviews/${detail.id}/`,
              warnings: ['올린 구매 사양 엑셀과 지금까지 만든 PPT·배포용 엑셀이 모두 함께 삭제됩니다.'],
              onDone: () => { select(null); load(); showToast('심의건을 삭제했습니다.'); },
            })} />
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
            <Presentation size={36} className="mx-auto mb-3 text-slate-300" />
            왼쪽에서 심의건을 고르거나 '새 심의건'을 눌러 주세요.
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateBar({ template, onChanged, showToast }) {
  const [busy, setBusy] = useState(false);
  const pick = (f) => {
    setBusy(true);
    upload('/api/reviews/template/', f).then(d => onChanged(d.name))
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(false));
  };
  return (
    <div className={`mb-4 px-4 py-3 rounded-xl border flex items-center justify-between gap-3 text-sm ${template ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-center gap-2 min-w-0">
        {template ? <CheckCircle size={16} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0" />}
        <span className="text-slate-500 shrink-0">PPT 템플릿</span>
        <span className="font-medium text-slate-800 truncate">{template || '아직 없음. 템플릿(.pptx)을 한 번 올려 주세요.'}</span>
      </div>
      <div className="flex gap-2 shrink-0">
        {template && <a href={`${API_BASE_URL}/api/reviews/template/file/`} className={btnGhost}><Download size={14} /> 내려받기</a>}
        <FileButton accept=".pptx" onPick={pick} disabled={busy} className={btnGhost}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {template ? '바꾸기' : '템플릿 올리기'}
        </FileButton>
      </div>
    </div>
  );
}

function CreateCase({ onCreated, onCancel, showToast }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    setBusy(true);
    const { file, ...fields } = form;
    upload('/api/reviews/', file, fields).then(onCreated)
      .catch(err => { showToast(err.message, 'error'); setBusy(false); });
  };
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800">새 심의건</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
      </div>
      <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
        <div className="text-sm font-bold text-violet-800 mb-2">1. 구매 사양 엑셀 (.xlsm / .xlsx)</div>
        <div className="flex items-center gap-3">
          <FileButton accept=".xlsm,.xlsx" onPick={(f) => setForm(s => ({ ...s, file: f }))} className={btnGhost}><Upload size={14} /> 파일 고르기</FileButton>
          <span className="text-sm text-slate-600 truncate">{form.file?.name || '선택한 파일 없음'}</span>
        </div>
        <p className="text-xs text-violet-700/80 mt-2">업무명을 비워 두면 엑셀의 '구매 사양' 시트에서 읽어 옵니다. 엑셀은 나중에 올려도 됩니다.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm text-slate-600 md:col-span-2">업무명<input className={input} value={form.title} onChange={set('title')} placeholder="비우면 엑셀에서 자동으로" /></label>
        <label className="text-sm text-slate-600">라인명<input className={input} value={form.line} onChange={set('line')} /></label>
        <label className="text-sm text-slate-600">제품<input className={input} value={form.product} onChange={set('product')} /></label>
        <label className="text-sm text-slate-600">심의 연도<input className={input} value={form.year} onChange={set('year')} maxLength={4} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost}>취소</button>
        <button disabled={busy || (!form.title.trim() && !form.file)} className={btnPrimary}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 만들기
        </button>
      </div>
    </form>
  );
}

function CaseDetail({ c, hasTemplate, showToast, onChanged, onDelete }) {
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const [openLog, setOpenLog] = useState(c.outputs?.[0]?.id ?? null);

  const save = () => {
    setBusy('save');
    apiJson(`/api/reviews/${c.id}/`, jsonBody('PUT', edit))
      .then(d => { setEdit(null); onChanged(d); showToast('저장했습니다.'); })
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(''));
  };
  const setStatus = (status) => apiJson(`/api/reviews/${c.id}/`, jsonBody('PUT', { status }))
    .then(onChanged).catch(err => showToast(err.message, 'error'));
  const uploadExcel = (f) => {
    setBusy('upload');
    upload(`/api/reviews/${c.id}/upload/`, f).then(d => { onChanged(d); showToast('구매 사양 엑셀을 올렸습니다.'); })
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(''));
  };
  const generate = () => {
    setBusy('generate');
    apiJson(`/api/reviews/${c.id}/generate/`, { method: 'POST' })
      .then(d => {
        onChanged(d.case); setOpenLog(d.output.id);
        showToast(d.output.ok ? 'PPT와 배포용 엑셀을 만들었습니다.' : '만들었지만 일부 표에서 오류가 났습니다. 실행 기록을 확인해 주세요.', d.output.ok ? 'success' : 'error');
      })
      .catch(err => { showToast(err.message, 'error'); apiJson(`/api/reviews/${c.id}/`).then(onChanged).catch(() => {}); })
      .finally(() => setBusy(''));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex justify-between items-start gap-4">
          {edit ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
              {[['title', '업무명'], ['line', '라인명'], ['product', '제품'], ['year', '심의 연도']].map(([k, label]) => (
                <label key={k} className={`text-sm text-slate-600 ${k === 'title' ? 'md:col-span-2' : ''}`}>{label}
                  <input className={input} value={edit[k]} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} /></label>
              ))}
              <label className="text-sm text-slate-600 md:col-span-2">메모
                <textarea className={input} rows={2} value={edit.note} onChange={e => setEdit(s => ({ ...s, note: e.target.value }))} /></label>
              <div className="md:col-span-2 flex justify-end gap-2">
                <button onClick={() => setEdit(null)} className={btnGhost}>취소</button>
                <button onClick={save} disabled={busy === 'save'} className={btnPrimary}><Save size={14} /> 저장</button>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <h3 className="text-xl font-bold text-slate-800">{c.title}</h3>
              <p className="text-sm text-slate-500 mt-1">{[c.year, c.line, c.product].filter(Boolean).join(' · ') || '연도·라인·제품 미입력'}</p>
              {c.note && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{c.note}</p>}
              <p className="text-xs text-slate-400 mt-2">작성 {c.created_by || '-'} · {fmtDateTime(c.created_at)}</p>
            </div>
          )}
          {!edit && (
            <div className="flex items-center gap-2 shrink-0">
              <select value={c.status} onChange={e => setStatus(e.target.value)} className={`text-sm border rounded-lg px-2 py-1.5 font-bold ${STATUS_STYLE[c.status]}`}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              <button onClick={() => setEdit({ title: c.title, line: c.line, product: c.product, year: c.year, note: c.note })} className={btnGhost}><Pencil size={14} /> 수정</button>
              <button onClick={onDelete} className={`${btn} bg-white border-red-200 text-red-600 hover:bg-red-50`}><Trash2 size={14} /></button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="text-sm font-bold text-slate-700 mb-3">구매 사양 엑셀</div>
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet size={20} className={c.has_source ? 'text-emerald-600' : 'text-slate-300'} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-800 truncate">{c.source_name || '아직 올리지 않았습니다.'}</div>
            {c.source_uploaded_at && <div className="text-xs text-slate-400">{fmtDateTime(c.source_uploaded_at)}</div>}
          </div>
          {c.has_source && <a href={`${API_BASE_URL}/api/reviews/${c.id}/source/`} className={btnGhost}><Download size={14} /> 내려받기</a>}
          <FileButton accept=".xlsm,.xlsx" onPick={uploadExcel} disabled={!!busy} className={btnGhost}>
            {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {c.has_source ? '다시 올리기' : '올리기'}
          </FileButton>
        </div>
        <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {!c.has_source ? '구매 사양 엑셀을 먼저 올려 주세요.' : !hasTemplate ? '위에서 PPT 템플릿을 먼저 올려 주세요.' : 'PC용 InvestPPT와 같은 방식으로 PPT와 배포용 엑셀(매크로 제거)을 만듭니다.'}
          </p>
          <button onClick={generate} disabled={!!busy || !c.has_source || !hasTemplate}
            className={`${btn} px-5 py-2.5 bg-violet-600 border-violet-600 text-white hover:bg-violet-700 text-base font-bold shrink-0`}>
            {busy === 'generate' ? <Loader2 size={18} className="animate-spin" /> : <Presentation size={18} />} PPT 만들기
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-sm font-bold text-slate-700">만든 자료 ({c.outputs?.length || 0})</div>
        {(c.outputs || []).length === 0 ? <div className="p-6 text-center text-sm text-slate-400">아직 만든 자료가 없습니다.</div>
          : c.outputs.map(o => (
            <div key={o.id} className="px-6 py-3 border-b border-slate-50">
              <div className="flex flex-wrap items-center gap-2">
                {o.ok ? <CheckCircle size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                <span className="text-sm text-slate-700">{fmtDateTime(o.created_at)}</span>
                <span className="text-xs text-slate-400">{o.created_by}</span>
                <div className="ml-auto flex gap-2">
                  {o.pptx_name && <a href={`${API_BASE_URL}/api/reviews/outputs/${o.id}/pptx/`} className={btnGhost} title={o.pptx_name}><Presentation size={14} className="text-orange-500" /> PPT</a>}
                  {o.xlsx_name && <a href={`${API_BASE_URL}/api/reviews/outputs/${o.id}/xlsx/`} className={btnGhost} title={o.xlsx_name}><FileSpreadsheet size={14} className="text-emerald-600" /> 배포용 엑셀</a>}
                  <button onClick={() => setOpenLog(openLog === o.id ? null : o.id)} className={btnGhost}>
                    실행 기록 {openLog === o.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>
              {openLog === o.id && <pre className="mt-3 p-3 bg-slate-900 text-slate-200 text-xs rounded-lg whitespace-pre-wrap max-h-64 overflow-y-auto">{o.log || '(기록 없음)'}</pre>}
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 기준정보 (이름 관리자)
// ---------------------------------------------------------------------------
const MASTER_TABS = [['codes', '품목 CIS 코드'], ['lists', '선택 목록'], ['cpus', 'CPU 사양']];
const IMPORT_LABELS = { codes: '품목 CIS 코드', lists: '선택 목록', cpus: 'CPU 사양' };

function Master({ showToast }) {
  const [data, setData] = useState(null);
  const [sub, setSub] = useState('codes');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [importState, setImportState] = useState(null); // { file, preview, busy }
  const [editing, setEditing] = useState(null); // { id, cis_code }

  const load = () => apiJson('/api/reviews/master/').then(setData).catch(err => showToast(err.message, 'error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const pickImport = (file) => {
    setImportState({ file, preview: null, busy: true });
    upload('/api/reviews/master/import/', file, { mode: 'preview' })
      .then(preview => setImportState({ file, preview, busy: false }))
      .catch(err => { showToast(err.message, 'error'); setImportState(null); });
  };
  const commitImport = () => {
    setImportState(s => ({ ...s, busy: true }));
    upload('/api/reviews/master/import/', importState.file)
      .then(() => { setImportState(null); load(); showToast('기준정보를 가져왔습니다.'); })
      .catch(err => { showToast(err.message, 'error'); setImportState(s => ({ ...s, busy: false })); });
  };
  const saveCode = () => apiJson(`/api/reviews/master/codes/${editing.id}/`, jsonBody('PUT', { cis_code: editing.cis_code }))
    .then(p => { setData(d => ({ ...d, codes: d.codes.map(x => (x.id === p.id ? p : x)) })); setEditing(null); showToast('CIS 코드를 저장했습니다.'); })
    .catch(err => showToast(err.message, 'error'));

  const match = (...vals) => !q || vals.join(' ').toLowerCase().includes(q.toLowerCase());
  const missing = useMemo(() => (data?.codes || []).filter(p => !CIS_OK.test(p.cis_code.trim())).length, [data]);
  const groups = useMemo(() => {
    const out = {};
    (data?.lists || []).filter(l => match(l.name, l.values.join(' '))).forEach(l => { (out[l.group] ||= []).push(l); });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q]);

  if (!data) return <div className="p-6 text-center text-sm text-slate-400">불러오는 중...</div>;
  const empty = !data.codes.length && !data.lists.length;

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Database size={18} className="text-violet-500" />
        <div className="text-sm text-slate-600 flex-1 min-w-[240px]">
          심의 매크로 엑셀의 <b>이름 관리자</b> 내용입니다. 매크로 엑셀(.xlsm)을 올리면 엑셀 기준으로 덮어씁니다.
          {missing > 0 && <span className="ml-2 text-amber-600 font-medium">CIS 코드 확인 필요 {missing}개</span>}
        </div>
        <FileButton accept=".xlsm,.xlsx" onPick={pickImport} className={btnPrimary}><Upload size={14} /> 매크로 엑셀에서 가져오기</FileButton>
      </div>

      {importState && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-bold text-violet-900">{importState.file.name} 가져오기 미리보기</div>
            <button onClick={() => setImportState(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>
          {!importState.preview ? <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 엑셀을 읽는 중...</div> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                {Object.entries(IMPORT_LABELS).map(([k, label]) => {
                  const r = importState.preview[k];
                  return (
                    <div key={k} className="bg-white rounded-xl border border-violet-100 p-3 text-sm">
                      <div className="font-bold text-slate-700">{label} {r.total}개</div>
                      <div className="text-xs text-slate-500 mt-1">추가 {r.added} · 변경 {r.changed} · <span className={r.removed ? 'text-red-600 font-bold' : ''}>삭제 {r.removed}</span></div>
                    </div>
                  );
                })}
              </div>
              {importState.preview.missing_cis?.length > 0 && (
                <p className="text-xs text-amber-700 mb-3">CIS 코드가 비었거나 덜 적힌 품목: {importState.preview.missing_cis.join(', ')}</p>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setImportState(null)} className={btnGhost}>취소</button>
                <button onClick={commitImport} disabled={importState.busy} className={btnPrimary}>
                  {importState.busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} 이대로 가져오기
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {empty ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          아직 기준정보가 없습니다. 위의 '매크로 엑셀에서 가져오기'로 심의 매크로 엑셀을 올려 주세요.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0 flex-1">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {MASTER_TABS.map(([k, label]) => (
                <button key={k} onClick={() => setSub(k)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sub === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {label} <span className="opacity-60">{data[k].length}</span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색" className={`${input} pl-8 py-1.5`} />
            </div>
            {sub === 'codes' && (
              <label className="text-sm text-slate-600 flex items-center gap-1.5">
                <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> 확인 필요만
              </label>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {sub === 'codes' && (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr><th className="text-left px-4 py-2">품목</th><th className="text-left px-4 py-2">CIS 코드</th><th className="text-left px-4 py-2">이름 관리자</th><th /></tr></thead>
                <tbody>
                  {data.codes.filter(p => match(p.name, p.cis_code, p.key) && (!onlyMissing || !CIS_OK.test(p.cis_code.trim()))).map(p => (
                    <tr key={p.id} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-2 font-mono">
                        {editing?.id === p.id ? (
                          <input autoFocus className={`${input} py-1 font-mono`} value={editing.cis_code}
                            onChange={e => setEditing(s => ({ ...s, cis_code: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveCode(); if (e.key === 'Escape') setEditing(null); }} />
                        ) : CIS_OK.test(p.cis_code.trim()) ? p.cis_code
                          : <span className="text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> {p.cis_code || '없음'}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400 font-mono">{p.key}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {editing?.id === p.id ? (
                          <><button onClick={saveCode} className="text-blue-600 hover:underline text-xs font-bold mr-2">저장</button>
                            <button onClick={() => setEditing(null)} className="text-slate-400 hover:underline text-xs">취소</button></>
                        ) : <button onClick={() => setEditing({ id: p.id, cis_code: p.cis_code })} className="text-slate-400 hover:text-blue-600"><Pencil size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sub === 'lists' && Object.entries(groups).map(([g, lists]) => (
              <div key={g} className="px-4 py-3 border-b border-slate-100">
                <div className="text-xs font-bold text-violet-600 uppercase mb-2">{g}</div>
                {lists.map(l => (
                  <div key={l.id} className="flex gap-3 py-1.5 text-sm">
                    <span className="w-56 shrink-0 font-mono text-xs text-slate-600 pt-0.5" title={l.source}>{l.name}</span>
                    <div className="flex flex-wrap gap-1">{l.values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs">{v}</span>)}</div>
                  </div>
                ))}
              </div>
            ))}
            {sub === 'cpus' && (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr><th className="text-left px-4 py-2">CPU</th><th className="text-left px-4 py-2">클럭 (GHz)</th><th className="text-left px-4 py-2">코어</th></tr></thead>
                <tbody>
                  {data.cpus.filter(c => match(c.name)).map(c => (
                    <tr key={c.id} className="border-t border-slate-50"><td className="px-4 py-2 font-medium">{c.name}</td><td className="px-4 py-2">{c.clock}</td><td className="px-4 py-2">{c.cores}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
