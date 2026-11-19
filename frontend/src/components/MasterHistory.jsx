import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Info, Loader2, User as UserIcon, X } from 'lucide-react';
import { apiJson } from '../api/client';
import { fmtDateTime } from './masterUi';

/*
 * 기준정보 변경 이력 (CIS 코드 관리·Part 등록 탭에서 같이 씀)
 *  서버 장비의 '상세 이력 조회'와 같은 타임라인 모양. kind: codes | lists | cpus, id를 주면 그 대상만.
 */

const TYPE = {
  Created: ['추가', 'bg-emerald-500', 'bg-emerald-100 text-emerald-700'],
  Updated: ['수정', 'bg-blue-500', 'bg-blue-100 text-blue-700'],
  Deleted: ['삭제', 'bg-red-500', 'bg-red-100 text-red-700'],
};

export default function MasterHistory({ kind, id, title, onClose, showToast }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams({ kind });
    if (id) p.set('id', id);
    apiJson(`/api/reviews/master/history/?${p}`).then(d => setItems(d.items))
      .catch(err => { showToast(err.message, 'error'); setItems([]); });
  }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[70] p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center"><Clock className="mr-2 text-blue-500" size={20} /> 변경 이력</h3>
            <p className="text-sm text-slate-500 mt-0.5">{title}{!id && ' (최근 200건)'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30">
          {items === null ? (
            <div className="flex justify-center h-24 items-center"><Loader2 className="animate-spin text-slate-400" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400"><Info size={36} className="mb-2" />기록된 이력이 없습니다.</div>
          ) : (
            <div className="relative border-l-2 border-slate-200 ml-3 pl-6 space-y-4">
              {items.map(h => {
                const [label, dot, chip] = TYPE[h.type];
                return (
                  <div key={h.history_id} className="relative">
                    <div className={`absolute -left-[31px] p-1.5 rounded-full border-2 border-white ${dot}`}><Clock size={10} className="text-white" /></div>
                    <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${chip}`}>{label}</span>
                        {!id && <span className="text-sm font-bold text-slate-800">{h.name}</span>}
                        <span className="text-sm text-slate-600">{fmtDateTime(h.date)}</span>
                        <span className="ml-auto text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono flex items-center"><UserIcon size={11} className="mr-1" />{h.user}</span>
                      </div>
                      {h.reason && <div className="text-xs text-slate-500 mb-1">사유: {h.reason}</div>}
                      <div className="space-y-1.5">
                        {h.changes.map((c, i) => (
                          <div key={i} className="text-sm flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                            <span className="font-bold text-slate-600 w-28 shrink-0 bg-slate-50 px-2 py-0.5 rounded text-xs">{c.field}</span>
                            <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
                              {c.old && <span className="text-red-500 line-through break-all">{c.old}</span>}
                              {c.old && c.new && <ArrowRight size={13} className="text-slate-400" />}
                              {c.new && <span className="text-emerald-600 font-medium break-all">{c.new}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
