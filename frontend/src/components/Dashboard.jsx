import React from 'react';
import { Server, CheckCircle, Clock, AlertTriangle, Info, MapPin } from 'lucide-react';

export default function Dashboard({ stats, onOpenStatus }) {
  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl mx-auto w-full">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight"><span className="text-orange-500">MIRERO</span> 전체 INFRA 현황 DASHBOARD</h2>
        <p className="text-slate-500 text-sm mt-1">전사 IT 자산 및 랙(Rack) 실장 상태를 한눈에 모니터링합니다.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><Server size={16} className="mr-1.5 text-blue-500"/> 전체 등록 서버</h3>
          <div className="flex items-baseline gap-2"><span className="text-4xl font-black">{stats.totalServers}</span><span className="text-sm text-slate-500">대</span></div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><CheckCircle size={16} className="mr-1.5 text-emerald-500"/> 정상 가동률</h3>
          <div className="flex items-baseline gap-2"><span className="text-4xl font-black">{stats.operRate}</span><span className="text-sm text-slate-500">%</span></div>
          <div className="mt-3 w-full bg-slate-100 h-1.5 rounded-full"><div className="bg-emerald-500 h-full" style={{ width: `${stats.operRate}%` }} /></div>
        </div>
        <div onClick={() => stats.waitCount > 0 && onOpenStatus('WAIT')} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer">
          <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><Clock size={16} className="mr-1.5 text-amber-500"/> 셋업 대기 자산</h3>
          <div className="flex items-baseline gap-2"><span className="text-4xl font-black text-amber-500">{stats.waitCount}</span><span className="text-sm text-slate-500">건</span></div>
        </div>
        <div onClick={() => stats.maintCount > 0 && onOpenStatus('MAINT')} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer">
          <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><AlertTriangle size={16} className="mr-1.5 text-red-500"/> 장애 / 점검 대상</h3>
          <div className="flex items-baseline gap-2"><span className="text-4xl font-black text-red-600">{stats.maintCount}</span><span className="text-sm text-slate-500">건</span></div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center"><Info size={18} className="mr-2 text-blue-500" /> 자산 운영 상태 분포</h3>
          <div className="w-full h-8 flex rounded-lg overflow-hidden mb-6 bg-slate-100">
            {stats.totalServers > 0 && <>
              <div className="bg-emerald-500 h-full" style={{ width: `${(stats.operCount / stats.totalServers) * 100}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${(stats.maintCount / stats.totalServers) * 100}%` }} />
              <div className="bg-slate-400 h-full" style={{ width: `${(stats.idleCount / stats.totalServers) * 100}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${(stats.waitCount / stats.totalServers) * 100}%` }} />
            </>}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>정상 운영 (OPER)</span><b>{stats.operCount} 대</b></div>
            <div className="flex justify-between"><span>장애/점검 (MAINT)</span><b>{stats.maintCount} 대</b></div>
            <div className="flex justify-between"><span>유휴 자산 (IDLE)</span><b>{stats.idleCount} 대</b></div>
            <div className="flex justify-between"><span>셋업 대기 (WAIT)</span><b>{stats.waitCount} 대</b></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm lg:col-span-2 overflow-hidden">
          <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
            <h3 className="text-lg font-bold flex items-center"><AlertTriangle size={18} className="mr-2 text-red-500" /> 집중 관리 대상</h3>
            <span className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-full font-bold">{stats.maintList.length}건</span>
          </div>
          <div className="p-4 max-h-[300px] overflow-y-auto">
            {stats.maintList.length === 0 ? <p className="text-emerald-600 font-bold text-center py-8">현재 장애가 없습니다.</p> : stats.maintList.map(server => (
              <div key={server.id} className="bg-white border border-red-100 p-4 rounded-xl mb-3">
                <div className="flex justify-between"><b className="font-mono text-sm">{server.hostname}</b><span className="text-[10px] font-mono">{server.specs?.ip}</span></div>
                <p className="text-xs text-slate-500 mt-1 flex items-center"><MapPin size={12} className="mr-1" />{server.locationPath}</p>
                <p className="text-sm text-red-700 mt-2">{server.description || '내용 없음'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
