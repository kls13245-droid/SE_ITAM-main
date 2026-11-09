import React from 'react';
import { Edit, Plus, X, Save, Server, Database, Network, Copy, Activity } from 'lucide-react';

export default function ServerForm({
  editForm,
  presets,
  activePort,
  portInputValue,
  setPortInputValue,
  onCancel,
  onSave,
  onFormChange,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onPortSave,
  renderSwitchPorts,
}) {
  return (
<div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
                      <h2 className="text-2xl font-bold text-slate-800 flex items-center">{editForm.id ? <><Edit size={24} className="mr-2 text-blue-600"/> 장비 정보 수정</> : <><Plus size={24} className="mr-2 text-emerald-600"/> 신규 장비 실장</>}</h2>
                      <div className="flex gap-2">
                        <button onClick={onCancel} className="px-4 py-2 flex items-center text-sm font-bold bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition shadow-sm"><X size={16} className="mr-1"/> 취소</button>
                        <button onClick={onSave} className="px-4 py-2 flex items-center text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md"><Save size={16} className="mr-1"/> DB에 저장</button>
                      </div>
                    </div>

                    <div className="mb-6 p-4 bg-blue-50/50 border border-blue-100 rounded-xl flex justify-between items-center">
                      <div>
                        <span className="text-xs font-bold text-blue-700 uppercase tracking-widest flex items-center mb-1"><Save size={14} className="mr-1"/> 템플릿(프리셋) 관리</span>
                        <p className="text-xs text-slate-500">자주 쓰는 장비 제원을 템플릿으로 등록하여 빠르게 불러오세요.</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={onSavePreset} className="bg-white border border-blue-200 text-blue-600 px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-50 transition-colors shadow-sm">현재 입력값으로 템플릿 생성</button>
                      </div>
                    </div>
                    
                    {Object.keys(presets).length > 0 && (
                      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
                        {Object.keys(presets).map(pName => (
                          <div key={pName} className="flex items-center bg-blue-600 text-white rounded-full shadow-sm text-xs font-bold shrink-0">
                            <button onClick={() => onLoadPreset(pName)} className="px-3 py-1.5 hover:bg-blue-500 rounded-l-full transition-colors flex items-center" title="이 템플릿 제원 불러오기"><Copy size={12} className="mr-1.5 opacity-80" /> {pName}</button>
                            <button onClick={(e) => onDeletePreset(e, pName)} className="px-2 py-1.5 bg-blue-700 hover:bg-red-500 rounded-r-full transition-colors" title="템플릿 삭제"><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <label className="block text-xs font-bold text-slate-700 mb-2">자산 유형 (Asset Type) 선택</label>
                      <div className="flex gap-4">
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'server' || !editForm.specs?.asset_type ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="server" className="hidden" checked={editForm.specs?.asset_type === 'server' || !editForm.specs?.asset_type} onChange={(e) => onFormChange(e, 'asset_type', true)} />
                          <Server size={18} className="mr-2" /> 서버 (Server)
                        </label>
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'storage' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="storage" className="hidden" checked={editForm.specs?.asset_type === 'storage'} onChange={(e) => onFormChange(e, 'asset_type', true)} />
                          <Database size={18} className="mr-2" /> 스토리지 (Storage)
                        </label>
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'switch' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="switch" className="hidden" checked={editForm.specs?.asset_type === 'switch'} onChange={(e) => onFormChange(e, 'asset_type', true)} />
                          <Network size={18} className="mr-2" /> 스위치 (Switch)
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-5 mb-6">
                      <div className="col-span-2 sm:col-span-1 flex gap-2"><div className="w-1/2"><label className="block text-xs font-bold text-slate-700 mb-1">시작 위치 (U) <span className="text-red-500">*</span></label><input type="number" value={editForm.start_u || ''} onChange={(e) => onFormChange(e, 'start_u')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 32" /></div><div className="w-1/2"><label className="block text-xs font-bold text-slate-700 mb-1">장비 높이 (Size) <span className="text-red-500">*</span></label><input type="number" min="1" value={editForm.size_u || 1} onChange={(e) => onFormChange(e, 'size_u')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 2" /></div></div>
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">Hostname <span className="text-red-500">*</span></label><input type="text" value={editForm.hostname || ''} onChange={(e) => onFormChange(e, 'hostname')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: kr-gh-nrdk-db01" /></div>
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">모델명 (Model)</label><input type="text" list="model-list" value={editForm.model_name || ''} onChange={(e) => onFormChange(e, 'model_name')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: Dell PowerEdge R650" /></div>
                      
                      {/* ⭐️ OS Version을 무적의 specs 로 저장 */}
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">OS Version</label><input type="text" value={editForm.specs?.os_version || editForm.os_version || ''} onChange={(e) => onFormChange(e, 'os_version', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: Ubuntu 22.04 LTS" /></div>
                      
                      <div className="col-span-2 sm:col-span-1 flex gap-4"><div className="flex-1"><label className="block text-xs font-bold text-slate-700 mb-1">운영 상태 <span className="text-red-500">*</span></label><select value={editForm.status || 'WAIT'} onChange={(e) => onFormChange(e, 'status')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow font-bold"><option value="WAIT">입고/셋업 대기 (WAIT)</option><option value="OPER">정상 운영 (OPER)</option><option value="MAINT">장애/수리 (MAINT)</option><option value="IDLE">유휴/폐기 (IDLE)</option></select></div><div className="flex-1"><label className="block text-xs font-bold text-slate-700 mb-1">도입 년도</label><input type="text" value={editForm.setup_year || ''} onChange={(e) => onFormChange(e, 'setup_year')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 2024" /></div></div>
                      
                      {editForm.specs?.asset_type !== 'switch' && (
                        <div className="col-span-2"><label className="block text-xs font-bold text-slate-700 mb-1">자산 용도 / 비고 (설명)</label><input type="text" value={editForm.description || ''} onChange={(e) => onFormChange(e, 'description')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow placeholder-slate-300" placeholder="장비의 주요 용도를 적어주세요." /></div>
                      )}
                    </div>
                    
                    {editForm.specs?.asset_type === 'switch' ? (
                      <>
                        <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2 flex items-center"><Network size={18} className="mr-2 text-emerald-500"/> 스위치 기본 정보 및 포트 매핑 (Port Mapping)</h3>
                        <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-5 rounded-xl border border-slate-200 shadow-inner mb-6">
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Management IP</label><input type="text" value={editForm.specs?.mgmt_ip || editForm.specs?.ip || ''} onChange={(e) => onFormChange(e, 'mgmt_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 10.1.2.3" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Serial Number (S/N)</label><input type="text" value={editForm.specs?.serial_number || ''} onChange={(e) => onFormChange(e, 'serial_number', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SN-12345ABC" /></div>
                        </div>

                        <div className="mb-2"><span className="text-sm font-bold text-slate-700">포트 시각화 매핑 (포트를 클릭하여 연결된 서버를 할당하세요)</span></div>
                        {renderSwitchPorts(editForm.specs?.switch_ports || {}, true)}
                      </>
                    ) : (
                      <>
                        <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2 flex items-center"><Activity size={18} className="mr-2 text-blue-500"/> 상세 제원 및 자원 할당</h3>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50/50 p-5 rounded-xl border border-slate-200 shadow-inner">
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">CPU</label><input type="text" list="cpu-list" value={editForm.specs?.cpu || ''} onChange={(e) => onFormChange(e, 'cpu', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: Intel Xeon Silver" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Memory (RAM)</label><input type="text" list="ram-list" value={editForm.specs?.ram || ''} onChange={(e) => onFormChange(e, 'ram', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 128GB" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Storage (Disk)</label><input type="text" value={editForm.specs?.storage || ''} onChange={(e) => onFormChange(e, 'storage', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 1.92TB NVMe x2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">GPU / 가속기</label><input type="text" list="gpu-list" value={editForm.specs?.gpu || ''} onChange={(e) => onFormChange(e, 'gpu', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                          
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">전력 소모량 (W)</label><input type="number" value={editForm.specs?.power_w || ''} onChange={(e) => onFormChange(e, 'power_w', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 1200" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Public LAN (포트 수)</label><input type="number" value={editForm.specs?.public_lan || ''} onChange={(e) => onFormChange(e, 'public_lan', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Private LAN (포트 수)</label><input type="number" value={editForm.specs?.private_lan || ''} onChange={(e) => onFormChange(e, 'private_lan', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 2" /></div>

                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Public IP</label><input type="text" value={editForm.specs?.public_ip || ''} onChange={(e) => onFormChange(e, 'public_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 100.100.181.2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Virtual IP</label><input type="text" value={editForm.specs?.virtual_ip || ''} onChange={(e) => onFormChange(e, 'virtual_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 100.100.180.1" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Private IP</label><input type="text" value={editForm.specs?.private_ip || ''} onChange={(e) => onFormChange(e, 'private_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 192.168.90.71" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">MGMT IP (iDRAC 등)</label><input type="text" value={editForm.specs?.mgmt_ip || editForm.specs?.ip || ''} onChange={(e) => onFormChange(e, 'mgmt_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 192.168.1.10" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Serial Number (S/N)</label><input type="text" value={editForm.specs?.serial_number || ''} onChange={(e) => onFormChange(e, 'serial_number', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SN-12345ABC" /></div>

                          <div><label className="block text-xs font-bold text-slate-600 mb-1">상단 L2 스위치</label><input type="text" value={editForm.specs?.l2_switch || ''} onChange={(e) => onFormChange(e, 'l2_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: SW-L2-01" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">상단 SAN 스위치</label><input type="text" value={editForm.specs?.san_switch || ''} onChange={(e) => onFormChange(e, 'san_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: SW-SAN-01" /></div>
                          
                          <div className="md:col-span-2 lg:col-span-1"><label className="block text-xs font-bold text-slate-600 mb-1">하단 SAN 스위치</label><input type="text" value={editForm.specs?.bottom_san_switch || ''} onChange={(e) => onFormChange(e, 'bottom_san_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SW-SAN-02" /></div>
                          {/* ⭐️ 볼륨 마운트 입력칸 (와이드 배치) */}
                          <div className="col-span-2 lg:col-span-3"><label className="block text-xs font-bold text-slate-600 mb-1">볼륨 마운트 (Volume Mount)</label><input type="text" value={editForm.specs?.volume_mount || ''} onChange={(e) => onFormChange(e, 'volume_mount', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono text-blue-700" placeholder="예: /data, /backup" /></div>
                        </div>
                      </>
                    )}
                  </div>
  );
}
