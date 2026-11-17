import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus, X, Copy, Trash2, ArrowUp, ArrowDown, Save, Loader2, Upload, Download, AlertTriangle, Calculator } from 'lucide-react';
import { apiJson, jsonBody, API_BASE_URL } from '../api/client';

/*
 * 구매 사양 화면 입력 (엑셀 '구매 사양' + 'SW-수량산정' 시트를 화면으로 옮긴 것)
 *  - 선택 목록은 기준정보(이름 관리자) 값으로 제안하고, 목록에 없는 값도 직접 입력할 수 있다
 *  - 장비 구분, Total, 클럭·코어, 라이선스 수량 등 엑셀 수식이 하던 계산은 서버가 하고 회색 글자로 보여 준다
 */

let seq = 0;
const newKey = () => `k${++seq}`;
const withKeys = (items) => items.map(it => ({ ...it, _k: newKey() }));
const strip = (items) => items.map(({ _k, ...it }) => it); // eslint-disable-line no-unused-vars
const clone = (v) => JSON.parse(JSON.stringify(v));
// 모델명 → 이름 관리자 이름 조각 (예: DL380 Gen10+ → DL380_Gen10Plus, 엑셀 이름 규칙과 같음)
const us = (s) => String(s || '').trim().replace(/ /g, '_').replace(/\+/g, 'Plus');

const BLOCKS = [
  ['server', '서버'], ['storage', '스토리지'], ['etc', 'ETC (SAN·Rack·KVM)'], ['nw', 'NW (스위치)'], ['license', 'License'],
];
// 서버 부품 (디스크·HBA·NIC·GPU는 서버마다 필요한 만큼 추가·삭제)
const blankPart = {
  disks: () => ({ type: '', size: '', unit: 'TB', qty: '' }),
  hbas: () => ({ model: '', qty: '' }), nics: () => ({ model: '', qty: '' }), gpus: () => ({ model: '', qty: '' }),
};
const BLANK = {
  server: () => ({ block: 'server', kind: '서버', name: '', usage: '', maker: '', model: '', qty: 1, note: '',
    data: { cpu_qty: 1, mem_qty: 1, disks: [blankPart.disks()], hbas: [], nics: [blankPart.nics()], gpus: [], sw: {} } }),
  storage: () => ({ block: 'storage', kind: '스토리지', name: '', usage: '', maker: '', model: '', qty: 1, note: '',
    data: { disks: [{ type: '', size: '', unit: 'TB', count: '', ratio: '' }] } }),
  etc: () => ({ block: 'etc', kind: 'SAN', name: '', usage: '', maker: '', model: '', qty: 1, note: '', data: { spec: '' } }),
  nw: () => ({ block: 'nw', kind: '10G L2 Switch', name: '', usage: '', maker: '', model: '', qty: 1, note: '', data: { spec: '' } }),
  license: () => ({ block: 'license', kind: 'OS', name: '', usage: '', maker: '', model: '', qty: '', note: '',
    data: { version: '', edition: '', basis: '' } }),
};
const SW_SHORT = {
  win_vl: 'Win VL', win_dsp: 'Win DSP', rhel: 'RHEL', vsphere: 'vSphere', vcenter: 'vCenter', roseha_win: 'RoseHA Win',
  rose_mirror: 'Rose Mirror', roseha_linux: 'RoseHA Linux', oracle_ee: 'Oracle EE', oracle_se: 'Oracle SE', mssql: 'MS-SQL',
};
// ETC 유형 → 선택 목록 이름의 가운데 부분 (엑셀 데이터 유효성 검사 수식과 같은 규칙)
const etcGroup = (kind) => (/SAN/i.test(kind) ? '스위치' : /Rack/i.test(kind) ? 'Rack' : /KVM/i.test(kind) ? 'KVM' : '기타');
// NW 제조사 목록: 1G·25G는 기준정보에 따로 있고, 10G는 없으면 스위치 제조사 전체에서 고른다 (추가하면 제조사_10G스위치로)
const nwMakerLists = (kind) => (/25G/i.test(kind) ? ['제조사_25G스위치'] : /(^|[^0-9])1G/i.test(kind) ? ['제조사_1G스위치']
  : ['제조사_10G스위치', '제조사_25G스위치', '제조사_1G스위치']);
const ADD = '__add__';
const AUTOSAVE_MS = 1500; // 입력이 이만큼 멈추면 자동 저장
// 이름 관리자 이름은 대소문자를 가리지 않는다 (예: 제조사_HyperVisor = 제조사_Hypervisor)
const findList = (lists, name) => {
  if (lists[name]) return name;
  const low = name.toLowerCase();
  return Object.keys(lists).find(n => n.toLowerCase() === low);
};

