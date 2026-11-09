import React, { useState } from 'react';
import { X, Upload, Download, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { apiJson, API_BASE_URL } from '../api/client';

// CSV 가져오기: 파일 선택 → 서버가 검증한 미리보기 → 오류 없는 행만 확정 저장
export default function ImportCsvModal({ rack, onClose, onImported, showToast }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const send = (mode, f = file) => {
    const form = new FormData();
    form.append('file', f);
    form.append('rack_id', rack.id);
    form.append('mode', mode);
    return apiJson('/api/server/import/', { method: 'POST', body: form });
  };

  const handleFile = (f) => {
    if (!f) return;
    setFile(f); setPreview(null); setBusy(true);
    send('preview', f)
      .then(setPreview)
      .catch(err => showToast(err.message, 'error'))
      .finally(() => setBusy(false));
  };

  const handleCommit = () => {
    setBusy(true);
    send('commit')
      .then(res => {
        const skipped = res.total - res.created;
        showToast(`${res.created}대를 가져왔습니다.${skipped ? ` (${skipped}행 제외)` : ''}`, 'success');
        onImported();
        onClose();
      })
      .catch(err => showToast(err.message, 'error'))
      .finally(() => setBusy(false));
  };

  const rows = (preview?.rows || []).filter(r =>
    filter === 'all' ? true : filter === 'error' ? r.errors.length : r.warnings.length);
  const warnCount = (preview?.rows || []).filter(r => r.warnings.length && !r.errors.length).length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center"><Upload size={20} className="mr-2 text-amber-600" /> CSV 가져오기</h3>
            <p className="text-sm text-slate-500 mt-0.5">대상 랙: <b>{rack.name}</b> ({rack.total_u_space || 42}U)</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 border-b border-slate-100 shrink-0 flex flex-wrap items-center gap-3">
          <label className={`px-4 py-2 rounded-lg text-sm font-bold border cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>
            {file ? '다른 파일 선택' : 'CSV 파일 선택'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {file && <span className="text-sm text-slate-600 font-mono">{file.name}</span>}
          <a href={`${API_BASE_URL}/api/server/import/template/`} className="ml-auto text-sm font-bold text-blue-600 hover:underline flex items-center">
            <Download size={14} className="mr-1" /> 양식 내려받기
          </a>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {busy && <p className="text-center text-slate-500 py-10">확인 중...</p>}

          {!busy && !preview && (
            <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <p className="font-bold text-slate-700 flex items-center"><Info size={14} className="mr-1 text-blue-500" /> 작성 방법</p>
              <p>· <b>hostname</b>, <b>start_u</b>(장비의 가장 아래 U)는 필수입니다. 나머지는 비워도 됩니다.</p>
              <p>· 엑셀에서는 <b>"CSV UTF-8"</b> 형식으로 저장하세요.</p>
              <p>· IP가 여러 개면 한 칸에 <b>;</b>로 구분해 적습니다. (예: 10.0.0.1;10.0.0.2)</p>
              <p>· 파일을 선택하면 먼저 검사 결과를 보여주고, 확인 버튼을 눌러야 저장됩니다.</p>
            </div>
          )}

          {!busy && preview && (
            <>
              <div className="flex flex-wrap gap-2 mb-4 text-sm">
                {[
                  ['all', `전체 ${preview.total}`, 'bg-slate-100 text-slate-700'],
                  ['error', `오류 ${preview.invalid}`, 'bg-red-50 text-red-700'],
                  ['warn', `경고 ${warnCount}`, 'bg-amber-50 text-amber-700'],
                ].map(([key, label, cls]) => (
                  <button key={key} onClick={() => setFilter(key)} className={`px-3 py-1 rounded-full font-bold border ${cls} ${filter === key ? 'border-current' : 'border-transparent'}`}>{label}</button>
                ))}
                <span className="px-3 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700">가져올 수 있음 {preview.valid}</span>
              </div>
              {preview.unknown_columns?.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
                  인식하지 못해 무시되는 열: {preview.unknown_columns.join(', ')}
                </p>
              )}
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#ddebf7] text-slate-800">
                    {['행', '결과', 'Hostname', 'Model', 'U', '크기', '상태', '내용'].map(h => <th key={h} className="border border-slate-300 p-1.5 text-left">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.line} className={r.errors.length ? 'bg-red-50/60' : r.warnings.length ? 'bg-amber-50/50' : ''}>
                      <td className="border border-slate-200 p-1.5 text-slate-500">{r.line}</td>
                      <td className="border border-slate-200 p-1.5">
                        {r.errors.length
                          ? <span className="text-red-600 font-bold flex items-center"><AlertTriangle size={12} className="mr-1" />제외</span>
                          : <span className="text-emerald-600 font-bold flex items-center"><CheckCircle size={12} className="mr-1" />가능</span>}
                      </td>
                      <td className="border border-slate-200 p-1.5 font-mono">{r.hostname || '-'}</td>
                      <td className="border border-slate-200 p-1.5">{r.model_name}</td>
                      <td className="border border-slate-200 p-1.5 font-mono">{r.start_u}</td>
                      <td className="border border-slate-200 p-1.5 font-mono">{r.size_u}</td>
                      <td className="border border-slate-200 p-1.5">{r.status}</td>
                      <td className="border border-slate-200 p-1.5">
                        {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-600">{e}</div>)}
                        {r.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">{w}</div>)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">해당하는 행이 없습니다.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button
            onClick={handleCommit}
            disabled={busy || !preview?.valid}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {preview?.valid ? `${preview.valid}대 가져오기${preview.invalid ? ` (오류 ${preview.invalid}행 제외)` : ''}` : '가져오기'}
          </button>
        </div>
      </div>
    </div>
  );
}
