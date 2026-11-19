import { useEffect, useMemo, useState } from 'react';
import { Boxes, Clock, Cpu, Loader2, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { apiJson, jsonBody } from '../api/client';
import MasterHistory from './MasterHistory';
import { btnGhost, btnPrimary, input } from './masterUi';

/*
 * Part 등록: 구매 사양 화면에서 고르는 부품(서버·스토리지·CPU·메모리·디스크·HBA·NIC·GPU·네트워크·OS·SW 등)을
 * 직접 추가·수정·삭제한다. 기준정보 원본은 ITAMS DB이고, 바꾼 내용은 모두 변경 이력에 남는다.
 *  - 목록(선택 목록)은 엑셀 이름 관리자 규칙의 이름을 쓴다 (예: 제조사_서버, 서버모델_DELL, List_R760)
 *  - 제조사를 추가하면 그 제조사의 모델 목록을, 서버 모델을 추가하면 그 모델의 CPU 호환 목록(List_모델)을 같이 만든다
 */

// SpecEditor와 같은 규칙: 모델 이름 → 목록 이름 조각
const us = (s) => String(s || '').trim().replace(/ /g, '_').replace(/\+/g, 'Plus');
const NEW_PREFIX = { server: '서버모델_', storage: '스토리지모델_', cpu: 'List_', card: 'GPU_', nw: '모델_', sw: 'SW_' };
const HINT = {
  server: '제조사를 추가하면 그 제조사의 서버모델 목록이, 서버 모델을 추가하면 그 모델의 CPU 호환 목록(CPU 탭)이 같이 만들어집니다.',
  storage: '제조사를 추가하면 그 제조사의 스토리지모델 목록이 같이 만들어집니다.',
  cpu: 'CPU 사양(클럭·코어)과 서버 모델별 CPU 호환 목록입니다. CPU를 추가할 때 호환되는 서버 모델을 골라 주세요.',
  card: 'GPU는 서버 모델마다 목록이 따로 있습니다 (GPU_모델).',
};
// 함께 만들 목록: 값 v를 목록 name에 더할 때
const companion = (name, v) => (name === '제조사_서버' ? `서버모델_${v}` : name === '제조사_스토리지' ? `스토리지모델_${v}`
  : name.startsWith('서버모델_') ? `List_${us(v)}` : null);
const sortLists = (a, b) => (b.name.startsWith('제조사_') - a.name.startsWith('제조사_')) || a.name.localeCompare(b.name);

export default function PartRegister({ showToast, askDelete }) {
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('server');
  const [q, setQ] = useState('');
  const [newList, setNewList] = useState(null); // 새 목록 이름
  const [history, setHistory] = useState(null); // { kind, id?, title }

  const load = () => apiJson('/api/reviews/master/').then(setData).catch(err => showToast(err.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byCat = useMemo(() => {
    const out = {};
    (data?.lists || []).forEach(l => { (out[l.category] ||= []).push(l); });
    Object.values(out).forEach(ls => ls.sort(sortLists));
    return out;
  }, [data]);

  const replaceList = (l) => setData(d => ({ ...d, lists: d.lists.some(x => x.id === l.id) ? d.lists.map(x => (x.id === l.id ? l : x)) : [...d.lists, l] }));
  const createList = (name, quiet) => apiJson('/api/reviews/master/lists/', jsonBody('POST', { name, values: [] }))
    .then(l => { replaceList(l); if (!quiet) showToast(`'${l.label || l.name}' 목록을 만들었습니다.`); return l; });

  const saveValues = (lst, values, added) => apiJson(`/api/reviews/master/lists/${lst.id}/`, jsonBody('PUT', { values }))
    .then(l => {
      replaceList(l);
      const extra = added && companion(l.name, added);
      if (extra && !data.lists.some(x => x.name.toLowerCase() === extra.toLowerCase())) {
        return createList(extra, true).then(n => showToast(`'${added}'을(를) 추가하고 '${n.label || n.name}' 목록도 만들었습니다.`));
      }
      showToast(added ? `'${added}'을(를) 추가했습니다.` : '저장했습니다.');
      return null;
    })
    .catch(err => { showToast(err.message, 'error'); throw err; });

  const delList = (l) => askDelete({
    title: '목록 삭제', target: `${l.label || l.name} (${l.name})`, url: `/api/reviews/master/lists/${l.id}/`,
    warnings: [`값 ${l.values.length}개가 함께 지워져 구매 사양 화면에서 고를 수 없게 됩니다.`, '이미 저장한 구매 사양은 바뀌지 않고, 변경 이력에는 남습니다.'],
    onDone: () => { setData(d => ({ ...d, lists: d.lists.filter(x => x.id !== l.id) })); showToast('목록을 삭제했습니다.'); },
  });

  if (!data) return <div className="p-6 text-center text-sm text-slate-400">불러오는 중...</div>;
  const cats = data.part_categories;
  const label = cats.find(c => c.key === cat)?.label;
  const match = (l) => !q || [l.label, l.name, ...l.values].join(' ').toLowerCase().includes(q.toLowerCase());
  const lists = (byCat[cat] || []).filter(match);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0">
      <div className="lg:w-56 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm p-2 h-fit">
        {cats.map(c => {
          const n = (byCat[c.key] || []).reduce((t, l) => t + l.values.length, 0);
          return (
            <button key={c.key} onClick={() => { setCat(c.key); setNewList(null); }}
              className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm ${cat === c.key ? 'bg-violet-600 text-white font-bold' : 'text-slate-700 hover:bg-slate-100'}`}>
              <span>{c.label}</span>
              <span className={`text-xs ${cat === c.key ? 'text-violet-100' : 'text-slate-400'}`}>{c.key === 'cpu' ? data.cpus.length : n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
          <Boxes size={18} className="text-violet-500" />
          <div className="flex-1 min-w-[240px]">
            <div className="font-bold text-slate-800">{label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{HINT[cat] || '구매 사양 화면에서 고르는 값입니다.'} 바꾼 내용은 변경 이력에 남습니다.</div>
          </div>
          <div className="relative w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색" className={`${input} pl-8 py-1.5`} />
          </div>
          <button onClick={() => setHistory({ kind: 'lists', title: '선택 목록 전체' })} className={btnGhost}><Clock size={14} /> 목록 변경 이력</button>
          <button onClick={() => setNewList(NEW_PREFIX[cat] || '')} className={btnGhost}><Plus size={14} /> 새 목록</button>
        </div>

        {newList !== null && (
          <NewListForm initial={newList} onCancel={() => setNewList(null)}
            onSave={(name) => createList(name).then(() => setNewList(null)).catch(err => showToast(err.message, 'error'))} />
        )}

        {cat === 'cpu' && <CpuTable data={data} q={q} reload={load} showToast={showToast} askDelete={askDelete} onHistory={setHistory} />}

        {lists.length === 0 && cat !== 'cpu' && (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            {q ? '찾는 값이 없습니다.' : "이 분류에 목록이 없습니다. '새 목록'으로 만들어 주세요."}
          </div>
        )}
        {cat === 'cpu' && lists.length > 0 && <div className="text-sm font-bold text-slate-600 px-1">서버 모델별 CPU 호환 목록</div>}
        {lists.map(l => (
          <ListCard key={l.id} lst={l} onSave={saveValues} onDelete={() => delList(l)} showToast={showToast}
            onHistory={() => setHistory({ kind: 'lists', id: l.id, title: `${l.label || l.name} (${l.name})` })} />
        ))}
      </div>
      {history && <MasterHistory kind={history.kind} id={history.id} title={history.title} showToast={showToast} onClose={() => setHistory(null)} />}
    </div>
  );
}

function NewListForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial);
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-violet-900">새 목록 이름</span>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} className={`${input} py-1.5 font-mono w-72`}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); if (e.key === 'Escape') onCancel(); }} />
      <span className="text-xs text-slate-500 flex-1">엑셀 이름 관리자 규칙대로 적어 주세요. (예: 서버모델_SUPERMICRO, List_R770, GPU_R760xa)</span>
      <button onClick={onCancel} className={btnGhost}>취소</button>
      <button onClick={() => onSave(name.trim())} disabled={!name.trim()} className={btnPrimary}><Plus size={14} /> 만들기</button>
    </div>
  );
}

// 목록 하나: 값 칩을 누르면 이름 바꾸기, X로 빼기, 아래 칸에서 추가
function ListCard({ lst, onSave, onDelete, onHistory }) {
  const [add, setAdd] = useState('');
  const [edit, setEdit] = useState(null); // { i, v }
  const [busy, setBusy] = useState(false);
  const run = (values, added) => { setBusy(true); return onSave(lst, values, added).finally(() => setBusy(false)); };
  const doAdd = () => {
    const v = add.trim();
    if (!v) return;
    if (lst.values.some(x => x.toLowerCase() === v.toLowerCase())) { setAdd(''); return; }
    run([...lst.values, v], v).then(() => setAdd('')).catch(() => {});
  };
  const doRename = () => {
    const v = edit.v.trim();
    if (!v || v === lst.values[edit.i]) { setEdit(null); return; }
    run(lst.values.map((x, i) => (i === edit.i ? v : x))).then(() => setEdit(null)).catch(() => {});
  };
  const remove = (i) => run(lst.values.filter((_, n) => n !== i)).catch(() => {});

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-bold text-slate-800">{lst.label || lst.name}</span>
        <span className="text-xs text-slate-400 font-mono">{lst.name}</span>
        <span className="text-xs text-slate-400">· {lst.values.length}개</span>
        {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
        <div className="ml-auto flex gap-1">
          <button title="변경 이력" onClick={onHistory} className="p-1 text-slate-400 hover:text-blue-600"><Clock size={14} /></button>
          <button title="목록 삭제" onClick={onDelete} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {lst.values.map((v, i) => (edit?.i === i ? (
          <input key={i} autoFocus value={edit.v} onChange={e => setEdit({ i, v: e.target.value })} onBlur={doRename}
            onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setEdit(null); }}
            className="border border-blue-400 rounded px-2 py-0.5 text-sm outline-none w-40" />
        ) : (
          <span key={i} className="group inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-sm">
            <button title="눌러서 이름 바꾸기" onClick={() => setEdit({ i, v })} className="hover:text-blue-700">{v}</button>
            <button title="빼기" onClick={() => remove(i)} disabled={busy} className="text-slate-300 hover:text-red-600"><X size={12} /></button>
          </span>
        )))}
        <span className="inline-flex items-center gap-1">
          <input value={add} onChange={e => setAdd(e.target.value)} placeholder="값 추가"
            onKeyDown={e => { if (e.key === 'Enter') doAdd(); }}
            className="border border-dashed border-slate-300 rounded px-2 py-0.5 text-sm outline-none focus:border-blue-400 w-36" />
          <button onClick={doAdd} disabled={busy || !add.trim()} className="p-1 text-blue-600 disabled:text-slate-300"><Plus size={14} /></button>
        </span>
      </div>
    </div>
  );
}

// CPU 사양 (클럭·코어) + 호환 서버 모델(List_*) 고르기
const EMPTY_CPU = { name: '', clock: '', cores: '', lists: [] };

function CpuTable({ data, q, reload, showToast, askDelete, onHistory }) {
  const [form, setForm] = useState(null); // { id?, name, clock, cores, lists }
  const [busy, setBusy] = useState(false);
  const compat = data.lists.filter(l => l.name.startsWith('List_')).sort(sortLists);
  const label = Object.fromEntries(compat.map(l => [l.name, l.label || l.name]));
  const cpus = data.cpus.filter(c => !q || [c.name, ...c.lists.map(n => label[n] || n)].join(' ').toLowerCase().includes(q.toLowerCase()));

  const save = () => {
    setBusy(true);
    const { id, ...payload } = form;
    (id ? apiJson(`/api/reviews/master/cpus/${id}/`, jsonBody('PUT', payload)) : apiJson('/api/reviews/master/cpus/', jsonBody('POST', payload)))
      .then(c => { setForm(null); reload(); showToast(id ? 'CPU를 저장했습니다.' : `'${c.name}' CPU를 추가했습니다.`); })
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(false));
  };
  const toggle = (n) => setForm(f => ({ ...f, lists: f.lists.includes(n) ? f.lists.filter(x => x !== n) : [...f.lists, n] }));
  const del = (c) => askDelete({
    title: 'CPU 삭제', target: c.name, url: `/api/reviews/master/cpus/${c.id}/`,
    warnings: ['CPU 호환 목록에서도 함께 빠집니다.', '이미 저장한 구매 사양은 바뀌지 않고, 변경 이력에는 남습니다.'],
    onDone: () => { reload(); showToast('CPU를 삭제했습니다.'); },
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Cpu size={16} className="text-violet-500" />
        <span className="font-bold text-slate-800">CPU 사양</span>
        <span className="text-xs text-slate-400">· {data.cpus.length}개</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => onHistory({ kind: 'cpus', title: 'CPU 사양 전체' })} className={btnGhost}><Clock size={14} /> CPU 변경 이력</button>
          <button onClick={() => setForm({ ...EMPTY_CPU })} className={btnPrimary}><Plus size={14} /> 새 CPU</button>
        </div>
      </div>
      {form && (
        <div className="p-4 bg-blue-50/50 border-b border-blue-100 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="md:col-span-2 text-xs text-slate-600">CPU 이름
              <input autoFocus className={input} value={form.name} placeholder="예: Xeon Gold 6526Y" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
            <label className="text-xs text-slate-600">클럭 (GHz)
              <input className={input} value={form.clock} placeholder="2.8" onChange={e => setForm(f => ({ ...f, clock: e.target.value }))} /></label>
            <label className="text-xs text-slate-600">코어 수
              <input className={input} value={form.cores} placeholder="16" onChange={e => setForm(f => ({ ...f, cores: e.target.value }))} /></label>
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">호환 서버 모델 (구매 사양에서 이 서버를 고르면 이 CPU가 나옵니다)</div>
            {compat.length === 0 ? <div className="text-xs text-slate-400">CPU 호환 목록이 없습니다. 서버 탭에서 서버 모델을 추가하면 만들어집니다.</div> : (
              <div className="flex flex-wrap gap-1.5">
                {compat.map(l => (
                  <label key={l.name} className={`px-2 py-0.5 rounded border text-xs cursor-pointer ${form.lists.includes(l.name) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200 text-slate-600'}`}>
                    <input type="checkbox" className="hidden" checked={form.lists.includes(l.name)} onChange={() => toggle(l.name)} />{label[l.name]}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setForm(null)} className={btnGhost}>취소</button>
            <button onClick={save} disabled={busy || !form.name.trim()} className={btnPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장</button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
          <th className="text-left px-4 py-2">CPU</th><th className="text-left px-4 py-2 w-24">클럭 (GHz)</th><th className="text-left px-4 py-2 w-20">코어</th>
          <th className="text-left px-4 py-2">호환 서버 모델</th><th className="w-28" /></tr></thead>
        <tbody>
          {cpus.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">CPU가 없습니다.</td></tr>}
          {cpus.map(c => (
            <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50">
              <td className="px-4 py-2 font-medium">{c.name}</td><td className="px-4 py-2">{c.clock}</td><td className="px-4 py-2">{c.cores}</td>
              <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{c.lists.map(n => <span key={n} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs">{label[n] || n}</span>)}</div></td>
              <td className="px-4 py-2 text-right whitespace-nowrap space-x-1">
                <button title="수정" onClick={() => setForm({ id: c.id, name: c.name, clock: c.clock, cores: c.cores, lists: [...c.lists] })} className="p-1 text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                <button title="변경 이력" onClick={() => onHistory({ kind: 'cpus', id: c.id, title: c.name })} className="p-1 text-slate-400 hover:text-blue-600"><Clock size={14} /></button>
                <button title="삭제" onClick={() => del(c)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