const cellCls = 'border border-slate-200 rounded px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-400 bg-white';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50';
const btnGhost = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-blue-600 border-blue-600 text-white hover:bg-blue-700`;
const th = 'px-1.5 py-1.5 text-[11px] font-bold text-slate-500 whitespace-nowrap text-left';
const td = 'px-1 py-1 align-middle';
const tdTop = 'px-1 py-1 align-top';
const fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));

// 입력칸·표 조각 (컴포넌트 밖에 두어야 입력할 때 칸이 다시 만들어지지 않아 커서가 유지된다)
function Inp({ v, on, w = 'w-24', ph }) {
  return <input className={`${cellCls} ${w}`} value={v ?? ''} placeholder={ph} onChange={e => on(e.target.value)} />;
}
// 기준정보 목록에서만 고르는 칸. 목록에 없는 값은 '목록에 추가'로 기준정보에 넣은 뒤 고른다
function Sel({ v, on, names, lists, onAdd, w = 'w-28', needs, addTo }) {
  if (!names) {
    return <select disabled className={`${cellCls} ${w} text-slate-400`}><option>{needs || '-'}</option></select>;
  }
  const keys = names.map(n => findList(lists, n)).filter(Boolean);
  const options = [...new Set(keys.flatMap(n => lists[n] || []))];
  const value = v == null ? '' : String(v);
  const missing = value !== '' && !options.includes(value);
  return (
    <select className={`${cellCls} ${w} ${missing ? 'border-amber-400 bg-amber-50 text-amber-800' : ''} ${value ? '' : 'text-slate-400'}`}
      value={value} title={missing ? '기준정보 목록에 없는 값입니다. 목록에서 다시 고르거나 목록에 추가해 주세요.' : value}
      onChange={e => (e.target.value === ADD ? onAdd(addTo || keys[0] || names[0], on) : on(e.target.value))}>
      <option value="">{keys.length ? '선택' : '목록 없음'}</option>
      {missing && <option value={value}>⚠ {value} (목록에 없음)</option>}
      {options.map(o => <option key={o} value={o} className="text-slate-800">{o}</option>)}
      <option value={ADD} className="text-blue-600">＋ 목록에 추가…</option>
    </select>
  );
}
function AddModal({ req, onClose, onDone }) {
  const [value, setValue] = useState('');
  const [clock, setClock] = useState('');
  const [cores, setCores] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isCpu = req.name.startsWith('List_');
  const submit = (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    apiJson('/api/reviews/master/lists/add/', jsonBody('POST', { name: req.name, value, clock, cores }))
      .then(l => onDone(l, value.trim()))
      .catch(er => { setErr(er.message); setBusy(false); });
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-md space-y-3">
        <div className="text-base font-bold text-slate-800">기준정보 목록에 추가</div>
        <div className="text-xs text-slate-500">목록 <span className="font-medium text-slate-700" title={req.name}>{req.label || req.name}</span>에 값을 더하고 이 칸에 넣습니다. 변경 이력이 남고, 다른 심의건에서도 이 값을 고를 수 있습니다.</div>
        <label className="block text-sm text-slate-600">추가할 값
          <input autoFocus className={`${cellCls} w-full text-sm py-2`} value={value} onChange={e => setValue(e.target.value)} placeholder="철자를 한 번 더 확인해 주세요" /></label>
        {isCpu && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-slate-600">클럭 (GHz)<input className={`${cellCls} w-full text-sm py-2`} value={clock} onChange={e => setClock(e.target.value)} placeholder="예: 2.3" /></label>
            <label className="block text-sm text-slate-600">코어 수<input className={`${cellCls} w-full text-sm py-2`} value={cores} onChange={e => setCores(e.target.value)} placeholder="예: 16" /></label>
          </div>
        )}
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>취소</button>
          <button disabled={busy || !value.trim()} className={btnPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 추가하고 고르기</button>
        </div>
      </form>
    </div>
  );
}
// 서버 한 줄 안의 부품 목록 (줄마다 삭제, 아래 '＋'로 추가)
function PartList({ parts, onChange, blank, label, children }) {
  const list = Array.isArray(parts) ? parts : [];
  const set = (i) => (f, v) => onChange(list.map((p, j) => (j === i ? { ...p, [f]: v } : p)));
  return (
    <div className="flex flex-col gap-1">
      {list.map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          {children(p, set(i))}
          <button title={`${label} 빼기`} onClick={() => onChange(list.filter((_, j) => j !== i))}
            className="p-0.5 text-slate-300 hover:text-red-600"><X size={12} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...list, blank()])}
        className="text-[11px] text-blue-600 hover:text-blue-800 text-left whitespace-nowrap">＋ {label} 추가</button>
    </div>
  );
}
function Auto({ children, title }) {
  return <span title={title} className="text-xs text-slate-500 whitespace-nowrap">{children}</span>;
}
function Code({ v }) {
  return v === '확인필요'
    ? <span className="text-[10px] text-amber-600 flex items-center gap-0.5 whitespace-nowrap"><AlertTriangle size={10} />CIS 확인</span> : null;
}
function RowTools({ onMove, onCopy, onRemove }) {
  return (
    <td className={`${td} whitespace-nowrap`}>
      <button title="위로" onClick={() => onMove(-1)} className="p-1 text-slate-400 hover:text-slate-700"><ArrowUp size={13} /></button>
      <button title="아래로" onClick={() => onMove(1)} className="p-1 text-slate-400 hover:text-slate-700"><ArrowDown size={13} /></button>
      <button title="복사" onClick={onCopy} className="p-1 text-slate-400 hover:text-blue-600"><Copy size={13} /></button>
      <button title="삭제" onClick={onRemove} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
    </td>
  );
}
function Section({ label, count, onAdd, children }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="text-sm font-bold text-slate-700">{label} <span className="text-slate-400 font-normal">{count}줄</span></div>
        <button onClick={onAdd} className={`${btnGhost} py-1`}><Plus size={13} /> 줄 추가</button>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const SpecEditor = forwardRef(function SpecEditor({ c, showToast, onCaseChanged }, ref) {
  const [items, setItems] = useState(null);
  const [calc, setCalc] = useState({ rows: [], sw_total: {} });
  const [meta, setMeta] = useState({ sw_products: [], kinds: { etc: [], nw: [], license: [] } });
  const [lists, setLists] = useState({});
  const [labels, setLabels] = useState({}); // 이름 관리자 이름 → 화면 이름
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [addReq, setAddReq] = useState(null); // { name, on }
  const calcTimer = useRef(null);
  const fileRef = useRef(null);
  // 자동 저장: 바꿀 때마다 version +1, 저장이 끝나면 그 version을 savedVersion으로 기록
  const itemsRef = useRef(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(null);
  const autoTimer = useRef(null);
  const mountedRef = useRef(true);
  const [saveState, setSaveState] = useState({ status: 'idle', at: null, error: '' });
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    apiJson(`/api/reviews/${c.id}/items/`).then(d => {
      setItems(withKeys(d.items)); setCalc(d.calc); setMeta({ sw_products: d.sw_products, kinds: d.kinds });
    }).catch(err => showToast(err.message, 'error'));
    apiJson('/api/reviews/master/').then(d => { setLists(Object.fromEntries(d.lists.map(l => [l.name, l.values]))); setLabels(Object.fromEntries(d.lists.map(l => [l.name, l.label]))); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  // 입력이 멈추면 서버에서 계산값만 다시 받아 온다 (저장하지 않음)
  const recalc = (next) => {
    clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => {
      apiJson(`/api/reviews/${c.id}/items/calc/`, jsonBody('POST', { items: strip(next) }))
        .then(d => setCalc(d.calc)).catch(() => { /* 입력 중 잘못된 값은 저장할 때 알려 줌 */ });
    }, 400);
  };
  useEffect(() => () => clearTimeout(calcTimer.current), []);

  const update = (fn) => setItems(prev => {
    const next = fn(prev);
    versionRef.current += 1;
    setDirty(true);
    recalc(next);
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { persist().catch(() => {}); }, AUTOSAVE_MS);
    return next;
  });
  const setField = (k, field, value) => update(prev => prev.map(it => (it._k === k ? { ...it, [field]: value } : it)));
  const setData = (k, field, value) => update(prev => prev.map(it => (it._k === k ? { ...it, data: { ...it.data, [field]: value } } : it)));
  const setSw = (k, key, value) => update(prev => prev.map(it => (it._k === k ? { ...it, data: { ...it.data, sw: { ...(it.data.sw || {}), [key]: value } } } : it)));
  const setDisk = (k, i, field, value) => update(prev => prev.map(it => {
    if (it._k !== k) return it;
    const disks = it.data.disks.map((d, j) => (j === i ? { ...d, [field]: value } : d));
    return { ...it, data: { ...it.data, disks } };
  }));
  const addDisk = (k) => update(prev => prev.map(it => (it._k === k
    ? { ...it, data: { ...it.data, disks: [...it.data.disks, { type: '', size: '', unit: 'TB', count: '', ratio: '' }] } } : it)));
  const removeDisk = (k, i) => update(prev => prev.map(it => (it._k === k
    ? { ...it, data: { ...it.data, disks: it.data.disks.filter((_, j) => j !== i) } } : it)));
  const add = (block) => update(prev => {
    const last = prev.map(it => it.block).lastIndexOf(block);
    const at = last >= 0 ? last + 1 : prev.filter(it => BLOCKS.findIndex(b => b[0] === it.block) <= BLOCKS.findIndex(b => b[0] === block)).length;
    return [...prev.slice(0, at), { ...BLANK[block](), _k: newKey() }, ...prev.slice(at)];
  });
  const duplicate = (k) => update(prev => {
    const i = prev.findIndex(it => it._k === k);
    const copy = { ...clone(strip([prev[i]])[0]), id: null, _k: newKey() };
    return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
  });
  const remove = (k) => update(prev => prev.filter(it => it._k !== k));
  const move = (k, dir) => update(prev => {
    const i = prev.findIndex(it => it._k === k);
    let j = i + dir;
    while (j >= 0 && j < prev.length && prev[j].block !== prev[i].block) j += dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // 지금 화면 내용을 저장한다. 저장 중이면 끝난 뒤 이어서 저장 (같은 줄이 두 번 만들어지지 않게)
  const persist = () => {
    if (savingRef.current) return savingRef.current.then(() => persist());
    const snapshot = itemsRef.current, ver = versionRef.current;
    if (!snapshot || ver === savedVersionRef.current) return Promise.resolve(null);
    if (mountedRef.current) setSaveState(s => ({ ...s, status: 'saving' }));
    const p = apiJson(`/api/reviews/${c.id}/items/`, jsonBody('PUT', { items: strip(snapshot) }))
      .then(d => {
        savedVersionRef.current = ver;
        if (!mountedRef.current) return d;
        // 새 줄에 서버가 준 id를 붙인다. 입력 중인 칸은 그대로 두어 커서가 튀지 않게 함
        const sameShape = d.items.length === snapshot.length && d.items.every((it, i) => it.block === snapshot[i].block);
        if (sameShape) {
          const ids = Object.fromEntries(snapshot.map((it, i) => [it._k, d.items[i].id]));
          setItems(prev => prev.map(it => (ids[it._k] && it.id !== ids[it._k] ? { ...it, id: ids[it._k] } : it)));
        } else if (versionRef.current === ver) {
          setItems(withKeys(d.items));
        }
        if (versionRef.current === ver) { setDirty(false); setCalc(d.calc); }
        setSaveState({ status: 'saved', at: new Date(), error: '' });
        onCaseChanged(d.case);
        return d;
      })
      .catch(err => {
        if (mountedRef.current) setSaveState({ status: 'error', at: null, error: err.message });
        throw err;
      })
      .finally(() => { savingRef.current = null; });
    savingRef.current = p.catch(() => {});
    return p;
  };
  const save = () => {
    clearTimeout(autoTimer.current);
    setBusy('save');
    return persist().finally(() => setBusy(''));
  };
  useImperativeHandle(ref, () => ({ save, isDirty: () => versionRef.current !== savedVersionRef.current }));

  // 다른 심의건·메뉴로 나가면(화면이 닫히면) 저장하지 않은 내용을 바로 저장
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(autoTimer.current);
      if (versionRef.current !== savedVersionRef.current) persist().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 저장 전에 브라우저를 닫거나 새로고침하면 경고
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const importExcel = (file) => {
    if (items.length && !window.confirm('지금 입력한 구매 사양을 엑셀 내용으로 바꿉니다. 계속할까요?')) return;
    setBusy('import');
    const fd = new FormData();
    if (file) fd.append('file', file);
    apiJson(`/api/reviews/${c.id}/items/import/`, { method: 'POST', body: fd })
      .then(d => {
        clearTimeout(autoTimer.current); versionRef.current += 1; savedVersionRef.current = versionRef.current;
        setItems(withKeys(d.items)); setCalc(d.calc); setDirty(false); setWarnings(d.warnings || []); onCaseChanged(d.case);
        showToast(`엑셀에서 ${d.items.length}줄을 불러왔습니다.`);
      })
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(''));
  };

  // 기준정보 목록에서 고르는 칸. names가 없으면(앞 칸을 아직 안 고름) needs 문구로 막아 둔다
  const sel = (v, on, names, w, needs, addTo) => (
    <Sel v={v} on={on} names={names} lists={lists} w={w} needs={needs} addTo={addTo} onAdd={(name, pick) => setAddReq({ name, label: labels[name], on: pick })} />
  );

  const calcOf = useMemo(() => {
    const m = {};
    (items || []).forEach((it, i) => { m[it._k] = calc.rows?.[i] || {}; });
    return m;
  }, [items, calc]);

  if (!items) return <div className="p-6 text-center text-sm text-slate-400">불러오는 중...</div>;
  const of = (block) => items.filter(it => it.block === block);
  const servers = of('server');
  const swProducts = meta.sw_products;

  return (
    <div className="space-y-4">
      {addReq && <AddModal req={addReq} onClose={() => setAddReq(null)} onDone={(l, value) => {
        setLists(prev => ({ ...prev, [l.name]: l.values })); setLabels(prev => ({ ...prev, [l.name]: l.label }));
        addReq.on(value); setAddReq(null);
        showToast(`기준정보 '${l.label || l.name}'에 '${value}'을(를) 추가했습니다.`);
      }} />}
      {Object.keys(lists).length === 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          기준정보 목록이 비어 있어 고를 값이 없습니다. 위의 '기준정보 (이름 관리자)' 탭에서 매크로 엑셀을 먼저 가져와 주세요.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => save().then(() => showToast('구매 사양을 저장했습니다.')).catch(err => showToast(err.message, 'error'))}
          disabled={!!busy || !dirty} className={btnPrimary}>
          {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
        </button>
        <span className="text-xs">
          {saveState.status === 'saving' ? <span className="text-slate-500">저장 중...</span>
            : saveState.status === 'error' && dirty ? <span className="text-red-600 font-medium">자동 저장 못 함: {saveState.error}</span>
            : dirty ? <span className="text-amber-600 font-medium">입력을 멈추면 자동으로 저장합니다.</span>
            : saveState.at ? <span className="text-slate-400">저장됨 {saveState.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span> : null}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importExcel(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={btnGhost}>
            {busy === 'import' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 엑셀에서 불러오기
          </button>
          {c.has_source && <button onClick={() => importExcel(null)} disabled={!!busy} className={btnGhost} title={c.source_name}>
            <Upload size={14} /> 올려 둔 엑셀에서 불러오기</button>}
          {items.length > 0 && !dirty && <a href={`${API_BASE_URL}/api/reviews/${c.id}/items/excel/`} className={btnGhost}>
            <Download size={14} /> 구매 사양 엑셀</a>}
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-0.5">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      <p className="text-xs text-slate-500 flex items-center gap-1"><Calculator size={12} /> 회색 글자는 자동 계산값입니다. 제조사·모델·CPU 같은 칸은 기준정보 목록에서 고르고, 목록에 없으면 '＋ 목록에 추가'로 넣습니다.</p>

      {/* 서버 */}
      <Section onAdd={() => add('server')} label="서버" count={servers.length}>
        <table className="text-xs">
          <thead className="bg-white border-b border-slate-100"><tr>
            {['장비명', '제조사', '모델', '수량', 'OS', '장비 구분', 'CPU', '클럭 / 코어', 'CPU 수', '메모리', '수', 'Total',
              'Disk (종류 · 크기 · 단위 · 수)', 'HBA (제품 · 수)', 'NIC (종류 · 수)', 'GPU (제품 · 수)', '비고', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {servers.map(it => {
              const d = it.data, k = it._k, cc = calcOf[k];
              return (
                <tr key={k} className="border-b border-slate-50">
                  <td className={td}><Inp v={it.name} on={v => setField(k, 'name', v)} w="w-28" ph="호스트명" /></td>
                  <td className={td}>{sel(it.maker, v => setField(k, 'maker', v), ['제조사_서버'], 'w-24')}</td>
                  <td className={td}>{sel(it.model, v => setField(k, 'model', v), it.maker ? [`서버모델_${it.maker}`] : null, 'w-32', '제조사 먼저')}
                    <Code v={cc.codes?.svr} /></td>
                  <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                  <td className={td}>{sel(d.os, v => setData(k, 'os', v), ['OS'], 'w-32')}</td>
                  <td className={td}><Auto>{cc.usage || '-'}</Auto></td>
                  <td className={td}>{sel(d.cpu, v => setData(k, 'cpu', v), it.model ? [`List_${us(it.model)}`] : null, 'w-40', '모델 먼저')}</td>
                  <td className={td}><Auto>{d.cpu ? `${fmt(cc.clock)}GHz / ${fmt(cc.cores)}core` : '-'}</Auto></td>
                  <td className={td}><Inp v={d.cpu_qty} on={v => setData(k, 'cpu_qty', v)} w="w-12" /></td>
                  <td className={td}>{sel(d.mem, v => setData(k, 'mem', v), ['MEMORY'], 'w-28')}</td>
                  <td className={td}><Inp v={d.mem_qty} on={v => setData(k, 'mem_qty', v)} w="w-12" /></td>
                  <td className={td}><Auto>{cc.mem_total != null ? `${cc.mem_total}GB` : '-'}</Auto></td>
                  <td className={tdTop}>
                    <PartList parts={d.disks} onChange={v => setData(k, 'disks', v)} blank={blankPart.disks} label="Disk">
                      {(p, set) => <>
                        {sel(p.type, v => set('type', v), ['DiskType'], 'w-24')}
                        <Inp v={p.size} on={v => set('size', v)} w="w-14" ph="크기" />
                        <select className={cellCls} value={p.unit || ''} onChange={e => set('unit', e.target.value)}>
                          <option value="TB">TB</option><option value="GB">GB</option><option value="">-</option>
                        </select>
                        <Inp v={p.qty} on={v => set('qty', v)} w="w-12" ph="수" />
                      </>}
                    </PartList></td>
                  <td className={tdTop}>
                    <PartList parts={d.hbas} onChange={v => setData(k, 'hbas', v)} blank={blankPart.hbas} label="HBA">
                      {(p, set) => <>{sel(p.model, v => set('model', v), ['HBA'], 'w-28')}<Inp v={p.qty} on={v => set('qty', v)} w="w-12" ph="수" /></>}
                    </PartList></td>
                  <td className={tdTop}>
                    <PartList parts={d.nics} onChange={v => setData(k, 'nics', v)} blank={blankPart.nics} label="NIC">
                      {(p, set) => <>{sel(p.model, v => set('model', v), ['NIC'], 'w-28')}<Inp v={p.qty} on={v => set('qty', v)} w="w-12" ph="수" /></>}
                    </PartList></td>
                  <td className={tdTop}>
                    <PartList parts={d.gpus} onChange={v => setData(k, 'gpus', v)} blank={blankPart.gpus} label="GPU">
                      {(p, set) => <>{sel(p.model, v => set('model', v), it.model ? [`GPU_${us(it.model)}`] : null, 'w-28', '모델 먼저')}<Inp v={p.qty} on={v => set('qty', v)} w="w-12" ph="수" /></>}
                    </PartList></td>
                  <td className={td}><Inp v={it.note} on={v => setField(k, 'note', v)} w="w-32" /></td>
                  <RowTools onMove={dir => move(it._k, dir)} onCopy={() => duplicate(it._k)} onRemove={() => remove(it._k)} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* SW-수량산정 */}
      <div className="border border-violet-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-violet-50 border-b border-violet-200">
          <div className="text-sm font-bold text-violet-800">SW 수량 산정 <span className="font-normal text-violet-600/80">서버마다 OS·VM 수와 코어 수를 넣으면 라이선스 수량이 계산됩니다.</span></div>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="bg-white border-b border-slate-100"><tr>
              <th className={th}>장비명</th><th className={th}>VM 설치</th><th className={th}>CPU 수</th>
              <th className={th} title="베어메탈이면 Windows 서버 1대 = 1, VM 호스트면 Windows VM 수">Windows</th>
              <th className={th} title="베어메탈이면 Linux 서버 1대 = 1, VM 호스트면 Linux VM 수">Linux</th>
              <th className={th}>Core 수</th>
              {swProducts.map(p => (
                <th key={p.key} className={`${th} ${p.rule === 'manual' ? '' : 'bg-slate-50'}`} title={`${p.name}\n${p.unit}${p.rule === 'manual' ? ' (직접 입력)' : ' (자동 계산)'}`}>
                  {SW_SHORT[p.key] || p.key}</th>
              ))}
            </tr></thead>
            <tbody>
              {servers.length === 0 && <tr><td colSpan={6 + swProducts.length} className="p-4 text-center text-slate-400">서버 줄을 먼저 추가해 주세요.</td></tr>}
              {servers.map(it => {
                const d = it.data, k = it._k, cc = calcOf[k];
                return (
                  <tr key={k} className="border-b border-slate-50">
                    <td className={`${td} font-medium text-slate-700 whitespace-nowrap`}>{it.name || '(장비명 없음)'}</td>
                    <td className={td}><Auto>{cc.vm ? 'O' : '-'}</Auto></td>
                    <td className={td}><Auto>{fmt(d.cpu_qty)}</Auto></td>
                    <td className={td}><Inp v={d.vm_win} on={v => setData(k, 'vm_win', v)} w="w-14" /></td>
                    <td className={td}><Inp v={d.vm_linux} on={v => setData(k, 'vm_linux', v)} w="w-14" /></td>
                    <td className={td}><Inp v={d.core} on={v => setData(k, 'core', v)} w="w-14" ph={cc.cores && cc.cores !== '-' ? String(Number(cc.cores) * (Number(d.cpu_qty) || 1)) : ''} /></td>
                    {swProducts.map(p => (
                      <td key={p.key} className={`${td} ${p.rule === 'manual' ? '' : 'bg-slate-50 text-center'}`}>
                        {p.rule === 'manual'
                          ? <Inp v={d.sw?.[p.key]} on={v => setSw(k, p.key, v)} w="w-14" />
                          : <Auto>{fmt(cc.sw?.[p.key])}</Auto>}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {servers.length > 0 && (
                <tr className="bg-amber-50 font-bold">
                  <td className={`${td} text-slate-700`} colSpan={6}>소계</td>
                  {swProducts.map(p => <td key={p.key} className={`${td} text-center`}>{fmt(calc.sw_total?.[p.key])}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 스토리지 */}
      <Section onAdd={() => add('storage')} label="스토리지" count={of('storage').length}>
        <table className="text-xs">
          <thead className="bg-white border-b border-slate-100"><tr>
            {['장비명', '용도', '제조사', '모델', '수량', '디스크: 종류', '크기', '단위', '개수', '가용율', 'Total / Usable', '', '비고', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {of('storage').map(it => {
              const k = it._k, cc = calcOf[k], disks = it.data.disks || [];
              return disks.map((dk, i) => (
                <tr key={`${k}-${i}`} className={i === disks.length - 1 ? 'border-b border-slate-100' : ''}>
                  {i === 0 ? <>
                    <td className={td}><Inp v={it.name} on={v => setField(k, 'name', v)} w="w-28" /></td>
                    <td className={td}><Inp v={it.usage} on={v => setField(k, 'usage', v)} w="w-32" /></td>
                    <td className={td}>{sel(it.maker, v => setField(k, 'maker', v), ['제조사_스토리지'], 'w-28')}</td>
                    <td className={td}>{sel(it.model, v => setField(k, 'model', v), it.maker ? [`스토리지모델_${it.maker}`] : null, 'w-28', '제조사 먼저')}<Code v={cc.codes?.sto} /></td>
                    <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                  </> : <td colSpan={5} />}
                  <td className={td}>{sel(dk.type, v => setDisk(k, i, 'type', v), ['DiskType'], 'w-24')}</td>
                  <td className={td}><Inp v={dk.size} on={v => setDisk(k, i, 'size', v)} w="w-16" /></td>
                  <td className={td}><select className={cellCls} value={dk.unit || ''} onChange={e => setDisk(k, i, 'unit', e.target.value)}>
                    <option value="TB">TB</option><option value="GB">GB</option><option value="">-</option></select></td>
                  <td className={td}><Inp v={dk.count} on={v => setDisk(k, i, 'count', v)} w="w-12" /></td>
                  <td className={td}><Inp v={dk.ratio} on={v => setDisk(k, i, 'ratio', v)} w="w-14" ph="0.8" /></td>
                  <td className={td}><Auto title="Usable = 크기 × (개수 - 2) × 가용율">{fmt(cc.disks?.[i]?.total)} / {fmt(cc.disks?.[i]?.usable)} {dk.unit}</Auto></td>
                  <td className={`${td} whitespace-nowrap`}>
                    {i === disks.length - 1 && <button title="디스크 줄 추가" onClick={() => addDisk(k)} className="p-1 text-slate-400 hover:text-blue-600"><Plus size={13} /></button>}
                    {disks.length > 1 && <button title="디스크 줄 삭제" onClick={() => removeDisk(k, i)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>}
                  </td>
                  {i === 0 ? <><td className={td}><Inp v={it.note} on={v => setField(k, 'note', v)} w="w-28" /></td><RowTools onMove={dir => move(it._k, dir)} onCopy={() => duplicate(it._k)} onRemove={() => remove(it._k)} /></> : <td colSpan={2} />}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </Section>

      {/* ETC, NW */}
      {['etc', 'nw'].map(block => (
        <Section key={block} onAdd={() => add(block)} label={BLOCKS.find(b => b[0] === block)[1]} count={of(block).length}>
          <table className="text-xs">
            <thead className="bg-white border-b border-slate-100"><tr>
              {['유형', '장비명', '용도', '제조사', '모델', 'Spec', '수량', '비고', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {of(block).map(it => {
                const k = it._k, cc = calcOf[k];
                const group = block === 'etc' ? etcGroup(it.kind) : '스위치';
                const makerLists = block === 'etc' ? (it.kind ? [`제조사_${it.kind}`] : null) : nwMakerLists(it.kind);
                return (
                  <tr key={k} className="border-b border-slate-50">
                    <td className={td}>
                      <select className={`${cellCls} w-32`} value={it.kind} onChange={e => setField(k, 'kind', e.target.value)}>
                        {[...new Set([...(meta.kinds[block] || []), it.kind])].filter(Boolean).map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </td>
                    <td className={td}><Inp v={it.name} on={v => setField(k, 'name', v)} w="w-28" ph={cc.name} /></td>
                    <td className={td}><Inp v={it.usage} on={v => setField(k, 'usage', v)} w="w-36" ph={cc.usage} /></td>
                    <td className={td}>{sel(it.maker, v => setField(k, 'maker', v), makerLists, 'w-28')}</td>
                    <td className={td}>{sel(it.model, v => setField(k, 'model', v), it.maker ? [`모델_${group}_${it.maker}`] : null, 'w-40', '제조사 먼저')}<Code v={cc.codes?.etc} /></td>
                    <td className={td}>{sel(it.data.spec, v => setData(k, 'spec', v), it.maker ? [`Spec_${group}_${it.maker}`] : null, 'w-72', '제조사 먼저')}</td>
                    <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                    <td className={td}><Inp v={it.note} on={v => setField(k, 'note', v)} w="w-32" /></td>
                    <RowTools onMove={dir => move(it._k, dir)} onCopy={() => duplicate(it._k)} onRemove={() => remove(it._k)} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ))}

      {/* License */}
      <Section onAdd={() => add('license')} label="License" count={of('license').length}>
        <table className="text-xs">
          <thead className="bg-white border-b border-slate-100"><tr>
            {['유형', '제조사', '제품', '버전', 'Edition', '수량 기준 (SW 수량 산정)', '수량', '라이선스', '단위', '비고', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {of('license').map(it => {
              const d = it.data, k = it._k, cc = calcOf[k];
              return (
                <tr key={k} className="border-b border-slate-50">
                  <td className={td}>
                    <select className={cellCls} value={it.kind} onChange={e => setField(k, 'kind', e.target.value)}>
                      {[...new Set([...(meta.kinds.license || []), it.kind])].filter(Boolean).map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </td>
                  <td className={td}>{sel(it.maker, v => setField(k, 'maker', v), it.kind ? [`제조사_${it.kind}`] : null, 'w-36', '유형 먼저')}</td>
                  <td className={td}>{sel(it.model, v => setField(k, 'model', v), it.maker ? [`SW_${it.maker}`] : null, 'w-44', '제조사 먼저')}<Code v={cc.codes?.sw} /></td>
                  <td className={td}>{sel(d.version, v => setData(k, 'version', v), it.model ? [`${us(it.model)}_ver`] : null, 'w-24', '제품 먼저')}</td>
                  <td className={td}>{sel(d.edition, v => setData(k, 'edition', v), it.model ? [`${us(it.model)}_Edition`] : null, 'w-28', '제품 먼저')}</td>
                  <td className={td}>
                    <select className={`${cellCls} w-48`} value={d.basis || ''} onChange={e => setData(k, 'basis', e.target.value)}
                      title={swProducts.find(p => p.key === d.basis)?.name || '수량을 직접 입력'}>
                      <option value="">직접 입력</option>
                      {swProducts.map(p => <option key={p.key} value={p.key}>{SW_SHORT[p.key] || p.key} 합계 ({p.unit})</option>)}
                    </select>
                  </td>
                  <td className={td}>{d.basis
                    ? <Auto>{fmt(cc.qty)}</Auto>
                    : <Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-14" />}</td>
                  <td className={td}><Auto>{cc.license || '-'}</Auto></td>
                  <td className={td}><Auto>{cc.unit || '-'}</Auto></td>
                  <td className={td}><Inp v={it.note} on={v => setField(k, 'note', v)} w="w-32" /></td>
                  <RowTools onMove={dir => move(it._k, dir)} onCopy={() => duplicate(it._k)} onRemove={() => remove(it._k)} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
});

export default SpecEditor;
