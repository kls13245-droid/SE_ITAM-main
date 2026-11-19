import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Plus, Upload, Download, Presentation, FileSpreadsheet, Trash2, Save, Search, Database,
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Loader2, X, Pencil,
} from 'lucide-react';
import { apiJson, jsonBody, API_BASE_URL } from '../api/client';
import SpecEditor from './SpecEditor';
import CisCodeAdmin from './CisCodeAdmin';
import PartRegister from './PartRegister';

/*
 * ADB 심의 (ADB-Doc)
 *  - 심의건: 위에 전체 현황판(대기·진행·완료 건수). 구매 사양을 화면에서 입력하거나(SpecEditor) 엑셀을 올리고
 *    'PPT·엑셀 만들기'를 누르면 서버가 PPT와 배포용 엑셀을 만든다 (PC용 InvestPPT.exe와 같은 엔진)
 *  - CIS 코드 관리: 품목별 CIS 코드 추가·수정·삭제와 변경 이력 (CisCodeAdmin)
 *  - Part 등록: 서버·스토리지·CPU 등 기준정보 부품을 직접 입력 (PartRegister)
 *  - 기준정보: 심의 매크로 엑셀의 '이름 관리자' 가져오기, 선택 목록 보기, 검증
 */

// 서버에는 영문 코드로 저장되고, 화면에는 한글로 보여 준다
const STATUSES = [
  ['DRAFT', '작성중'], ['REVIEW', '심의중'], ['APPROVED', '승인'],
  ['PURCHASE', '구매중'], ['RECEIVED', '입고완료'], ['REJECTED', '반려'],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const STATUS_STYLE = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-200',
  REVIEW: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PURCHASE: 'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-violet-50 text-violet-700 border-violet-200',
  REJECTED: 'bg-red-50 text-red-600 border-red-200',
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
        <h2 className="text-2xl font-bold text-slate-800 flex items-center"><FileText className="mr-2 text-violet-500" /> ADB 심의</h2>
        <div className="flex bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
          {[['cases', '심의건'], ['codes', 'CIS 코드 관리'], ['parts', 'Part 등록'], ['master', '기준정보 (이름 관리자)']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === k ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'cases' && <Cases showToast={showToast} askDelete={askDelete} />}
      {tab === 'codes' && <CisCodeAdmin showToast={showToast} askDelete={askDelete} />}
      {tab === 'parts' && <PartRegister showToast={showToast} askDelete={askDelete} />}
      {tab === 'master' && <Master showToast={showToast} />}
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
  const [board, setBoard] = useState(null);
  const [pick, setPick] = useState(null); // 현황판에서 누른 칸 { year: null(전체) | '2026' | '', stage: null(총 건수) | 'WAIT' ... }

  const load = () => apiJson('/api/reviews/')
    .then(d => { setItems(d.items); setTemplate(d.template); setBoard(d.board); return d; })
    .catch(err => showToast(err.message, 'error'))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const select = (id) => {
    setSelectedId(id); setCreating(false); setDetail(null);
    if (id) apiJson(`/api/reviews/${id}/`).then(setDetail).catch(err => showToast(err.message, 'error'));
  };

  const onChanged = (c) => { setDetail(c); load(); };
  const filtered = items.filter(c => (!q || [c.title, c.line, c.product, c.year].join(' ').toLowerCase().includes(q.toLowerCase()))
    && (!pick || ((pick.year === null || c.year === pick.year) && (!pick.stage || c.stage === pick.stage))));

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
    <StatusBoard board={board} pick={pick} onPick={setPick} />
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
            : filtered.length === 0 ? <div className="p-6 text-center text-sm text-slate-400">등록된 심의건이 없습니다.<br />'새 심의건'을 눌러 시작하세요.</div>
            : filtered.map(c => (
              <button key={c.id} onClick={() => select(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-violet-50 ${selectedId === c.id ? 'bg-violet-50 border-l-4 border-l-violet-500' : ''}`}>
                <div className="flex justify-between items-center gap-2">
                  <span className="font-bold text-slate-800 truncate">{c.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status] || c.status}</span>
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
    </div>
  );
}

// 심의 전체 현황판 (장애·유지보수 보고의 건수 표와 같은 모양). 칸을 누르면 아래 목록이 그 칸의 심의건만 보인다
const STAGE_STYLE = { WAIT: 'text-slate-700', PROGRESS: 'text-blue-700', DONE: 'text-emerald-700' };

function StatusBoard({ board, pick, onPick }) {
  if (!board) return null;
  const rows = [{ ...board.all, all: true }, ...board.years];
  const same = (year, stage) => pick && pick.year === year && pick.stage === stage;
  const click = (year, stage) => onPick(same(year, stage) ? null : { year, stage });
  const tip = (r, st) => st.statuses.map(s => `${board.status_labels[s]} ${r.by_status[s] || 0}건`).join(' · ');
  const cell = (r, stage, value, extra = '', title = '') => {
    const year = r.all ? null : r.year;
    return (
      <td key={stage || 'total'} className="px-1 py-1" title={title}>
        <button onClick={() => click(year, stage)} disabled={!value && !same(year, stage)}
          className={`w-full rounded-md px-2 py-1 tabular-nums hover:bg-violet-50 disabled:hover:bg-transparent disabled:text-slate-300 ${same(year, stage) ? 'bg-violet-100 ring-1 ring-violet-400' : ''} ${extra}`}>
          {value}
        </button>
      </td>
    );
  };
  const pickLabel = pick && [pick.year === null ? '전체 연도' : pick.year ? `${pick.year}년` : '연도 없음',
    pick.stage ? board.stages.find(s => s.key === pick.stage)?.label : '모든 구분'].join(' · ');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2">심의 전체 현황</th>
            <th className="px-3 py-2 w-28">총 건수</th>
            {board.stages.map(st => (
              <th key={st.key} className="px-3 py-2 w-28" title={st.statuses.map(s => board.status_labels[s]).join(' · ')}>
                {st.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.all ? 'all' : `y${r.year}`} className={`border-t border-slate-100 text-center ${r.all ? 'bg-violet-50/40' : ''}`}>
              <td className={`text-left px-3 py-1.5 ${r.all ? 'font-bold' : 'font-medium'}`}>{r.all ? '전체' : r.year ? `${r.year}년` : '연도 없음'}</td>
              {cell(r, null, r.total, 'font-bold')}
              {board.stages.map(st => cell(r, st.key, r[st.key], `font-medium ${STAGE_STYLE[st.key]}`, tip(r, st)))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
        <span className="mr-auto">
          {board.stages.map(st => `${st.label} = ${st.statuses.map(s => board.status_labels[s]).join('·')}`).join(' / ')}
          <span className="ml-2 text-slate-400">숫자를 누르면 아래 목록이 그 심의건만 보이고, 마우스를 올리면 상태별 건수가 보입니다.</span>
        </span>
        {pick && (
          <button onClick={() => onPick(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200">
            {pickLabel} <X size={12} />
          </button>
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
        {template && <a download href={`${API_BASE_URL}/api/reviews/template/file/`} className={btnGhost}><Download size={14} /> 내려받기</a>}
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
        <div className="text-sm font-bold text-violet-800 mb-2">구매 사양 엑셀 (.xlsm / .xlsx, 선택)</div>
        <div className="flex items-center gap-3">
          <FileButton accept=".xlsm,.xlsx" onPick={(f) => setForm(s => ({ ...s, file: f }))} className={btnGhost}><Upload size={14} /> 파일 고르기</FileButton>
          <span className="text-sm text-slate-600 truncate">{form.file?.name || '선택한 파일 없음'}</span>
        </div>
        <p className="text-xs text-violet-700/80 mt-2">엑셀 없이 만들면 심의건 화면에서 구매 사양을 직접 입력합니다. 엑셀을 고르면 업무명을 비워 둬도 엑셀의 '구매 사양' 시트에서 읽어 옵니다.</p>
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
  const editorRef = useRef(null);
  const formMode = c.input_mode !== 'EXCEL';

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
  const setMode = (input_mode) => apiJson(`/api/reviews/${c.id}/`, jsonBody('PUT', { input_mode }))
    .then(onChanged).catch(err => showToast(err.message, 'error'));
  const generate = async () => {
    setBusy('generate');
    // 화면 입력: 저장하지 않은 변경이 있으면 먼저 저장
    if (formMode && editorRef.current?.isDirty()) {
      try { await editorRef.current.save(); } catch (err) { showToast(err.message, 'error'); setBusy(''); return; }
    }
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
                {STATUSES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
              <button onClick={() => setEdit({ title: c.title, line: c.line, product: c.product, year: c.year, note: c.note })} className={btnGhost}><Pencil size={14} /> 수정</button>
              <button onClick={onDelete} className={`${btn} bg-white border-red-200 text-red-600 hover:bg-red-50`}><Trash2 size={14} /></button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-sm font-bold text-slate-700">구매 사양</div>
          <div className="flex bg-slate-100 rounded-lg p-1">
            {[['FORM', '화면에서 입력'], ['EXCEL', '엑셀 올리기']].map(([k, label]) => (
              <button key={k} onClick={() => k !== c.input_mode && setMode(k)}
                className={`px-3 py-1 rounded-md text-xs font-bold ${c.input_mode === k ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>
        </div>
        {formMode ? (
          <SpecEditor ref={editorRef} c={c} showToast={showToast} onCaseChanged={onChanged} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <FileSpreadsheet size={20} className={c.has_source ? 'text-emerald-600' : 'text-slate-300'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800 truncate">{c.source_name || '아직 올리지 않았습니다.'}</div>
              {c.source_uploaded_at && <div className="text-xs text-slate-400">{fmtDateTime(c.source_uploaded_at)}</div>}
            </div>
            {c.has_source && <a download href={`${API_BASE_URL}/api/reviews/${c.id}/source/`} className={btnGhost}><Download size={14} /> 내려받기</a>}
            <FileButton accept=".xlsm,.xlsx" onPick={uploadExcel} disabled={!!busy} className={btnGhost}>
              {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {c.has_source ? '다시 올리기' : '올리기'}
            </FileButton>
          </div>
        )}
        <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {formMode
              ? (!c.item_count ? '구매 사양을 입력하고 저장해 주세요.' : !hasTemplate ? '위에서 PPT 템플릿을 먼저 올려 주세요.'
                : '화면에서 입력한 구매 사양으로 PPT와 배포용 엑셀을 만듭니다. 저장하지 않은 변경은 먼저 저장합니다.')
              : (!c.has_source ? '구매 사양 엑셀을 먼저 올려 주세요.' : !hasTemplate ? '위에서 PPT 템플릿을 먼저 올려 주세요.'
                : 'PC용 InvestPPT와 같은 방식으로 PPT와 배포용 엑셀(매크로 제거)을 만듭니다.')}
          </p>
          <button onClick={generate} disabled={!!busy || !hasTemplate || (formMode ? false : !c.has_source)}
            className={`${btn} px-5 py-2.5 bg-violet-600 border-violet-600 text-white hover:bg-violet-700 text-base font-bold shrink-0`}>
            {busy === 'generate' ? <Loader2 size={18} className="animate-spin" /> : <Presentation size={18} />} PPT·엑셀 만들기
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
                  {o.pptx_name && <a download href={`${API_BASE_URL}/api/reviews/outputs/${o.id}/pptx/`} className={btnGhost} title={o.pptx_name}><Presentation size={14} className="text-orange-500" /> PPT</a>}
                  {o.xlsx_name && <a download href={`${API_BASE_URL}/api/reviews/outputs/${o.id}/xlsx/`} className={btnGhost} title={o.xlsx_name}><FileSpreadsheet size={14} className="text-emerald-600" /> 배포용 엑셀</a>}
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
// 품목 CIS 코드는 'CIS 코드 관리' 탭, 값 입력·수정은 'Part 등록' 탭에서 한다
const MASTER_TABS = [['lists', '선택 목록'], ['cpus', 'CPU 사양'], ['check', '검증']];
const CHECK_LEVEL = {
  fix: ['정리 가능', 'bg-blue-50 text-blue-700 border-blue-200'],
  ask: ['확인 필요', 'bg-amber-50 text-amber-700 border-amber-200'],
  info: ['참고', 'bg-slate-50 text-slate-500 border-slate-200'],
};
const IMPORT_LABELS = { codes: '품목 CIS 코드', lists: '선택 목록', cpus: 'CPU 사양' };

function Master({ showToast }) {
  const [data, setData] = useState(null);
  const [sub, setSub] = useState('lists');
  const [q, setQ] = useState('');
  const [importState, setImportState] = useState(null); // { file, preview, busy }
  const [checkState, setCheckState] = useState(null); // { issues, changes, busy }

  const load = () => apiJson('/api/reviews/master/').then(d => { setData(d); setCheckState(null); }).catch(err => showToast(err.message, 'error'));
  const runCheck = () => {
    setCheckState(s => ({ ...(s || {}), busy: true }));
    apiJson('/api/reviews/master/check/').then(d => setCheckState({ issues: d.issues, changes: null, busy: false }))
      .catch(err => { showToast(err.message, 'error'); setCheckState(null); });
  };
  const fixSafe = () => {
    setCheckState(s => ({ ...s, busy: true }));
    apiJson('/api/reviews/master/check/fix/', jsonBody('POST', {}))
      .then(d => {
        setCheckState({ issues: d.issues, changes: d.changes, busy: false });
        apiJson('/api/reviews/master/').then(setData).catch(() => {});
        showToast(`공백·중복 ${d.changes.length}건을 정리했습니다.`);
      })
      .catch(err => { showToast(err.message, 'error'); setCheckState(s => ({ ...s, busy: false })); });
  };
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
      .then(() => { setImportState(null); load(); showToast('없는 값을 기준정보에 더했습니다.'); })
      .catch(err => { showToast(err.message, 'error'); setImportState(s => ({ ...s, busy: false })); });
  };

  const match = (...vals) => !q || vals.join(' ').toLowerCase().includes(q.toLowerCase());
  const missing = useMemo(() => (data?.codes || []).filter(p => !CIS_OK.test(p.cis_code.trim())).length, [data]);
  const groups = useMemo(() => {
    const out = {};
    (data?.lists || []).filter(l => match(l.label, l.name, l.values.join(' '))).forEach(l => { (out[l.group] ||= []).push(l); });
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
          구매 사양 화면에서 고르는 기준정보입니다. <b>ITAMS가 기준</b>이라 매크로 엑셀을 올려도 이미 있는 값은 바꾸거나 지우지 않고, 없는 값만 더합니다.
          {missing > 0 && <span className="ml-2 text-amber-600 font-medium">CIS 코드 확인 필요 {missing}개 ('CIS 코드 관리' 탭)</span>}
        </div>
        <FileButton accept=".xlsm,.xlsx" onPick={pickImport} className={btnPrimary}><Upload size={14} /> 매크로 엑셀에서 없는 값 추가</FileButton>
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
                      <div className="font-bold text-slate-700">{label} <span className="font-normal text-slate-400">엑셀 {r.total}개</span></div>
                      <div className="text-xs text-slate-500 mt-1">추가 {r.added} · 빈칸 채움 {r.filled}
                        {r.skipped > 0 && <span title="화면이나 정리 명령으로 지우거나 이름을 바꾼 값"> · 예전에 지운 값이라 건너뜀 {r.skipped}</span>}</div>
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
                  {importState.busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} 없는 값 추가하기
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {empty ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          아직 기준정보가 없습니다. 처음 한 번은 위의 '매크로 엑셀에서 없는 값 추가'로 심의 매크로 엑셀을 올려 주세요.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0 flex-1">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {MASTER_TABS.map(([k, label]) => (
                <button key={k} onClick={() => { setSub(k); if (k === 'check' && !checkState) runCheck(); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sub === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {label} {data[k] && <span className="opacity-60">{data[k].length}</span>}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색" className={`${input} pl-8 py-1.5`} />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {sub === 'lists' && Object.entries(groups).map(([g, lists]) => (
              <div key={g} className="px-4 py-3 border-b border-slate-100">
                <div className="text-xs font-bold text-violet-600 uppercase mb-2">{g}</div>
                {lists.map(l => (
                  <div key={l.id} className="flex gap-3 py-1.5 text-sm">
                    <span className="w-56 shrink-0 text-sm font-medium text-slate-700" title={`엑셀 이름: ${l.name}\n위치: ${l.source}`}>{l.label || l.name}</span>
                    <div className="flex flex-wrap gap-1">{l.values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs">{v}</span>)}</div>
                  </div>
                ))}
              </div>
            ))}
            {sub === 'check' && (
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="flex-1 min-w-[260px]">서버 모델·CPU 호환 목록·품목 CIS 코드가 서로 맞는지 확인합니다. 공백·중복은 바로 정리할 수 있고, 나머지는 확인한 뒤 고쳐 주세요. CIS 코드는 고객사에서 받은 뒤 'CIS 코드 관리' 탭에서 입력하고, 목록 값은 'Part 등록' 탭에서 고칩니다.</span>
                  <button onClick={runCheck} disabled={checkState?.busy} className={btnGhost}>
                    {checkState?.busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} 다시 검사</button>
                  {(checkState?.issues || []).some(i => i.level === 'fix') && (
                    <button onClick={fixSafe} disabled={checkState?.busy} className={btnPrimary}>
                      <CheckCircle size={14} /> 공백·중복 정리 ({checkState.issues.filter(i => i.level === 'fix').length}건)</button>
                  )}
                </div>
                {checkState?.changes?.length > 0 && (
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-0.5">
                    <div className="font-bold text-blue-800 mb-1">정리한 내용</div>
                    {checkState.changes.map((c, i) => <div key={i}>{c.area} · {c.target}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}</div>)}
                  </div>
                )}
                {checkState?.issues && (checkState.issues.length === 0
                  ? <div className="text-sm text-emerald-600">문제가 없습니다.</div>
                  : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
                        <th className="text-left px-3 py-2 w-24">구분</th><th className="text-left px-3 py-2 w-28">영역</th>
                        <th className="text-left px-3 py-2">대상</th><th className="text-left px-3 py-2">문제</th><th className="text-left px-3 py-2">수정안</th></tr></thead>
                      <tbody>
                        {checkState.issues.filter(i => match(i.area, i.target, i.problem)).map((i, n) => (
                          <tr key={n} className="border-t border-slate-50 align-top">
                            <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded border text-xs whitespace-nowrap ${CHECK_LEVEL[i.level][1]}`}>{CHECK_LEVEL[i.level][0]}</span></td>
                            <td className="px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">{i.area}</td>
                            <td className="px-3 py-1.5 font-medium">{i.target}</td>
                            <td className="px-3 py-1.5 text-slate-600">{i.problem}</td>
                            <td className="px-3 py-1.5 text-slate-500">{i.suggestion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
              </div>
            )}
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
