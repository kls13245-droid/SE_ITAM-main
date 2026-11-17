import { useEffect, useState } from 'react';
import {
  MapPin, AlertTriangle, FileText, Settings2, Check, X, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, RotateCcw,
} from 'lucide-react';
import { apiJson, jsonBody } from '../api/client';

/*
 * 사이드바 메뉴 (그룹 + 메뉴). 연필(설정) 버튼으로 편집:
 *  - 그룹 추가 / 이름 바꾸기 / 삭제 / 순서 바꾸기
 *  - 메뉴를 끌어서 다른 그룹으로 옮기거나 순서 바꾸기 (화살표 버튼으로도 가능)
 * 배치는 계정마다 서버에 저장된다 (/api/me/sidebar/). 새로 생긴 메뉴는 마지막 그룹에 자동으로 붙는다.
 */

const DEFAULT_LAYOUT = {
  groups: [
    { name: 'Field', items: ['field', 'incidents'] },
    { name: 'Docs', items: ['reviews'] },
  ],
};

// 메뉴 정의: key → 표시 이름, 아이콘, 선택됐을 때 색
const MENU = {
  field: { label: '서버 현황', icon: MapPin, active: 'bg-orange-500/20 text-orange-300', iconActive: 'text-orange-400' },
  incidents: { label: '장애·유지보수 보고', icon: AlertTriangle, active: 'bg-red-500/20 text-red-300', iconActive: 'text-red-400' },
  reviews: { label: '투자심의 자료', icon: FileText, active: 'bg-violet-500/20 text-violet-300', iconActive: 'text-violet-400' },
};

// 저장된 배치를 지금 있는 메뉴에 맞춘다 (없어진 메뉴는 빼고, 새 메뉴는 마지막 그룹에 추가)
function normalize(layout) {
  const groups = (layout?.groups || DEFAULT_LAYOUT.groups).map(g => ({
    name: g.name || '',
    items: (g.items || []).filter(k => MENU[k]),
  }));
  if (!groups.length) groups.push({ name: '메뉴', items: [] });
  const used = new Set(groups.flatMap(g => g.items));
  const missing = Object.keys(MENU).filter(k => !used.has(k));
  if (missing.length) groups[groups.length - 1] = { ...groups[groups.length - 1], items: [...groups[groups.length - 1].items, ...missing] };
  return { groups };
}

const move = (arr, from, to) => {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
};

