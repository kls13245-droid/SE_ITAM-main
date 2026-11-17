import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MapPin, Search, Upload, Download, X, ExternalLink, AlertTriangle, CheckCircle,
  Wrench, Wifi, ClipboardList, Server, ChevronUp, ChevronDown, Plus, Pencil, Trash2, LayoutGrid, ClipboardCheck,
} from 'lucide-react';
import { apiJson, jsonBody, API_BASE_URL } from '../api/client';
import FieldAssetForm, { PMRecordForm, PMRecordList } from './FieldAssetForm';
import FieldAssetBulk from './FieldAssetBulk';
import { PARTS, STATUS_STYLE } from './fieldAssetConstants';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';

// monday 'SE파트 - PM 현황' 보드 (항목 링크용)
const MONDAY_ITEM_URL = 'https://mirero-company.monday.com/boards/9255835900/pulses/';

const IPMI_STYLE = { '접속 가능': 'text-emerald-600', '접속 불가': 'text-red-600', '확인 필요': 'text-slate-500', 'IP 없음': 'text-amber-600' };
const ATTENTION_STATUSES = ['확인 필요', 'Parts 교체 필요', '사용불가'];

const faultParts = (a) => PARTS.filter(([k]) => a.health?.[k] === 'Fault').map(([, label]) => label);

// 줄 왼쪽 상태 표시등 (랙 앞 LED처럼): 부품 Fault > 점검 필요·PM 미완료 > 미사용 > 정상
const OFF_STATUSES = ['유휴 서버 전환', '폐기'];
const ledOf = (a) => {
  const faults = faultParts(a);
  if (faults.length) return { color: '#D9362B', label: `부품 Fault: ${faults.join(', ')}` };
  if (OFF_STATUSES.includes(a.status) || a.pm_status === '미사용') return { color: '#9AA5B1', label: '미사용' };
  if (ATTENTION_STATUSES.includes(a.status)) return { color: '#E0A100', label: `점검 필요: ${a.status}` };
  if (a.pm_status !== '완료') return { color: '#E0A100', label: 'PM 미완료' };
  return { color: '#2F9E6E', label: '정상' };
};
const LED_LEGEND = [['#2F9E6E', '정상'], ['#E0A100', 'PM 미완료·점검 필요'], ['#D9362B', '부품 Fault'], ['#9AA5B1', '미사용']];

const QUICK_FILTERS = {
  all: { label: '전체', icon: Server, test: () => true, tone: 'text-slate-800' },
  running: { label: '가동', icon: CheckCircle, test: a => a.status === '가동', tone: 'text-emerald-600' },
  attention: { label: '점검 필요', icon: AlertTriangle, test: a => ATTENTION_STATUSES.includes(a.status), tone: 'text-red-600', hint: '확인 필요 · Parts 교체 · 사용불가' },
  fault: { label: '부품 Fault', icon: Wrench, test: a => faultParts(a).length > 0, tone: 'text-pink-600' },
  ipmi: { label: 'IPMI 접속 불가', icon: Wifi, test: a => a.ipmi_status === '접속 불가', tone: 'text-amber-600' },
  pm: { label: 'PM 미완료', icon: ClipboardList, test: a => a.pm_status !== '완료', tone: 'text-blue-600', hint: 'PM 상태가 완료가 아닌 장비' },
};

const COLUMNS = [
  ['hostname', 'Hostname'], ['site_group', '현장'], ['complex', '단지'], ['product', '제품'], ['status', '상태'],
  ['model_name', 'Model'], ['serial_number', 'S/N'], ['ipmi_ip', 'IPMI IP'], ['public_ip', 'Public IP'],
  ['private_ip', 'Private IP'], ['ipmi_status', 'IPMI'], ['pm_date', 'PM 날짜'], ['health', '부품'], ['note', '비고'],
];

