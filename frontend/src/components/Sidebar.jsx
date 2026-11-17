import React from 'react';
import { Folder, FolderOpen, Plus, RefreshCw, CheckCircle, X, Building, LogOut, Pencil, Trash2, MapPin, FileText, AlertTriangle } from 'lucide-react';

export default function Sidebar({
  siteData, loading, expandedCampus, selectedBuilding,
  isAddingCampus, newCampusName, setNewCampusName,
  isAddingBuilding, newBuildingName, setNewBuildingName, targetCampusId,
  onGoHome, onLogout, onRefresh, onStartAddCampus, onSaveCampus, onCancelCampus,
  onCampusClick, onStartAddBuilding, onSaveBuilding, onCancelBuilding, onBuildingClick,
  onRenameCampus, onDeleteCampus, onRenameBuilding, onDeleteBuilding,
  activeView, onOpenFieldAssets, onOpenReviews, onOpenIncidents,
}) {
  return (
    <div className="w-72 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-10 shrink-0">
      <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="cursor-pointer flex-1" onClick={onGoHome} title="처음 화면으로">
          <h1 className="text-xl font-bold text-white tracking-wider"><span className="text-orange-500 mr-1">MIRERO</span>ITAM</h1>
          <p className="text-xs text-slate-500 mt-1">Asset Management</p>
        </div>
        <button onClick={onLogout} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-red-400" title="로그아웃"><LogOut size={20} /></button>
      </div>
      <div className="overflow-y-auto flex-1 p-3">
        <div className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase tracking-widest">Field</div>
        <button onClick={onOpenFieldAssets} className={`w-full flex items-center p-2 rounded mb-1 text-left ${activeView === 'field' ? 'bg-orange-500/20 text-orange-300 font-medium' : 'hover:bg-slate-800'}`}>
          <MapPin size={18} className={`mr-2 shrink-0 ${activeView === 'field' ? 'text-orange-400' : 'text-slate-500'}`} />
          <span className="truncate">서버 현황</span>
        </button>
        <button onClick={onOpenIncidents} className={`w-full flex items-center p-2 rounded mb-4 text-left ${activeView === 'incidents' ? 'bg-red-500/20 text-red-300 font-medium' : 'hover:bg-slate-800'}`}>
          <AlertTriangle size={18} className={`mr-2 shrink-0 ${activeView === 'incidents' ? 'text-red-400' : 'text-slate-500'}`} />
          <span className="truncate">장애·유지보수 보고</span>
        </button>
        <div className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase tracking-widest">Docs</div>
        <button onClick={onOpenReviews} className={`w-full flex items-center p-2 rounded mb-4 text-left ${activeView === 'reviews' ? 'bg-violet-500/20 text-violet-300 font-medium' : 'hover:bg-slate-800'}`}>
          <FileText size={18} className={`mr-2 shrink-0 ${activeView === 'reviews' ? 'text-violet-400' : 'text-slate-500'}`} />
          <span className="truncate">투자심의 자료</span>
        </button>
        <div className="text-xs font-semibold text-slate-500 mb-3 px-2 uppercase tracking-widest flex justify-between items-center">
          <span>Site Topology</span>
          <div className="flex items-center gap-1.5">
            <button onClick={onStartAddCampus} className="p-1 hover:bg-slate-800 rounded" title="새 캠퍼스"><Plus size={14}/></button>
            <button onClick={onRefresh} className="p-1 hover:bg-slate-800 rounded" title="새로고침"><RefreshCw size={14} className={loading ? 'animate-spin text-blue-400' : ''} /></button>
          </div>
        </div>
        {isAddingCampus && (
          <div className="mb-2 p-2 bg-slate-800 rounded flex gap-2">
            <input type="text" value={newCampusName} onChange={(e)=>setNewCampusName(e.target.value)} placeholder="캠퍼스 이름" className="flex-1 bg-slate-900 text-white text-sm px-2 py-1 rounded outline-none border border-slate-700" onKeyDown={(e) => { if(e.key==='Enter') onSaveCampus(); }} />
            <button onClick={onSaveCampus} className="text-emerald-400"><CheckCircle size={16}/></button>
            <button onClick={onCancelCampus} className="text-slate-500"><X size={16}/></button>
          </div>
        )}
        {loading ? <div className="text-center p-4 text-slate-500 text-sm">데이터 동기화 중...</div> : siteData.length === 0 ? <div className="text-center p-4 text-slate-500 text-sm">등록된 사이트가 없습니다.</div> : siteData.map(campus => (
          <div key={campus.id} className="mb-1">
            <div className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800 group">
              <button onClick={() => onCampusClick(campus.id)} className="flex-1 flex items-center text-left min-w-0">
                {expandedCampus === campus.id ? <FolderOpen size={18} className="text-blue-400 mr-2 shrink-0" /> : <Folder size={18} className="text-slate-500 mr-2 shrink-0" />}
                <span className={`truncate ${expandedCampus === campus.id ? 'text-white font-medium' : ''}`}>{campus.name}</span>
              </button>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={() => onRenameCampus(campus)} className="text-slate-400 hover:text-white" title="이름 수정"><Pencil size={12}/></button>
                <button onClick={() => onDeleteCampus(campus)} className="text-slate-400 hover:text-red-400" title="삭제"><Trash2 size={12}/></button>
                <button onClick={() => onStartAddBuilding(campus.id)} className="text-slate-400 hover:text-white" title="건물 추가"><Plus size={14}/></button>
              </div>
            </div>
            {expandedCampus === campus.id && (
              <div className="ml-6 mt-1 border-l border-slate-700 pl-2">
                {isAddingBuilding && targetCampusId === campus.id && (
                  <div className="mb-1 p-1 bg-slate-800 rounded flex gap-1">
                    <input type="text" value={newBuildingName} onChange={(e)=>setNewBuildingName(e.target.value)} placeholder="건물 이름" className="flex-1 bg-slate-900 text-white text-xs px-2 py-1 rounded outline-none border border-slate-700" onKeyDown={(e) => { if(e.key==='Enter') onSaveBuilding(); }} />
                    <button onClick={onSaveBuilding} className="text-emerald-400"><CheckCircle size={14}/></button>
                    <button onClick={onCancelBuilding} className="text-slate-500"><X size={14}/></button>
                  </div>
                )}
                {campus.buildings?.map(building => (
                  <div key={building.id} className="flex items-center group/b">
                    <button onClick={() => onBuildingClick(building, campus)} className={`flex-1 flex items-center p-2 rounded mb-1 min-w-0 ${activeView === 'topology' && selectedBuilding?.id === building.id ? 'bg-blue-600/20 text-blue-400 font-medium' : 'hover:bg-slate-800 text-sm'}`}>
                      <Building size={14} className="mr-2 opacity-70 shrink-0" /><span className="truncate">{building.name}</span>
                    </button>
                    <button onClick={() => onRenameBuilding(building)} className="opacity-0 group-hover/b:opacity-100 text-slate-400 hover:text-white px-1" title="수정"><Pencil size={12}/></button>
                    <button onClick={() => onDeleteBuilding(building)} className="opacity-0 group-hover/b:opacity-100 text-slate-400 hover:text-red-400 px-1" title="삭제"><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