export default function SidebarMenu({ activeView, onOpen, showToast }) {
  const [layout, setLayout] = useState(() => normalize(DEFAULT_LAYOUT));
  const [draft, setDraft] = useState(null); // 편집 중인 배치
  const [drag, setDrag] = useState(null); // { g, i } 끌고 있는 메뉴
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson('/api/me/sidebar/').then(r => { if (r.layout) setLayout(normalize(r.layout)); })
      .catch(err => console.warn('사이드바 설정을 불러오지 못했습니다:', err.message));
  }, []);

  const notify = (msg, type) => showToast?.(msg, type);
  const save = () => {
    const clean = { groups: draft.groups.map(g => ({ name: g.name.trim() || '이름 없는 그룹', items: g.items })) };
    setSaving(true);
    apiJson('/api/me/sidebar/', jsonBody('PUT', { layout: clean }))
      .then(r => { setLayout(normalize(r.layout)); setDraft(null); notify('사이드바를 저장했습니다.'); })
      .catch(err => notify(err.message, 'error'))
      .finally(() => setSaving(false));
  };
  const reset = () => {
    if (!window.confirm('사이드바를 처음 배치로 되돌릴까요?')) return;
    apiJson('/api/me/sidebar/', { method: 'DELETE' })
      .then(() => { setLayout(normalize(DEFAULT_LAYOUT)); setDraft(null); notify('처음 배치로 되돌렸습니다.'); })
      .catch(err => notify(err.message, 'error'));
  };

  // 편집 동작
  const setGroups = (fn) => setDraft(d => ({ groups: fn(d.groups) }));
  const renameGroup = (gi, name) => setGroups(gs => gs.map((g, i) => (i === gi ? { ...g, name } : g)));
  const addGroup = () => setGroups(gs => [...gs, { name: '새 그룹', items: [] }]);
  const deleteGroup = (gi) => setGroups(gs => {
    if (gs.length === 1) return gs;
    const rest = gs.filter((_, i) => i !== gi);
    const target = gi === 0 ? 0 : gi - 1; // 메뉴는 바로 위 그룹으로
    rest[target] = { ...rest[target], items: [...rest[target].items, ...gs[gi].items] };
    return rest;
  });
  const moveGroup = (gi, dir) => setGroups(gs => (gi + dir < 0 || gi + dir >= gs.length ? gs : move(gs, gi, gi + dir)));
  const moveItem = (from, to) => setGroups(gs => {
    const next = gs.map(g => ({ ...g, items: [...g.items] }));
    const [key] = next[from.g].items.splice(from.i, 1);
    let idx = to.i ?? next[to.g].items.length;
    if (from.g === to.g && to.i != null && from.i < to.i) idx -= 1;
    next[to.g].items.splice(Math.max(0, idx), 0, key);
    return next;
  });
  // 화살표: 같은 그룹 안에서 한 칸, 끝이면 옆 그룹으로
  const stepItem = (gi, ii, dir) => setGroups(gs => {
    const next = gs.map(g => ({ ...g, items: [...g.items] }));
    const items = next[gi].items;
    if (ii + dir >= 0 && ii + dir < items.length) { next[gi].items = move(items, ii, ii + dir); return next; }
    const ng = gi + dir;
    if (ng < 0 || ng >= next.length) return gs;
    const [key] = items.splice(ii, 1);
    if (dir < 0) next[ng].items.push(key); else next[ng].items.unshift(key);
    return next;
  });

  const editing = !!draft;
  const groups = editing ? draft.groups : layout.groups;

  return (
    <div className="mb-2">
      <div className="flex items-center justify-end -mt-1 mb-1 gap-1">
        {editing ? (
          <>
            <button onClick={reset} className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded" title="처음 배치로"><RotateCcw size={13} /></button>
            <button onClick={() => setDraft(null)} className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded" title="취소"><X size={14} /></button>
            <button onClick={save} disabled={saving} className="px-2 py-0.5 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-1"><Check size={12} /> 저장</button>
          </>
        ) : (
          <button onClick={() => setDraft({ groups: layout.groups.map(g => ({ ...g, items: [...g.items] })) })}
            className="px-2 py-1 flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded" title="사이드바 메뉴 편집 (그룹·순서)">
            <Settings2 size={13} /> 메뉴 편집
          </button>
        )}
      </div>

      {groups.map((g, gi) => {
        if (!editing && g.items.length === 0) return null;
        return (
          <div key={gi} className={editing ? 'mb-3 rounded-lg border border-dashed border-slate-700 p-1.5' : 'mb-4'}
            onDragOver={editing ? (e) => e.preventDefault() : undefined}
            onDrop={editing ? (e) => { e.preventDefault(); if (drag) moveItem(drag, { g: gi }); setDrag(null); } : undefined}>
            {editing ? (
              <div className="flex items-center gap-1 mb-1">
                <input value={g.name} onChange={(e) => renameGroup(gi, e.target.value)} placeholder="그룹 이름"
                  className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500" />
                <button onClick={() => moveGroup(gi, -1)} disabled={gi === 0} className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30" title="그룹 위로"><ChevronUp size={14} /></button>
                <button onClick={() => moveGroup(gi, 1)} disabled={gi === groups.length - 1} className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30" title="그룹 아래로"><ChevronDown size={14} /></button>
                <button onClick={() => deleteGroup(gi)} disabled={groups.length === 1} className="p-0.5 text-slate-500 hover:text-red-400 disabled:opacity-30"
                  title={g.items.length ? '그룹 삭제 (메뉴는 위 그룹으로 옮겨짐)' : '그룹 삭제'}><Trash2 size={13} /></button>
              </div>
            ) : (
              g.name && <div className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase tracking-widest truncate">{g.name}</div>
            )}

            {g.items.map((key, ii) => {
              const m = MENU[key];
              const Icon = m.icon;
              const on = activeView === key;
              if (editing) {
                return (
                  <div key={key} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); setDrag({ g: gi, i: ii }); }} onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag) moveItem(drag, { g: gi, i: ii }); setDrag(null); }}
                    className={`flex items-center p-1.5 rounded mb-0.5 bg-slate-800/70 cursor-grab select-none ${drag?.g === gi && drag?.i === ii ? 'opacity-40' : ''}`}>
                    <GripVertical size={14} className="text-slate-600 mr-1 shrink-0" />
                    <Icon size={16} className="mr-2 shrink-0 text-slate-400" />
                    <span className="truncate flex-1 text-sm">{m.label}</span>
                    <button onClick={() => stepItem(gi, ii, -1)} className="p-0.5 text-slate-500 hover:text-slate-200" title="위로"><ChevronUp size={13} /></button>
                    <button onClick={() => stepItem(gi, ii, 1)} className="p-0.5 text-slate-500 hover:text-slate-200" title="아래로"><ChevronDown size={13} /></button>
                  </div>
                );
              }
              return (
                <button key={key} onClick={() => onOpen(key)}
                  className={`w-full flex items-center p-2 rounded mb-1 text-left ${on ? `${m.active} font-medium` : 'hover:bg-slate-800'}`}>
                  <Icon size={18} className={`mr-2 shrink-0 ${on ? m.iconActive : 'text-slate-500'}`} />
                  <span className="truncate">{m.label}</span>
                </button>
              );
            })}
            {editing && g.items.length === 0 && <div className="text-[11px] text-slate-600 px-2 py-1.5">메뉴를 여기로 끌어 오세요</div>}
          </div>
        );
      })}

      {editing && (
        <button onClick={addGroup} className="w-full flex items-center justify-center gap-1 text-xs font-bold text-slate-400 hover:text-white border border-dashed border-slate-700 hover:border-slate-500 rounded-lg py-1.5 mb-3">
          <Plus size={12} /> 그룹 추가
        </button>
      )}
    </div>
  );
}
