// 현장 장비 화면에서 함께 쓰는 값 (백엔드 assets/services.py 의 목록과 맞춰야 함)
// monday 보드의 상태 색과 비슷하게 맞춤
export const STATUS_STYLE = {
  '가동': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '확인 필요': 'bg-slate-200 text-slate-700 border-slate-300',
  '운영 전환': 'bg-slate-600 text-white border-slate-600',
  'Parts 교체 필요': 'bg-pink-100 text-pink-700 border-pink-200',
  '유휴 서버 전환': 'bg-sky-100 text-sky-700 border-sky-200',
  '사용불가': 'bg-red-100 text-red-700 border-red-200',
  '폐기': 'bg-amber-100 text-amber-700 border-amber-200',
  'Setup 전': 'bg-blue-100 text-blue-700 border-blue-200',
};
export const PARTS = [['cpu', 'CPU'], ['memory', 'MEM'], ['network', 'NET'], ['disk', 'DISK'], ['fans', 'FAN'], ['cache_battery', 'BAT']];

export const FIELD_STATUSES = ['가동', 'Setup 전', '운영 전환', '확인 필요', 'Parts 교체 필요', '유휴 서버 전환', '사용불가', '폐기'];
export const IPMI_STATUSES = ['접속 가능', '접속 불가', '확인 필요', 'IP 없음'];
export const PM_STATUSES = ['완료', '확인 필요', '미사용'];
export const HEALTH_VALUES = ['정상', 'Fault', 'Disable'];
