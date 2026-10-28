import React from 'react';
import { AlignJustify, Copy, Plus, Server, Network, Database } from 'lucide-react';

const U_HEIGHT = 20;

function getStatusLED(status) {
  switch (status) {
    case 'OPER': return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]';
    case 'MAINT': return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse';
    case 'IDLE': return 'bg-slate-400';
    case 'WAIT': return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]';
    default: return 'bg-slate-300';
  }
}

function getAssetTypeIcon(type, size = 12, className = '') {
  if (type === 'switch') return <Network size={size} className={className} />;
  if (type === 'storage') return <Database size={size} className={className} />;
  return <Server size={size} className={className} />;
}

function statusBorderClass(status) {
  switch (status) {
    case 'OPER':
      return 'border-l-4 border-l-emerald-500 border-y-slate-300 border-r-slate-300 text-slate-800';
    case 'MAINT':
      return 'border-l-4 border-l-red-500 border-y-red-200 border-r-red-200 text-red-900 bg-red-50';
    case 'IDLE':
      return 'border-l-4 border-l-slate-400 border-y-slate-300 border-r-slate-300 text-slate-600';
    case 'WAIT':
      return 'border-l-4 border-l-amber-400 border-y-amber-200 border-r-amber-200 text-amber-900 bg-amber-50';
    default:
      return 'border-slate-300 text-slate-800';
  }
}

export default function RackDiagram({
  rack,
  servers = [],
  selectedServerId,
  searchTerm = '',
  onEmptyUClick,
  onServerClick,
  onDragStart,
  onDragOver,
  onDrop,
  onRackNameClick,
  onCopyImage,
}) {
  if (!rack) return null;

  const totalU = rack.total_u_space || 42;
  const term = searchTerm.toLowerCase();
  const units = Array.from({ length: totalU }, (_, i) => totalU - i);

  const isMatch = (server) =>
    !term ||
    (server.hostname && server.hostname.toLowerCase().includes(term)) ||
    (server.model_name && server.model_name.toLowerCase().includes(term)) ||
    (server.specs?.ip && server.specs.ip.includes(term));

  return (
    <div id="rack-panel-wrapper" className="w-full lg:w-96 flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden shrink-0">
      <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0 border-b-4 border-blue-500">
        <div
          className="flex items-center cursor-pointer hover:text-blue-300 transition-colors group"
          onClick={onRackNameClick}
          title="랙 자산 명세서 화면으로 돌아가기"
        >
          <AlignJustify size={18} className="mr-2 opacity-80 group-hover:opacity-100" />
          <h3 className="font-bold tracking-wide">{rack.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopyImage}
            className="bg-slate-700 hover:bg-blue-600 text-slate-200 hover:text-white p-1.5 rounded transition-colors"
            title="실장도 고해상도 그림 캡처 및 복사"
          >
            <Copy size={16} />
          </button>
          <span className="text-xs bg-slate-700 px-2.5 py-1 rounded font-bold border border-slate-600">
            {totalU}U
          </span>
        </div>
      </div>

      <div id="rack-scroll-area" className="flex-1 overflow-y-auto p-4 bg-slate-100 flex justify-center relative">
        <div
          className="w-full max-w-[280px] bg-slate-800 rounded-t-xl border-x-[12px] border-t-[12px] border-b-[24px] border-slate-700 shadow-2xl relative box-content shrink-0"
          style={{ height: `${totalU * U_HEIGHT}px` }}
        >
          {units.map((u) => (
            <div
              key={u}
              onClick={() => onEmptyUClick?.(u)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop?.(e, u)}
              className="h-[20px] w-full border-b border-slate-700/50 flex items-center px-1 absolute cursor-pointer hover:bg-blue-900/40 group transition-colors box-border"
              style={{ top: `${(totalU - u) * U_HEIGHT}px` }}
              title={`U${u} 위치에 새 장비 실장하기`}
            >
              <span className="text-[9px] text-slate-500 font-mono w-5 shrink-0 select-none text-right pr-1 leading-none">
                {u}
              </span>
              <div className="hidden group-hover:flex items-center text-[10px] text-blue-400 font-bold ml-1">
                <Plus size={12} className="mr-0.5" /> 배치/실장
              </div>
            </div>
          ))}

          {servers.map((server) => {
            if (!server.start_u) return null;
            const match = isMatch(server);
            return (
              <div
                key={server.id}
                onClick={() => onServerClick?.(server)}
                draggable
                onDragStart={(e) => onDragStart?.(e, server)}
                onDragOver={onDragOver}
                onDrop={(e) => {
                  e.stopPropagation();
                  onDrop?.(e, server.start_u);
                }}
                className={`absolute left-7 right-1 rounded-[3px] border flex items-center px-1.5 cursor-pointer transition-all hover:brightness-110 shadow-md overflow-hidden bg-gradient-to-r from-slate-100 to-white box-border ${statusBorderClass(server.status)} ${selectedServerId === server.id ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-800 z-20 scale-[1.02]' : 'z-10'} ${!match && searchTerm ? 'opacity-20 grayscale' : 'opacity-100'}`}
                style={{
                  top: `${(totalU - server.start_u - (server.size_u || 1) + 1) * U_HEIGHT}px`,
                  height: `${(server.size_u || 1) * U_HEIGHT}px`,
                }}
              >
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-20 cursor-grab active:cursor-grabbing">
                  <div className="w-1 h-1 rounded-full bg-black" />
                  <div className="w-1 h-1 rounded-full bg-black" />
                  <div className="w-1 h-1 rounded-full bg-black" />
                </div>
                <div className="flex items-center w-full min-w-0 pr-3 z-10">
                  <div className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${getStatusLED(server.status)}`} />
                  {getAssetTypeIcon(server.specs?.asset_type, 12, 'mr-1 opacity-70 shrink-0 text-slate-500')}
                  <span
                    className={`font-mono font-bold truncate flex-1 leading-none mt-[1px] text-slate-700 tracking-tight ${(server.size_u || 1) === 1 ? 'text-[10px]' : 'text-xs'}`}
                  >
                    {server.hostname || server.model_name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