const uniq = (items, key) => [...new Set(items.map(i => i[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

export default function FieldAssets({ showToast, focusId, onFocusHandled, askDelete, onPlaced, onOpenRack }) {
  const [data, setData] = useState({ items: [], last_imported_at: null });
  const [loading, setLoading] = useState(true);
  const [quick, setQuick] = useState('all');
  const [filters, setFilters] = useState({ q: '', complex: '', product: '', site_group: '', status: '' });
  const [sort, setSort] = useState({ key: 'site_group', dir: 'asc' });
  const [selectedId, setSelectedId] = useState(null);
  const [formAsset, setFormAsset] = useState(null); // {} = 새 장비, 장비 객체 = 수정
  const [importState, setImportState] = useState(null); // { file, preview, busy }
  const [placeState, setPlaceState] = useState(null); // { preview, busy } 랙 배치 확인 창
  const [checked, setChecked] = useState(() => new Set()); // 여러 대 한꺼번에 바꾸기용 선택
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = () => apiJson('/api/field-assets/')
    .then(setData)
    .catch(err => showToast(err.message, 'error'))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const items = data.items;
  const selected = items.find(a => a.id === selectedId) || null;
  const unplacedCount = items.filter(a => !a.rack).length;

  // 아직 랙에 없는 장비를 랙에 임시 배치 (먼저 결과를 보여주고 확인 후 실행)
  const startPlace = () => {
    setPlaceState({ preview: null, busy: true });
    apiJson('/api/field-assets/place/', jsonBody('POST', { mode: 'preview' }))
      .then(preview => setPlaceState({ preview, busy: false }))
      .catch(err => { showToast(err.message, 'error'); setPlaceState(null); });
  };
  const commitPlace = () => {
    setPlaceState(st => ({ ...st, busy: true }));
    apiJson('/api/field-assets/place/', jsonBody('POST', {}))
      .then(r => {
        showToast(`${r.placed}대를 랙에 배치했습니다.${r.racks_created ? ` (새 랙 ${r.racks_created}개)` : ''}`);
        setPlaceState(null); load(); onPlaced?.();
      })
      .catch(err => { showToast(err.message, 'error'); setPlaceState(st => ({ ...st, busy: false })); });
  };

  // 상단 전체 검색에서 고른 장비를 바로 열기 (목록을 다시 받아온 뒤)
  useEffect(() => {
    if (!focusId) return;
    load().then(() => { setSelectedId(focusId); onFocusHandled?.(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // 서버가 돌려준 장비 한 대를 목록에 반영 (추가/수정/PM 기록 후)
  const applyAsset = (asset) => setData(prev => ({
    ...prev,
    items: prev.items.some(a => a.id === asset.id)
      ? prev.items.map(a => (a.id === asset.id ? asset : a))
      : [...prev.items, asset],
  }));
  const saveAsset = (form) => {
    const isNew = !form.id;
    return apiJson(isNew ? '/api/field-assets/add/' : `/api/field-assets/update/${form.id}/`, jsonBody(isNew ? 'POST' : 'PUT', form))
      .then(asset => {
        applyAsset(asset); setFormAsset(null); setSelectedId(asset.id);
        showToast(isNew ? '장비를 추가했습니다.' : '장비 정보를 저장했습니다.');
      })
      .catch(err => showToast(err.message, 'error'));
  };
  const saveBulk = (payload) => apiJson('/api/field-assets/bulk/', jsonBody('POST', payload))
    .then(r => {
      const byId = Object.fromEntries(r.items.map(a => [a.id, a]));
      setData(prev => ({ ...prev, items: prev.items.map(a => byId[a.id] || a) }));
      setBulkOpen(false); setChecked(new Set());
      showToast(`서버 ${r.updated}대를 한꺼번에 바꿨습니다.`);
    })
    .catch(err => showToast(err.message, 'error'));
  const toggleCheck = (id) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const deleteAsset = (asset) => askDelete({
    title: '서버 삭제', target: `${asset.hostname} (${asset.site_group || '현장 미지정'})`,
    url: `/api/field-assets/delete/${asset.id}/`,
    warnings: ['이 장비의 PM 점검 기록이 모두 함께 삭제됩니다.', '랙에 자동 배치된 장비가 있다면 그쪽은 따로 남습니다.'],
    onDone: () => {
      setData(prev => ({ ...prev, items: prev.items.filter(a => a.id !== asset.id) }));
      setSelectedId(null); showToast('장비를 삭제했습니다.');
    },
  });

  const options = useMemo(() => ({
    complex: uniq(items, 'complex'), product: uniq(items, 'product'),
    site_group: uniq(items, 'site_group'), status: uniq(items, 'status'),
  }), [items]);

  const counts = useMemo(() => Object.fromEntries(
    Object.entries(QUICK_FILTERS).map(([k, f]) => [k, items.filter(f.test).length])), [items]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const list = items.filter(a =>
      QUICK_FILTERS[quick].test(a)
      && ['complex', 'product', 'site_group', 'status'].every(k => !filters[k] || a[k] === filters[k])
      && (!q || [a.hostname, a.serial_number, a.model_name, a.ipmi_ip, a.public_ip, a.private_ip, a.note, a.site_group]
        .some(v => (v || '').toLowerCase().includes(q))));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const va = sort.key === 'health' ? faultParts(a).length : (a[sort.key] || '');
      const vb = sort.key === 'health' ? faultParts(b).length : (b[sort.key] || '');
      if (typeof va === 'number') return (va - vb) * dir;
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return String(va).localeCompare(String(vb), 'ko', { numeric: true }) * dir
        || a.hostname.localeCompare(b.hostname, 'ko', { numeric: true });
    });
  }, [items, quick, filters, sort]);

  const setFilter = (k, v) => setFilters(prev => ({ ...prev, [k]: v }));
  const resetFilters = () => { setFilters({ q: '', complex: '', product: '', site_group: '', status: '' }); setQuick('all'); };
  const toggleSort = (key) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  // 화면에 보이는 목록 그대로 CSV로 내보내기
  const exportCsv = () => {
    const header = COLUMNS.map(([, label]) => label);
    const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = rows.map(a => COLUMNS.map(([k]) => esc(k === 'health' ? faultParts(a).join(' ') : a[k])).join(','));
    const blob = new Blob(['﻿' + [header.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `서버현황_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const sendImport = (file, mode) => {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    return apiJson('/api/field-assets/import/', { method: 'POST', body: form });
  };
  const pickImportFile = (file) => {
    if (!file) return;
    setImportState({ file, preview: null, busy: true });
    sendImport(file, 'preview')
      .then(preview => setImportState({ file, preview, busy: false }))
      .catch(err => { showToast(err.message, 'error'); setImportState(null); });
  };
  const commitImport = () => {
    setImportState(s => ({ ...s, busy: true }));
    sendImport(importState.file, 'commit')
      .then(r => {
        const extra = [r.kept && `ITAM 수정분 ${r.kept}대 유지`, r.duplicates?.length && `중복 ${r.duplicates.length}건 제외`].filter(Boolean).join(', ');
        showToast(`신규 ${r.created}대, 갱신 ${r.updated}대를 반영했습니다.${extra ? ` (${extra})` : ''}`);
        setImportState(null); load();
      })
      .catch(err => { showToast(err.message, 'error'); setImportState(s => ({ ...s, busy: false })); });
  };

  const filtered = quick !== 'all' || Object.values(filters).some(Boolean);
  const checkedAssets = items.filter(a => checked.has(a.id));
  const allRowsChecked = rows.length > 0 && rows.every(a => checked.has(a.id));
  const toggleAllRows = () => setChecked(prev => {
    const next = new Set(prev);
    if (allRowsChecked) rows.forEach(a => next.delete(a.id)); else rows.forEach(a => next.add(a.id));
    return next;
  });

  return (
    <div className="flex-1 flex flex-col gap-4 min-w-0 w-full max-w-[1800px] mx-auto">
      {/* 제목 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center"><MapPin className="text-orange-500 mr-2" size={22} /> 서버 현황</h2>
          <p className="text-slate-500 text-sm mt-1">
            고객사 현장에 설치된 서버와 PM 현황입니다. 여러 대를 체크하면 한꺼번에 PM 기록·정보를 바꿀 수 있습니다. · 마지막 CSV 등록 <b>{fmtDateTime(data.last_imported_at)}</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unplacedCount > 0 && (
            <button onClick={startPlace} title="아직 랙 구성도에 없는 장비를 단지 > 현장 > 제품별 랙에 임시로 넣습니다"
              className="px-3 py-2 flex items-center bg-violet-600 text-white hover:bg-violet-700 rounded-lg text-xs font-bold">
              <LayoutGrid size={14} className="mr-1.5" /> 랙에 배치 <span className="ml-1.5 bg-white/25 rounded px-1.5">미배치 {unplacedCount}대</span>
            </button>
          )}
          <button onClick={() => setFormAsset({})} className="px-3 py-2 flex items-center bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-xs font-bold">
            <Plus size={14} className="mr-1.5" /> 서버 추가
          </button>
          <label className="px-3 py-2 flex items-center bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-xs font-bold cursor-pointer">
            <Upload size={14} className="mr-1.5" /> CSV로 등록
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { pickImportFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <a href={`${API_BASE_URL}/api/field-assets/import/template/`} title="PM 현황(monday)과 같은 열의 빈 양식"
            className="px-3 py-2 flex items-center bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold">
            <Download size={14} className="mr-1.5" /> 등록 양식
          </a>
          <button onClick={exportCsv} disabled={!rows.length} className="px-3 py-2 flex items-center bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold disabled:opacity-40">
            <Download size={14} className="mr-1.5" /> 보이는 목록 내보내기
          </button>
        </div>
      </div>

      {/* 요약 카드 (누르면 해당 장비만 보기) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {Object.entries(QUICK_FILTERS).map(([key, f]) => {
          const Icon = f.icon;
          return (
            <button key={key} onClick={() => setQuick(key)} title={f.hint || ''}
              className={`text-left bg-white p-4 rounded-xl border shadow-sm transition-all ${quick === key ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="text-slate-500 text-xs font-bold flex items-center"><Icon size={14} className={`mr-1.5 ${f.tone}`} />{f.label}</div>
              <div className={`text-3xl font-black mt-1 ${f.tone}`}>{counts[key] ?? 0}<span className="text-sm font-medium text-slate-400 ml-1">대</span></div>
            </button>
          );
        })}
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Hostname, IP, S/N, 모델, 비고 검색"
            className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {[['complex', '단지'], ['site_group', '현장'], ['product', '제품'], ['status', '상태']].map(([k, label]) => (
          <select key={k} value={filters[k]} onChange={(e) => setFilter(k, e.target.value)}
            className={`border rounded-lg py-2 px-2 text-sm outline-none max-w-[200px] ${filters[k] ? 'border-blue-400 bg-blue-50 text-blue-800 font-bold' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            <option value="">{label} 전체</option>
            {options[k].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {filtered && <button onClick={resetFilters} className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2">필터 초기화</button>}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          {LED_LEGEND.map(([c, label]) => <span key={label} className="inline-flex items-center gap-1"><span className="w-1.5 h-3 rounded-sm" style={{ background: c }} />{label}</span>)}
        </span>
        <span className="text-xs text-slate-500"><b className="text-slate-800">{rows.length}</b> / {items.length}대</span>
      </div>

      {/* 선택한 서버 한꺼번에 바꾸기 */}
      {checked.size > 0 && (
        <div className="bg-blue-600 text-white rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-sm sticky top-0 z-20">
          <span className="text-sm font-bold">{checked.size}대 선택</span>
          <button onClick={() => setBulkOpen(true)} className="px-3 py-1.5 rounded-lg bg-white text-blue-700 text-xs font-bold flex items-center hover:bg-blue-50">
            <ClipboardCheck size={14} className="mr-1.5" /> 한꺼번에 바꾸기 (PM 기록 · 정보)
          </button>
          <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-blue-100 hover:text-white">선택 해제</button>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 min-h-[300px] overflow-auto">
        {loading ? (
          <p className="text-center text-slate-500 py-16">불러오는 중...</p>
        ) : items.length === 0 ? (
          <div className="text-center text-slate-500 py-16 px-6">
            <MapPin size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="font-bold text-slate-600">아직 등록된 서버가 없습니다.</p>
            <p className="text-sm mt-1">오른쪽 위 <b>등록 양식</b>을 받아 작성한 뒤 <b>CSV로 등록</b>으로 올리거나, <b>장비 추가</b>로 한 대씩 등록하세요.</p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse" style={{ fontFamily: "'IBM Plex Sans KR', sans-serif" }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-white text-slate-500">
                <th className="border-b border-slate-200 px-2 py-2.5 w-8">
                  <input type="checkbox" checked={allRowsChecked} onChange={toggleAllRows} title="보이는 목록 전체 선택/해제" />
                </th>
                <th className="border-b border-slate-200 px-1 py-2.5 w-3"><span className="sr-only">상태 표시</span></th>
                {COLUMNS.map(([k, label]) => (
                  <th key={k} onClick={() => toggleSort(k)} className="border-b border-slate-200 px-2 py-2.5 text-left font-medium whitespace-nowrap cursor-pointer select-none hover:text-slate-800 hover:bg-slate-50">
                    <span className="inline-flex items-center">{label}
                      {sort.key === k && (sort.dir === 'asc' ? <ChevronUp size={12} className="ml-0.5" /> : <ChevronDown size={12} className="ml-0.5" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const faults = faultParts(a);
                const led = ledOf(a);
                return (
                  <tr key={a.id} onClick={() => setSelectedId(a.id)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-blue-50 ${selected?.id === a.id || checked.has(a.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-2 py-1.5" onClick={(e) => { e.stopPropagation(); toggleCheck(a.id); }}>
                      <input type="checkbox" checked={checked.has(a.id)} readOnly className="pointer-events-none" />
                    </td>
                    <td className="px-1 py-1.5" title={led.label}>
                      <span className="block w-1.5 h-5 rounded-sm" style={{ background: led.color }} aria-label={led.label} role="img" />
                    </td>
                    <td className="px-2 py-1.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                      {a.hostname}
                      {a.locally_modified && <span className="ml-1.5 font-sans text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded px-1 py-px align-middle" title="ITAM에서 직접 수정했거나 PM 기록이 있는 장비입니다. monday CSV를 다시 가져와도 덮어쓰지 않습니다.">ITAM</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{a.site_group}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{a.complex}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{a.product}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {a.status && <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${STATUS_STYLE[a.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{a.status}</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{a.model_name}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{a.serial_number}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{a.ipmi_ip}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{a.public_ip}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{a.private_ip}</td>
                    <td className={`px-2 py-1.5 whitespace-nowrap font-bold ${IPMI_STYLE[a.ipmi_status] || ''}`}>{a.ipmi_status}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{a.pm_date}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {faults.length
                        ? <span className="text-red-600 font-bold">⚠ {faults.join(', ')}</span>
                        : <span className="text-slate-300">정상</span>}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600 max-w-[260px] truncate" title={a.note}>{a.note}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={COLUMNS.length + 2} className="p-8 text-center text-slate-400">조건에 맞는 장비가 없습니다.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* 화면 전체(사이드바 포함) 위에 띄우기 위해 body에 렌더링 */}
      {selected && !formAsset && createPortal(
        <DetailPanel asset={selected} onClose={() => setSelectedId(null)} onEdit={() => setFormAsset(selected)} onOpenRack={onOpenRack}
          onDelete={() => deleteAsset(selected)} onAssetChanged={applyAsset} showToast={showToast} />, document.body)}
      {formAsset && createPortal(
        <FieldAssetForm asset={formAsset} options={options} onCancel={() => setFormAsset(null)} onSave={saveAsset} />, document.body)}
      {bulkOpen && createPortal(<FieldAssetBulk assets={checkedAssets} onCancel={() => setBulkOpen(false)} onSave={saveBulk} />, document.body)}
      {placeState && createPortal(<PlaceConfirm state={placeState} onCancel={() => setPlaceState(null)} onCommit={commitPlace} />, document.body)}
      {importState && createPortal(<ImportConfirm state={importState} onCancel={() => setImportState(null)} onCommit={commitImport} />, document.body)}
    </div>
  );
}

function DetailPanel({ asset: a, onClose, onEdit, onDelete, onAssetChanged, showToast, onOpenRack }) {
  const [records, setRecords] = useState(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    apiJson(`/api/field-assets/${a.id}/pm/`)
      .then(r => setRecords(r.records))
      .catch(err => { showToast(err.message, 'error'); setRecords([]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);
  const addRecord = (form) => apiJson(`/api/field-assets/${a.id}/pm/`, jsonBody('POST', form))
    .then(r => { setRecords(r.records); onAssetChanged(r.asset); setAdding(false); showToast('PM 점검 기록을 추가했습니다.'); })
    .catch(err => showToast(err.message, 'error'));
  const deleteRecord = (rec) => {
    if (!window.confirm(`${rec.pm_date} 점검 기록을 삭제할까요?`)) return;
    apiJson(`/api/field-assets/pm/delete/${rec.id}/`, { method: 'DELETE' })
      .then(r => { setRecords(prev => prev.filter(x => x.id !== rec.id)); onAssetChanged(r.asset); showToast('기록을 삭제했습니다.'); })
      .catch(err => showToast(err.message, 'error'));
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const row = (label, value, mono = false) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100 text-sm">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className={`text-slate-800 font-medium text-right break-all ${mono ? 'font-mono' : ''}`}>{value || '-'}</dd>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between sticky top-0">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{a.complex} · {a.site_group}</p>
            <h3 className="text-xl font-bold font-mono text-slate-800 break-all">{a.hostname}</h3>
            {a.status && <span className={`inline-block mt-1 px-2 py-0.5 rounded border text-xs font-bold ${STATUS_STYLE[a.status] || 'bg-slate-100 border-slate-200'}`}>{a.status}</span>}
            {a.locally_modified && <span className="inline-block mt-1 ml-1 px-2 py-0.5 rounded border text-xs font-bold text-violet-700 bg-violet-50 border-violet-200">ITAM에서 수정됨</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="p-2 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg" title="정보 수정"><Pencil size={16} /></button>
            <button onClick={onDelete} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="장비 삭제"><Trash2 size={16} /></button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg" title="닫기 (Esc)"><X size={18} /></button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <section>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">랙 위치</h4>
            {a.rack ? (
              <button onClick={() => onOpenRack?.(a.rack)} className="w-full flex items-center justify-between gap-2 text-left bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 hover:bg-violet-100">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-violet-800 truncate">{a.rack.path}</span>
                  <span className="block text-xs text-violet-600 font-mono">{a.rack.u} · {a.rack.hostname}</span>
                </span>
                <span className="text-xs font-bold text-violet-700 shrink-0 flex items-center"><LayoutGrid size={12} className="mr-1" />랙에서 보기</span>
              </button>
            ) : (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">아직 랙 구성도에 배치되지 않았습니다. 위쪽 <b>랙에 배치</b> 버튼으로 넣을 수 있습니다.</p>
            )}
          </section>
          <section>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">기본 정보</h4>
            <dl>{row('제품', a.product)}{row('Model', a.model_name)}{row('S/N', a.serial_number, true)}</dl>
          </section>
          <section>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">네트워크</h4>
            <dl>{row('IPMI IP', a.ipmi_ip, true)}{row('IPMI 상태', a.ipmi_status)}{row('Public IP', a.public_ip, true)}{row('Private IP', a.private_ip, true)}</dl>
          </section>
          <section>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">현재 PM 상태</h4>
            <dl>{row('PM 날짜', a.pm_date)}{row('PM 상태', a.pm_status)}{row('워런티 종료', a.warranty_end)}</dl>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {PARTS.map(([k, label]) => {
                const v = a.health?.[k] || '';
                const tone = v === 'Fault' ? 'bg-red-50 border-red-200 text-red-700' : v === '정상' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500';
                return (
                  <div key={k} className={`border rounded-lg p-2 text-center ${tone}`}>
                    <div className="text-[10px] font-bold opacity-70">{label}</div>
                    <div className="text-sm font-bold">{v || '-'}</div>
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">PM 점검 기록</h4>
              {!adding && (
                <button onClick={() => setAdding(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center">
                  <Plus size={12} className="mr-0.5" /> 점검 기록 추가
                </button>
              )}
            </div>
            {adding && <PMRecordForm asset={a} onCancel={() => setAdding(false)} onSave={addRecord} />}
            <PMRecordList records={records} onDelete={deleteRecord} />
          </section>
          <section>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">비고</h4>
            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border border-slate-100">{a.note || '내용 없음'}</p>
          </section>
          {a.monday_item_id && (
            <a href={`${MONDAY_ITEM_URL}${a.monday_item_id}`} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
              monday에서 열기 <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportConfirm({ state, onCancel, onCommit }) {
  const p = state.preview;
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 flex items-center"><Upload size={18} className="mr-2 text-amber-600" /> CSV로 서버 등록</h3>
          <p className="text-sm text-slate-500 mt-0.5 font-mono">{state.file.name}</p>
        </div>
        <div className="p-5 text-sm">
          {!p ? <p className="text-slate-500">확인 중...</p> : (
            <>
              <div className="grid grid-cols-4 gap-2 text-center mb-3">
                <div className="bg-emerald-50 rounded-lg p-3"><div className="text-2xl font-black text-emerald-600">{p.created}</div><div className="text-xs text-slate-500">신규 등록</div></div>
                <div className="bg-blue-50 rounded-lg p-3"><div className="text-2xl font-black text-blue-600">{p.updated}</div><div className="text-xs text-slate-500">갱신</div></div>
                <div className="bg-amber-50 rounded-lg p-3"><div className="text-2xl font-black text-amber-600">{p.duplicates?.length || 0}</div><div className="text-xs text-slate-500">중복(제외)</div></div>
                <div className="bg-red-50 rounded-lg p-3"><div className="text-2xl font-black text-red-600">{p.errors.length}</div><div className="text-xs text-slate-500">오류(제외)</div></div>
              </div>
              <ul className="text-slate-600 text-xs space-y-0.5 list-disc pl-4">
                <li>monday ID가 없는 행은 새 장비로 등록합니다. <b>같은 현장에 같은 호스트명</b>이 이미 있으면 중복으로 건너뜁니다.</li>
                <li>monday ID가 있는 행은 같은 ID의 장비를 갱신합니다. 파일에 없는 기존 장비는 그대로 둡니다.</li>
              </ul>
              {p.kept > 0 && <p className="text-violet-700 mt-2 text-xs">ITAM에서 직접 수정한 장비 <b>{p.kept}대</b>는 덮어쓰지 않고 유지합니다.</p>}
              {p.duplicates?.length > 0 && (
                <ul className="mt-3 max-h-32 overflow-y-auto text-xs text-amber-800 bg-amber-50 rounded-lg p-2 space-y-0.5">
                  {p.duplicates.map(d => <li key={d.line}>{d.line}행 {d.hostname} ({d.site_group}): {d.reason}</li>)}
                </ul>
              )}
              {p.errors.length > 0 && (
                <ul className="mt-3 max-h-40 overflow-y-auto text-xs text-red-600 bg-red-50 rounded-lg p-2 space-y-0.5">
                  {p.errors.map(e => <li key={e.line}>{e.line}행 {e.hostname}: {e.error}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button onClick={onCommit} disabled={state.busy || !p || (p.created + p.updated === 0)}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {p ? `${p.created + p.updated}대 반영` : '반영'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaceConfirm({ state, onCancel, onCommit }) {
  const p = state.preview;
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 flex items-center"><LayoutGrid size={18} className="mr-2 text-violet-600" /> 랙 구성도에 배치</h3>
          <p className="text-sm text-slate-500 mt-0.5">아직 랙에 없는 서버를 <b>단지 → 캠퍼스, 현장 → 건물, 제품 → 랙</b>으로 임시 배치합니다.</p>
        </div>
        <div className="p-5 text-sm overflow-y-auto space-y-3">
          {!p ? <p className="text-slate-500">확인 중...</p> : (
            <>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-violet-50 rounded-lg p-3"><div className="text-2xl font-black text-violet-600">{p.placed}</div><div className="text-xs text-slate-500">배치할 장비</div></div>
                <div className="bg-blue-50 rounded-lg p-3"><div className="text-2xl font-black text-blue-600">{p.racks_created}</div><div className="text-xs text-slate-500">새로 만들 랙</div></div>
              </div>
              <ul className="text-xs text-slate-600 list-disc pl-4 space-y-0.5">
                <li>각 랙의 비어 있는 U에 아래부터 차례로 넣습니다. 실제 위치는 랙 화면에서 끌어다 옮기면 됩니다.</li>
                <li>배치한 뒤 서버 현황에서 고친 호스트명·모델·상태·S/N·IP는 랙 장비에도 반영됩니다.</li>
              </ul>
              {p.renamed.length > 0 && (
                <div className="text-xs bg-amber-50 text-amber-800 rounded-lg p-2">
                  <b>같은 현장에 같은 이름이 있어 번호를 붙일 장비 {p.renamed.length}대</b>
                  <ul className="mt-1 max-h-24 overflow-y-auto">{p.renamed.map(x => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              {p.ip_fixed.length > 0 && (
                <div className="text-xs bg-slate-50 text-slate-600 rounded-lg p-2">
                  <b>IP 형식이 맞지 않아 비워 둘 항목 {p.ip_fixed.length}건</b> (원래 값은 설명란에 남김)
                  <ul className="mt-1 max-h-24 overflow-y-auto font-mono">{p.ip_fixed.map(x => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              {p.racks.length > 0 && (
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-bold">사용할 랙 {p.racks.length}개 보기</summary>
                  <ul className="mt-1 max-h-32 overflow-y-auto">{p.racks.map(x => <li key={x}>{x}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button onClick={onCommit} disabled={state.busy || !p?.placed}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
            {p ? `${p.placed}대 배치` : '배치'}
          </button>
        </div>
      </div>
    </div>
  );
}
