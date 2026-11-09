import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Lock, X } from 'lucide-react';

/*
 * 삭제 확인 창: 경고 문구를 보여주고 관리자 아이디/비밀번호를 받아 삭제한다.
 * request = { title, target, warnings: [문구...], onConfirm: ({admin_username, admin_password}) => Promise }
 * onConfirm이 실패하면(비밀번호 틀림 등) 창을 닫지 않고 오류를 보여준다.
 */
export default function DeleteConfirmModal({ request, defaultUsername, onClose }) {
  const [username, setUsername] = useState(defaultUsername || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);
  const userRef = useRef(null);

  useEffect(() => {
    (defaultUsername ? pwRef : userRef).current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [defaultUsername, onClose, busy]);

  const submit = (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    Promise.resolve(request.onConfirm({ admin_username: username.trim(), admin_password: password }))
      .then(() => onClose())
      .catch(err => { setError(err.message); setPassword(''); setBusy(false); pwRef.current?.focus(); });
  };

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[90] p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 bg-red-50 border-b border-red-100 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-full text-red-600 shrink-0"><AlertTriangle size={20} /></div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-red-700">{request.title}</h3>
              <p className="text-sm text-slate-700 mt-0.5 break-all"><b>{request.target}</b></p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <ul className="text-sm text-red-700 bg-red-50/60 border border-red-100 rounded-lg p-3 space-y-1 list-disc pl-5">
            {request.warnings.map((w, i) => <li key={i}>{w}</li>)}
            <li className="font-bold">삭제하면 되돌릴 수 없습니다.</li>
          </ul>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-600 flex items-center"><Lock size={12} className="mr-1" /> 관리자 확인</p>
            <input ref={userRef} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="관리자 아이디" autoComplete="username"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400" />
            <input ref={pwRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="관리자 비밀번호" autoComplete="current-password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400" />
            {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button type="submit" disabled={busy || !username.trim() || !password}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
            {busy ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
