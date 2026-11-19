// ADB 심의 기준정보 화면(CIS 코드 관리·Part 등록)에서 같이 쓰는 모양
export const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50';
export const btnGhost = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
export const btnPrimary = `${btn} bg-blue-600 border-blue-600 text-white hover:bg-blue-700`;
export const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500';
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
