import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Hash, Loader2, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import { apiJson, jsonBody } from '../api/client';
import MasterHistory from './MasterHistory';
import { btnGhost, btnPrimary, fmtDateTime, input } from './masterUi';

/*
 * CIS 코드 관리
 *  - 품목별 CIS 코드 추가·수정·삭제. CIS 코드는 고객사가 주는 값이라 직접 입력한다.
 *  - 이름 관리자 이름(code_*)은 PPT·배포용 엑셀이 CIS 코드를 찾을 때 쓰는 열쇠. 비우면 code_품목 으로 만든다.
 *  - 모든 변경은 이력에 남는다 (품목마다 / 전체).
 */
const CIS_OK = /^Q4\w{2}-\w+$/;
const EMPTY = { name: '', key: '', cis_code: '' };
const cell = 'border border-slate-200 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-400 w-full';

export default function CisCodeAdmin({ showToast, askDelete }) {
  const [codes, setCodes] = useState(null);
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [edit, setEdit] = useState(null); // { id?: 고치는 품목, name, key, cis_code }
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null); // { id?, title }

  const load = () => apiJson('/api/reviews/master/').then(d => setCodes(d.codes)).catch(err => showToast(err.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = useMemo(() => (codes || []).filter(p => !CIS_OK.test(p.cis_code.trim())).length, [codes]);
  const shown = (codes || []).filter(p => (!q || [p.name, p.key, p.cis_code].join(' ').toLowerCase().includes(q.toLowerCase()))
    && (!onlyMissing || !CIS_OK.test(p.cis_code.trim())));

  const save = () => {
    setBusy(true);
    const { id, ...payload } = edit;
    const req = id ? apiJson(`/api/reviews/master/codes/${id}/`, jsonBody('PUT', payload))
      : apiJson('/api/reviews/master/codes/', jsonBody('POST', payload));
    req.then(p => {
      setCodes(cs => (id ? cs.map(x => (x.id === p.id ? p : x)) : [...cs, p].sort((a, b) => a.name.localeCompare(b.name))));
      setEdit(null);
      showToast(id ? 'CIS 코드를 저장했습니다.' : `'${p.name}' 품목을 추가했습니다.`);
    }).catch(err => showToast(err.message, 'error')).finally(() => setBusy(false));
  };
  const keys = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null); };
  const del = (p) => askDelete({
    title: 'CIS 코드 품목 삭제', target: `${p.name} (${p.cis_code || '코드 없음'})`,
    url: `/api/reviews/master/codes/${p.id}/`,
    warnings: ['이 품목을 쓰는 PPT·배포용 엑셀에는 CIS 코드가 \'확인필요\'로 나옵니다.',
      '변경 이력에는 남고, 매크로 엑셀을 다시 가져와도 되살아나지 않습니다.'],
    onDone: () => { setCodes(cs => cs.filter(x => x.id !== p.id)); showToast('품목을 삭제했습니다.'); },
  });

  if (!codes) return <div className="p-6 text-center text-sm text-slate-400">불러오는 중...</div>;

  const editRow = (
    <tr className="border-t border-slate-100 bg-blue-50/40">
      <td className="px-3 py-1.5"><input autoFocus className={cell} value={edit?.name || ''} placeholder="품목 (예: R670)" onKeyDown={keys}
        onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} /></td>
      <td className="px-3 py-1.5"><input className={`${cell} font-mono`} value={edit?.cis_code || ''} placeholder="Q430-000000" onKeyDown={keys}
        onChange={e => setEdit(s => ({ ...s, cis_code: e.target.value }))} /></td>
      <td className="px-3 py-1.5"><input className={`${cell} font-mono text-xs`} value={edit?.key || ''} onKeyDown={keys}
        placeholder={`비우면 code_${(edit?.name || '품목').replace(/[ .\-(]/g, '_')}`}
        onChange={e => setEdit(s => ({ ...s, key: e.target.value }))} /></td>
      <td />
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <button onClick={save} disabled={busy} className="text-blue-600 hover:underline text-xs font-bold mr-2 inline-flex items-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} 저장</button>
        <button onClick={() => setEdit(null)} className="text-slate-400 hover:underline text-xs">취소</button>
      </td>
    </tr>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Hash size={18} className="text-violet-500" />
        <div className="text-sm text-slate-600 flex-1 min-w-[260px]">
          PPT·배포용 엑셀에 들어가는 품목별 CIS 코드입니다. <b>CIS 코드는 고객사에서 받은 값</b>을 그대로 입력해 주세요. 바꾼 내용은 모두 변경 이력에 남습니다.
          <span className="ml-2 text-slate-500">전체 {codes.length}개</span>
          {missing > 0 && <span className="ml-2 text-amber-600 font-medium">확인 필요 {missing}개</span>}
        </div>
        <button onClick={() => setHistory({ title: '품목 CIS 코드 전체' })} className={btnGhost}><Clock size={14} /> 전체 변경 이력</button>
        <button onClick={() => setEdit({ ...EMPTY })} disabled={edit && !edit.id} className={btnPrimary}><Plus size={14} /> 새 품목</button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0 flex-1">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="품목, CIS 코드, 이름 관리자 검색" className={`${input} pl-8 py-1.5`} />
          </div>
          <label className="text-sm text-slate-600 flex items-center gap-1.5">
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> 확인 필요만
          </label>
        </div>
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
              <tr><th className="text-left px-3 py-2 w-1/4">품목</th><th className="text-left px-3 py-2 w-1/4">CIS 코드</th>
                <th className="text-left px-3 py-2">이름 관리자</th><th className="text-left px-3 py-2 w-40">최근 수정</th><th className="w-36" /></tr>
            </thead>
            <tbody>
              {edit && !edit.id && editRow}
              {shown.length === 0 && !edit && <tr><td colSpan={5} className="p-6 text-center text-slate-400">품목이 없습니다.</td></tr>}
              {shown.map(p => (edit?.id === p.id ? <Fragment key={p.id}>{editRow}</Fragment> : (
                <tr key={p.id} className="border-t border-slate-50 hover:bg-slate-50 group">
                  <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                  <td className="px-3 py-2 font-mono">
                    {CIS_OK.test(p.cis_code.trim()) ? p.cis_code
                      : <span className="text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> {p.cis_code || '없음'}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{p.key}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{fmtDateTime(p.updated_at)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                    <button title="수정" onClick={() => setEdit({ id: p.id, name: p.name, key: p.key, cis_code: p.cis_code })} className="p-1 text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                    <button title="변경 이력" onClick={() => setHistory({ id: p.id, title: p.name })} className="p-1 text-slate-400 hover:text-blue-600"><Clock size={14} /></button>
                    <button title="삭제" onClick={() => del(p)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
      {history && <MasterHistory kind="codes" id={history.id} title={history.title} showToast={showToast} onClose={() => setHistory(null)} />}
    </div>
  );
}
