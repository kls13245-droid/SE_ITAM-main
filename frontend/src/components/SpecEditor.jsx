import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus, Copy, Trash2, ArrowUp, ArrowDown, Save, Loader2, Upload, Download, AlertTriangle, Calculator } from 'lucide-react';
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
const us = (s) => String(s || '').trim().replace(/ /g, '_');

const BLOCKS = [
  ['server', '서버'], ['storage', '스토리지'], ['etc', 'ETC (SAN·Rack·KVM)'], ['nw', 'NW (스위치)'], ['license', 'License'],
];
const BLANK = {
  server: () => ({ block: 'server', kind: '서버', name: '', usage: '', maker: '', model: '', qty: 1, note: '',
    data: { cpu_qty: 1, mem_qty: 1, disk1_unit: 'TB', disk2_unit: 'GB', sw: {} } }),
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
const nwMakerList = (kind) => (/25G/i.test(kind) ? '제조사_25G스위치' : /(^|[^0-9])1G/i.test(kind) ? '제조사_1G스위치' : null);

const cellCls = 'border border-slate-200 rounded px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-400 bg-white';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50';
const btnGhost = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-blue-600 border-blue-600 text-white hover:bg-blue-700`;
const th = 'px-1.5 py-1.5 text-[11px] font-bold text-slate-500 whitespace-nowrap text-left';
const td = 'px-1 py-1 align-middle';
const fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));

// 입력칸·표 조각 (컴포넌트 밖에 두어야 입력할 때 칸이 다시 만들어지지 않아 커서가 유지된다)
function Inp({ v, on, listId, w = 'w-24', ph }) {
  return <input className={`${cellCls} ${w}`} value={v ?? ''} list={listId} placeholder={ph} onChange={e => on(e.target.value)} />;
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
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [warnings, setWarnings] = useState([]);
  const calcTimer = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    apiJson(`/api/reviews/${c.id}/items/`).then(d => {
      setItems(withKeys(d.items)); setCalc(d.calc); setMeta({ sw_products: d.sw_products, kinds: d.kinds });
    }).catch(err => showToast(err.message, 'error'));
    apiJson('/api/reviews/master/').then(d => setLists(Object.fromEntries(d.lists.map(l => [l.name, l.values]))))
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
    setDirty(true);
    recalc(next);
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

  const save = () => {
    setBusy('save');
    return apiJson(`/api/reviews/${c.id}/items/`, jsonBody('PUT', { items: strip(items) }))
      .then(d => { setItems(withKeys(d.items)); setCalc(d.calc); setDirty(false); onCaseChanged(d.case); return d; })
      .finally(() => setBusy(''));
  };
  useImperativeHandle(ref, () => ({ save, isDirty: () => dirty }));

  const importExcel = (file) => {
    if (items.length && !window.confirm('지금 입력한 구매 사양을 엑셀 내용으로 바꿉니다. 계속할까요?')) return;
    setBusy('import');
    const fd = new FormData();
    if (file) fd.append('file', file);
    apiJson(`/api/reviews/${c.id}/items/import/`, { method: 'POST', body: fd })
      .then(d => {
        setItems(withKeys(d.items)); setCalc(d.calc); setDirty(false); setWarnings(d.warnings || []); onCaseChanged(d.case);
        showToast(`엑셀에서 ${d.items.length}줄을 불러왔습니다.`);
      })
      .catch(err => showToast(err.message, 'error')).finally(() => setBusy(''));
  };

  // 기준정보 목록 → <datalist> (입력칸에 목록을 제안)
  const listNames = useMemo(() => Object.keys(lists), [lists]);
  const dl = (name) => (name && lists[name] ? `ml-${listNames.indexOf(name)}` : undefined);
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
      {Object.entries(lists).map(([name, values], i) => (
        <datalist key={name} id={`ml-${i}`}>{values.map(v => <option key={v} value={v} />)}</datalist>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => save().then(() => showToast('구매 사양을 저장했습니다.')).catch(err => showToast(err.message, 'error'))}
          disabled={!!busy || !dirty} className={btnPrimary}>
          {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
        </button>
        {dirty && <span className="text-xs text-amber-600 font-medium">저장하지 않은 변경이 있습니다.</span>}
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
      <p className="text-xs text-slate-500 flex items-center gap-1"><Calculator size={12} /> 회색 글자는 자동 계산값입니다. 입력칸을 누르면 기준정보 목록이 나오고, 목록에 없는 값도 적을 수 있습니다.</p>

      {/* 서버 */}
      <Section onAdd={() => add('server')} label="서버" count={servers.length}>
        <table className="text-xs">
          <thead className="bg-white border-b border-slate-100"><tr>
            {['장비명', '제조사', '모델', '수량', 'OS', '장비 구분', 'CPU', '클럭 / 코어', 'CPU 수', '메모리', '수', 'Total',
              'Disk1', '크기', '단위', '수', 'Disk2', '크기', '단위', '수', 'HBA', '수', 'NIC', '수', 'GPU', '수', '비고', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {servers.map(it => {
              const d = it.data, k = it._k, cc = calcOf[k];
              return (
                <tr key={k} className="border-b border-slate-50">
                  <td className={td}><Inp v={it.name} on={v => setField(k, 'name', v)} w="w-28" ph="호스트명" /></td>
                  <td className={td}><Inp v={it.maker} on={v => setField(k, 'maker', v)} listId={dl('제조사_서버')} w="w-20" /></td>
                  <td className={td}><Inp v={it.model} on={v => setField(k, 'model', v)} listId={dl(`서버모델_${it.maker}`)} w="w-28" />
                    <Code v={cc.codes?.svr} /></td>
                  <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                  <td className={td}><Inp v={d.os} on={v => setData(k, 'os', v)} listId={dl('OS')} w="w-32" /></td>
                  <td className={td}><Auto>{cc.usage || '-'}</Auto></td>
                  <td className={td}><Inp v={d.cpu} on={v => setData(k, 'cpu', v)} listId={dl(`List_${us(it.model)}`)} w="w-36" ph={lists[`List_${us(it.model)}`] ? '호환 CPU' : ''} /></td>
                  <td className={td}><Auto>{d.cpu ? `${fmt(cc.clock)}GHz / ${fmt(cc.cores)}core` : '-'}</Auto></td>
                  <td className={td}><Inp v={d.cpu_qty} on={v => setData(k, 'cpu_qty', v)} w="w-12" /></td>
                  <td className={td}><Inp v={d.mem} on={v => setData(k, 'mem', v)} listId={dl('MEMORY')} w="w-24" /></td>
                  <td className={td}><Inp v={d.mem_qty} on={v => setData(k, 'mem_qty', v)} w="w-12" /></td>
                  <td className={td}><Auto>{cc.mem_total != null ? `${cc.mem_total}GB` : '-'}</Auto></td>
                  {[1, 2].map(n => [
                    <td key={`t${n}`} className={td}><Inp v={d[`disk${n}_type`]} on={v => setData(k, `disk${n}_type`, v)} listId={dl('DiskType')} w="w-20" /></td>,
                    <td key={`s${n}`} className={td}><Inp v={d[`disk${n}`]} on={v => setData(k, `disk${n}`, v)} w="w-14" /></td>,
                    <td key={`u${n}`} className={td}>
                      <select className={cellCls} value={d[`disk${n}_unit`] || ''} onChange={e => setData(k, `disk${n}_unit`, e.target.value)}>
                        <option value="TB">TB</option><option value="GB">GB</option><option value="">-</option>
                      </select></td>,
                    <td key={`q${n}`} className={td}><Inp v={d[`disk${n}_qty`]} on={v => setData(k, `disk${n}_qty`, v)} w="w-12" /></td>,
                  ])}
                  <td className={td}><Inp v={d.hba} on={v => setData(k, 'hba', v)} listId={dl('HBA')} w="w-24" /></td>
                  <td className={td}><Inp v={d.hba_qty} on={v => setData(k, 'hba_qty', v)} w="w-12" /></td>
                  <td className={td}><Inp v={d.nic} on={v => setData(k, 'nic', v)} listId={dl('NIC')} w="w-24" /></td>
                  <td className={td}><Inp v={d.nic_qty} on={v => setData(k, 'nic_qty', v)} w="w-12" /></td>
                  <td className={td}><Inp v={d.gpu} on={v => setData(k, 'gpu', v)} listId={dl(`GPU_${us(it.model)}`)} w="w-24" /></td>
                  <td className={td}><Inp v={d.gpu_qty} on={v => setData(k, 'gpu_qty', v)} w="w-12" /></td>
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
                    <td className={td}><Inp v={it.maker} on={v => setField(k, 'maker', v)} listId={dl('제조사_스토리지')} w="w-24" /></td>
                    <td className={td}><Inp v={it.model} on={v => setField(k, 'model', v)} listId={dl(`스토리지모델_${it.maker}`)} w="w-24" /><Code v={cc.codes?.sto} /></td>
                    <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                  </> : <td colSpan={5} />}
                  <td className={td}><Inp v={dk.type} on={v => setDisk(k, i, 'type', v)} listId={dl('DiskType')} w="w-20" /></td>
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
                const makerList = block === 'etc' ? `제조사_${it.kind}` : nwMakerList(it.kind);
                return (
                  <tr key={k} className="border-b border-slate-50">
                    <td className={td}>
                      <input className={`${cellCls} w-32`} value={it.kind} list={`kinds-${block}`} onChange={e => setField(k, 'kind', e.target.value)} />
                    </td>
                    <td className={td}><Inp v={it.name} on={v => setField(k, 'name', v)} w="w-28" ph={cc.name} /></td>
                    <td className={td}><Inp v={it.usage} on={v => setField(k, 'usage', v)} w="w-36" ph={cc.usage} /></td>
                    <td className={td}><Inp v={it.maker} on={v => setField(k, 'maker', v)} listId={dl(makerList)} w="w-24" /></td>
                    <td className={td}><Inp v={it.model} on={v => setField(k, 'model', v)} listId={dl(`모델_${group}_${it.maker}`)} w="w-36" /><Code v={cc.codes?.etc} /></td>
                    <td className={td}><Inp v={it.data.spec} on={v => setData(k, 'spec', v)} listId={dl(`Spec_${group}_${it.maker}`)} w="w-64" /></td>
                    <td className={td}><Inp v={it.qty} on={v => setField(k, 'qty', v)} w="w-12" /></td>
                    <td className={td}><Inp v={it.note} on={v => setField(k, 'note', v)} w="w-32" /></td>
                    <RowTools onMove={dir => move(it._k, dir)} onCopy={() => duplicate(it._k)} onRemove={() => remove(it._k)} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id={`kinds-${block}`}>{(meta.kinds[block] || []).map(v => <option key={v} value={v} />)}</datalist>
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
                  <td className={td}><Inp v={it.maker} on={v => setField(k, 'maker', v)} listId={dl(`제조사_${it.kind}`)} w="w-28" /></td>
                  <td className={td}><Inp v={it.model} on={v => setField(k, 'model', v)} listId={dl(`SW_${it.maker}`)} w="w-40" /><Code v={cc.codes?.sw} /></td>
                  <td className={td}><Inp v={d.version} on={v => setData(k, 'version', v)} listId={dl(`${us(it.model)}_ver`)} w="w-16" /></td>
                  <td className={td}><Inp v={d.edition} on={v => setData(k, 'edition', v)} listId={dl(`${us(it.model)}_Edition`)} w="w-24" /></td>
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
