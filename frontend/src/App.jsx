import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, FolderOpen, Server, ChevronRight, Activity, AlertTriangle, 
  Moon, HardDrive, Cpu, Database, MapPin, RefreshCw, Home, Save, 
  X, Edit, Plus, Search, CheckCircle, Info, Clock, ArrowRight, Trash2, 
  Zap, Network, Key, List, Copy, Monitor, AlignJustify, Building, ChevronLeft,
  LogOut, Lock, User as UserIcon
} from 'lucide-react';

export default function App() {
  const [siteData, setSiteData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [toast, setToast] = useState(null);

  const [expandedCampus, setExpandedCampus] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedRack, setSelectedRack] = useState(null);
  const [selectedServer, setSelectedServer] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  const [activePort, setActivePort] = useState(null);
  const [portInputValue, setPortInputValue] = useState('');

  const [isAddingRack, setIsAddingRack] = useState(false);
  const [newRackForm, setNewRackForm] = useState({ name: '', location: '', total_u_space: 42 });

  const [isAddingCampus, setIsAddingCampus] = useState(false);
  const [newCampusName, setNewCampusName] = useState('');
  const [isAddingBuilding, setIsAddingBuilding] = useState(false);
  const [targetCampusId, setTargetCampusId] = useState(null);
  const [newBuildingName, setNewBuildingName] = useState('');

  const [statusModalInfo, setStatusModalInfo] = useState(null);
  const [drillDownPage, setDrillDownPage] = useState(1);
  const ITEMS_PER_PAGE = 10; 

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [serverHistory, setServerHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ⭐️ 템플릿(프리셋) 상태 관리
  const [presets, setPresets] = useState(() => {
    try {
      const saved = localStorage.getItem('itam_presets');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // ⭐️ 로그인 상태 관리
  const [isAuthenticated, setIsAuthenticated] = useState(localStorage.getItem('itam_auth') === 'true');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const API_BASE_URL = 'http://192.168.70.248:8000';

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchSiteData = () => {
    setLoading(true);
    setApiError(null);
    fetch(`${API_BASE_URL}/api/site-data/`) 
      .then(res => {
        if (!res.ok) throw new Error('서버 응답 오류');
        return res.json();
      })
      .then(data => {
        setSiteData(data);
        setLoading(false);
      })
      .catch(err => {
        setApiError("서버와 통신할 수 없습니다.");
        setSiteData([]); 
        showToast("서버 연동 실패", "error");
        setLoading(false);
      });
  };

  useEffect(() => { fetchSiteData(); }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    fetch(`${API_BASE_URL}/api/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm)
    })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (ok) {
        localStorage.setItem('itam_auth', 'true');
        localStorage.setItem('itam_user', data.username);
        setIsAuthenticated(true);
        showToast(`${data.username}님, 환영합니다!`, "success");
      } else {
        setLoginError(data.error || "로그인에 실패했습니다.");
      }
    })
    .catch(() => setLoginError("서버와 통신할 수 없습니다."));
  };

  const handleLogout = () => {
    localStorage.removeItem('itam_auth');
    localStorage.removeItem('itam_user');
    setIsAuthenticated(false);
  };

  const fetchServerHistory = (serverId) => {
    setLoadingHistory(true);
    setShowHistoryModal(true);
    fetch(`${API_BASE_URL}/api/server/history/${serverId}/`)
      .then(async res => {
        let data;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error('백엔드 응답을 파싱할 수 없습니다. (서버 에러)');
        }
        if (!res.ok) throw new Error(data.error || '서버 응답 오류');
        return data;
      })
      .then(data => {
        setServerHistory(Array.isArray(data) ? data : []);
        setLoadingHistory(false);
      })
      .catch(err => {
        showToast(`이력 조회 실패: ${err.message}`, "error");
        setServerHistory([]);
        setLoadingHistory(false);
      });
  };

  const dashboardStats = useMemo(() => {
    let totalServers = 0; let operCount = 0; let maintCount = 0; let idleCount = 0; let waitCount = 0;
    let totalU = 0; let usedU = 0; const maintList = [];

    siteData.forEach(campus => {
      campus.buildings?.forEach(building => {
        building.racks?.forEach(rack => {
          totalU += (rack.total_u_space || 42);
          rack.servers?.forEach(server => {
            totalServers++; usedU += (server.size_u || 1);
            if (server.status === 'OPER') operCount++;
            else if (server.status === 'MAINT') { maintCount++; maintList.push({ ...server, locationPath: `${campus.name} > ${building.name} > ${rack.name}`, campus, building, rack }); }
            else if (server.status === 'IDLE') idleCount++;
            else if (server.status === 'WAIT') waitCount++;
          });
        });
      });
    });

    return { 
      totalServers, operCount, maintCount, idleCount, waitCount, totalU, usedU, 
      operRate: totalServers > 0 ? Math.round((operCount / totalServers) * 100) : 0, 
      uUsageRate: totalU > 0 ? Math.round((usedU / totalU) * 100) : 0, maintList 
    };
  }, [siteData]);

  const existingSpecs = useMemo(() => {
    const models = new Set(); const cpus = new Set(); const rams = new Set(); const gpus = new Set();
    siteData.forEach(c => c.buildings?.forEach(b => b.racks?.forEach(r => r.servers?.forEach(s => {
      if (s.model_name) models.add(s.model_name); 
      if (s.specs?.cpu) cpus.add(s.specs.cpu);
      if (s.specs?.ram) rams.add(s.specs.ram); 
      if (s.specs?.gpu) gpus.add(s.specs.gpu);
    }))));
    return { models: Array.from(models), cpus: Array.from(cpus), rams: Array.from(rams), gpus: Array.from(gpus) };
  }, [siteData]);

  const globalSearchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    const results = [];
    siteData.forEach(campus => campus.buildings?.forEach(building => building.racks?.forEach(rack => rack.servers?.forEach(server => {
      if ((server.hostname && server.hostname.toLowerCase().includes(term)) || (server.specs?.ip && server.specs.ip.includes(term)) || (server.model_name && server.model_name.toLowerCase().includes(term))) {
        results.push({ campus, building, rack, server });
      }
    }))));
    return results.slice(0, 10); 
  }, [siteData, searchTerm]);

  // ⭐️ 분리된 스마트 그룹화 로직 (전기, PubLAN, PrivLAN, IP 독립 계산)
  const summaryStats = useMemo(() => {
    if (!selectedRack || !selectedRack.servers) return { power: [], pubLan: [], privLan: [], ip: [] };
    const powerMap = {}; const pubLanMap = {}; const privLanMap = {}; const ipMap = {};

    selectedRack.servers.forEach(s => {
      const model = s.model_name || '기종 미상';
      const power = Number(s.specs?.power_w) || 0;
      const pubLan = Number(s.specs?.public_lan) || 0;
      const privLan = Number(s.specs?.private_lan) || 0;
      const pubIpCount = s.specs?.public_ip?.trim() ? s.specs.public_ip.split(',').filter(x => x.trim()).length : 0;
      const vipCount = s.specs?.virtual_ip?.trim() ? s.specs.virtual_ip.split(',').filter(x => x.trim()).length : 0;

      // 1. 전기 (모델명 + 전력량)
      const pKey = `${model}-${power}`;
      if (!powerMap[pKey]) powerMap[pKey] = { model_name: model, power_w: power, count: 0 };
      powerMap[pKey].count += 1;

      // 2. Pub LAN (모델명 + LAN포트)
      if (pubLan > 0) {
        const pubKey = `${model}-${pubLan}`;
        if (!pubLanMap[pubKey]) pubLanMap[pubKey] = { model_name: model, pub_lan: pubLan, count: 0 };
        pubLanMap[pubKey].count += 1;
      }

      // 3. Priv LAN (모델명 + LAN포트)
      if (privLan > 0) {
        const privKey = `${model}-${privLan}`;
        if (!privLanMap[privKey]) privLanMap[privKey] = { model_name: model, priv_lan: privLan, count: 0 };
        privLanMap[privKey].count += 1;
      }

      // 4. IP (특수 IP가 있는 경우만 추가)
      if (pubIpCount > 0 || vipCount > 0) {
        const ipKey = `${model}-${power}`; // IP는 전력 힌트를 위해 같이 묶음
        if (!ipMap[ipKey]) ipMap[ipKey] = { model_name: model, power_w: power, pub_ip_count: 0, vip_count: 0 };
        ipMap[ipKey].pub_ip_count += pubIpCount;
        ipMap[ipKey].vip_count += vipCount;
      }
    });

    return {
      power: Object.values(powerMap),
      pubLan: Object.values(pubLanMap),
      privLan: Object.values(privLanMap),
      ip: Object.values(ipMap)
    };
  }, [selectedRack]);

  // ⭐️ 메인 상세 실장도 전체 합계 계산 로직
  const detailedTotals = useMemo(() => {
    if (!selectedRack || !selectedRack.servers) return { power: 0, current: 0, lan: 0, pip: 0, vip: 0, priv: 0 };
    let power = 0, lan = 0, pip = 0, vip = 0, priv = 0;
    selectedRack.servers.forEach(s => {
      power += Number(s.specs?.power_w) || 0;
      lan += Number(s.specs?.public_lan) || 0;
      priv += Number(s.specs?.private_lan) || 0;
      if (s.specs?.public_ip?.trim()) pip += s.specs.public_ip.split(',').filter(x => x.trim()).length;
      if (s.specs?.virtual_ip?.trim()) vip += s.specs.virtual_ip.split(',').filter(x => x.trim()).length;
    });
    return { power, current: power / 220, lan, pip, vip, priv };
  }, [selectedRack]);

  const rackTableRows = useMemo(() => {
    if (!selectedRack) return [];
    const rows = [];
    const totalU = selectedRack.total_u_space || 42;
    const servers = selectedRack.servers || [];

    for (let u = totalU; u >= 1; u--) {
      const serverHere = servers.find(s => u >= s.start_u && u < s.start_u + (s.size_u || 1));
      if (serverHere) {
        const isTopU = u === (serverHere.start_u + (serverHere.size_u || 1) - 1);
        rows.push({ u: u, isServer: true, isTopU: isTopU, server: serverHere, rowSpan: serverHere.size_u || 1 });
      } else {
        rows.push({ u: u, isServer: false });
      }
    }
    return rows;
  }, [selectedRack]);

  const goHome = () => { setSelectedBuilding(null); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); setSearchTerm(''); setActivePort(null); };
  const handleCampusClick = (campusId) => setExpandedCampus(expandedCampus === campusId ? null : campusId);
  const handleBuildingClick = (building, campus) => { setSelectedBuilding({ ...building, campusName: campus.name }); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleRackClick = (rack) => { setSelectedRack(rack); setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleRackNameClick = () => { setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleServerClick = (server) => { setSelectedServer(server); setIsEditing(false); setActivePort(null); };
  
  const handleGlobalSearchSelect = (result) => {
    setExpandedCampus(result.campus.id);
    setSelectedBuilding({ ...result.building, campusName: result.campus.name });
    setSelectedRack(result.rack);
    setSelectedServer(result.server);
    setIsEditing(false); setSearchTerm(''); setActivePort(null); setStatusModalInfo(null);
  };

  // ⭐️ 장비 실장 시 물리적 겹침 및 범위 초과를 방지하는 수학적 검증 함수
  const validateServerPlacement = (serverIdToIgnore, startU, sizeU) => {
    const newStart = parseInt(startU, 10);
    const newSize = parseInt(sizeU, 10) || 1;
    const newEnd = newStart + newSize - 1;
    const maxU = selectedRack.total_u_space || 42;

    if (isNaN(newStart) || newStart < 1) return { valid: false, error: "유효한 시작 U 위치를 입력하세요." };
    if (newEnd > maxU) return { valid: false, error: `장비가 랙의 최대 높이(${maxU}U)를 벗어납니다.` };

    for (const server of selectedRack.servers) {
      if (String(server.id) === String(serverIdToIgnore)) continue;

      const existingStart = parseInt(server.start_u, 10);
      const existingSize = parseInt(server.size_u, 10) || 1;
      const existingEnd = existingStart + existingSize - 1;

      if (newStart <= existingEnd && newEnd >= existingStart) {
        return { valid: false, error: `[${server.hostname || server.model_name || '이름 없음'}] 장비(U${existingStart}~U${existingEnd})와 위치가 물리적으로 겹칩니다!` };
      }
    }
    return { valid: true };
  };

  const handleSaveCampus = () => {
    if (!newCampusName.trim()) { showToast("캠퍼스 이름을 입력해주세요.", "error"); return; }
    fetch(`${API_BASE_URL}/api/campus/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCampusName }) })
    .then(res => { if (!res.ok) throw new Error('저장 실패'); return res.json(); })
    .then(savedCampus => {
      setSiteData([...siteData, { ...savedCampus, buildings: [] }]);
      setIsAddingCampus(false); setNewCampusName(''); showToast("캠퍼스가 추가되었습니다.", "success");
    }).catch(err => showToast("오류가 발생했습니다.", "error"));
  };

  const handleSaveBuilding = () => {
    if (!newBuildingName.trim()) { showToast("건물 이름을 입력해주세요.", "error"); return; }
    fetch(`${API_BASE_URL}/api/building/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campus_id: targetCampusId, name: newBuildingName }) })
    .then(res => { if (!res.ok) throw new Error('저장 실패'); return res.json(); })
    .then(savedBuilding => {
      setSiteData(siteData.map(c => c.id === targetCampusId ? { ...c, buildings: [...(c.buildings || []), { ...savedBuilding, racks: [] }] } : c));
      setIsAddingBuilding(false); setNewBuildingName(''); setTargetCampusId(null); setExpandedCampus(targetCampusId); showToast("건물이 추가되었습니다.", "success");
    }).catch(err => showToast("오류가 발생했습니다.", "error"));
  };

  const handleAddRackClick = () => { setNewRackForm({ name: '', location: '', total_u_space: 42 }); setIsAddingRack(true); };
  const handleNewRackChange = (field, value) => setNewRackForm(prev => ({ ...prev, [field]: value }));
  const handleSaveRack = () => {
    if (!newRackForm.name.trim()) { showToast("랙 이름을 입력해주세요.", "error"); return; }
    fetch(`${API_BASE_URL}/api/rack/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newRackForm, building_id: selectedBuilding.id }) })
    .then(res => { if (!res.ok) throw new Error('저장 실패'); return res.json(); })
    .then(savedRack => {
      const newRackData = { ...savedRack, servers: [] };
      const updatedSiteData = siteData.map(c => ({ ...c, buildings: c.buildings?.map(b => {
          if (b.id === selectedBuilding.id) {
            const newRacks = [...(b.racks || []), newRackData];
            if (selectedBuilding.id === b.id) setSelectedBuilding({ ...b, racks: newRacks, campusName: c.name });
            return { ...b, racks: newRacks };
          } return b;
      })}));
      setSiteData(updatedSiteData); setIsAddingRack(false); showToast("새 랙이 추가되었습니다!", "success");
    }).catch(err => showToast("오류가 발생했습니다.", "error"));
  };

  const handleEditClick = () => { setEditForm({ ...selectedServer, specs: { ...(selectedServer.specs || {}) } }); setIsEditing(true); setActivePort(null); };
  
  const handleEmptyUClick = (uSpace) => {
    setEditForm({ 
      id: null, rack: selectedRack.id, start_u: uSpace, size_u: 1, hostname: '', model_name: '', status: 'WAIT', setup_year: new Date().getFullYear().toString(), description: '',
      specs: { 
        asset_type: 'server', cpu: '', ram: '', storage: '', gpu: '', 
        power_w: '', public_lan: '', private_lan: '', public_ip: '', virtual_ip: '', private_ip: '', mgmt_ip: '', serial_number: '',
        l2_switch: '', san_switch: '', bottom_san_switch: '', volume_mount: '', switch_ports: {}, os_version: '' // ⭐️ OS 버전 specs 편입
      } 
    });
    setSelectedServer({ isNew: true }); setIsEditing(true); setActivePort(null);
  };
  
  const handleCancelEdit = () => { setIsEditing(false); setActivePort(null); if (selectedServer?.isNew) setSelectedServer(null); };
  
  const handleFormChange = (e, field, isSpec = false) => {
    const value = e.target.value;
    if (isSpec) setEditForm(prev => ({ ...prev, specs: { ...prev.specs, [field]: value } }));
    else setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handlePortSave = () => {
    if (!activePort) return;
    setEditForm(prev => ({ ...prev, specs: { ...prev.specs, switch_ports: { ...(prev.specs?.switch_ports || {}), [activePort]: portInputValue } } }));
    setActivePort(null); setPortInputValue('');
  };

  // ⭐️ 프리셋 저장 로직 (OS버전도 specs에서 관리)
  const handleSavePreset = () => {
    const pName = editForm.model_name || '';
    if (!pName.trim()) {
      showToast("모델명(Model)을 먼저 입력해야 템플릿으로 저장할 수 있습니다.", "error");
      return;
    }
    const presetData = {
      model_name: editForm.model_name,
      specs: { ...editForm.specs }
    };
    if (presetData.specs) {
      delete presetData.specs.public_ip;
      delete presetData.specs.virtual_ip;
      delete presetData.specs.private_ip;
      delete presetData.specs.mgmt_ip;
      delete presetData.specs.serial_number;
      delete presetData.specs.port_mapping;
      delete presetData.specs.switch_ports;
    }
    const updatedPresets = { ...presets, [pName]: presetData };
    setPresets(updatedPresets);
    localStorage.setItem('itam_presets', JSON.stringify(updatedPresets));
    showToast(`[${pName}] 템플릿이 저장되었습니다.`, "success");
  };

  const handleLoadPreset = (pName) => {
    const template = presets[pName];
    if (!template) return;
    setEditForm(prev => ({
      ...prev,
      model_name: template.model_name || '',
      specs: { ...(prev.specs || {}), ...(template.specs || {}) }
    }));
    showToast(`[${pName}] 템플릿 제원을 불러왔습니다.`, "success");
  };

  const handleDeletePreset = (e, pName) => {
    e.stopPropagation();
    if (!window.confirm(`[${pName}] 템플릿을 삭제하시겠습니까?`)) return;
    const updatedPresets = { ...presets };
    delete updatedPresets[pName];
    setPresets(updatedPresets);
    localStorage.setItem('itam_presets', JSON.stringify(updatedPresets));
    showToast("템플릿이 삭제되었습니다.", "success");
  };

  const handleSave = () => {
    if (!editForm.hostname) { showToast("Hostname은 필수입니다.", "error"); return; }
    
    // ⭐️ 물리적 겹침 방지 (저장 시 검증)
    const validation = validateServerPlacement(editForm.id, editForm.start_u, editForm.size_u);
    if (!validation.valid) {
      showToast(validation.error, "error");
      return;
    }

    const isNew = !editForm.id;
    const url = isNew ? `${API_BASE_URL}/api/server/add/` : `${API_BASE_URL}/api/server/update/${editForm.id}/`;
    
    fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editForm, rack_id: selectedRack.id }) })
    .then(res => { if (!res.ok) throw new Error('저장 실패'); return res.json(); })
    .then(savedData => {
      const completeData = { ...editForm, ...savedData };
      updateLocalState(completeData, isNew);
      showToast(isNew ? "새 장비 실장 완료" : "업데이트 완료", "success");
    }).catch(err => showToast("저장 오류", "error"));
  };

  const handleDelete = () => {
    if(!window.confirm(`[${selectedServer.hostname}] 장비를 영구 삭제하시겠습니까?`)) return;
    fetch(`${API_BASE_URL}/api/server/delete/${selectedServer.id}/`, { method: 'DELETE' })
    .then(res => {
      if(!res.ok) throw new Error("삭제 실패");
      const updatedSiteData = siteData.map(c => ({ 
        ...c, buildings: c.buildings?.map(b => ({ 
          ...b, racks: b.racks?.map(r => {
            if (r.id === selectedRack.id) {
              const newSrv = r.servers.filter(s => s.id !== selectedServer.id);
              return { ...r, servers: newSrv };
            } return r;
        })}))
      }));
      setSiteData(updatedSiteData);
      setSelectedRack(prev => ({ ...prev, servers: prev.servers.filter(s => s.id !== selectedServer.id) }));
      setSelectedServer(null); setIsEditing(false); showToast("장비가 폐기되었습니다.", "success");
    }).catch(err => showToast("삭제 중 오류 발생", "error"));
  };

  const handleDragStart = (e, server) => { e.dataTransfer.setData("serverId", server.id); };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e, targetU) => {
    e.preventDefault();
    const serverId = parseInt(e.dataTransfer.getData("serverId"));
    const serverToMove = selectedRack.servers.find(s => s.id === serverId);
    if (!serverToMove || serverToMove.start_u === targetU) return;
    
    // ⭐️ 물리적 겹침 방지 (드래그 앤 드롭 이동 시 검증)
    const validation = validateServerPlacement(serverId, targetU, serverToMove.size_u);
    if (!validation.valid) {
      showToast(validation.error, "error");
      return; 
    }
    
    const updatedServer = { ...serverToMove, start_u: targetU };
    fetch(`${API_BASE_URL}/api/server/update/${serverToMove.id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedServer) })
    .then(res => {
      if (!res.ok) throw new Error('이동 실패');
      updateLocalState(updatedServer, false); showToast("장비 위치가 이동되었습니다.", "success");
    }).catch(err => showToast("이동 중 오류 발생", "error"));
  };

  const updateLocalState = (savedData, isNew) => {
    const updatedSiteData = siteData.map(c => ({ 
      ...c, buildings: c.buildings?.map(b => ({ 
        ...b, racks: b.racks?.map(r => {
          if (r.id === selectedRack.id) {
            let newSrv = [...r.servers];
            if (isNew) newSrv.push(savedData); else newSrv = newSrv.map(s => s.id === savedData.id ? savedData : s);
            return { ...r, servers: newSrv };
          } return r;
      })}))
    }));
    setSiteData(updatedSiteData); setSelectedServer(savedData);
    setSelectedRack(prev => {
      let newSrv = [...prev.servers]; 
      if (isNew) newSrv.push(savedData); else newSrv = newSrv.map(s => s.id === savedData.id ? savedData : s);
      return { ...prev, servers: newSrv };
    });
    setIsEditing(false);
  };

  const handleCopyRackImage = async () => {
    showToast("실장도 이미지를 캡처 중입니다. 잠시만 기다려주세요...", "success");
    const captureRack = () => {
      const wrapper = document.getElementById('rack-panel-wrapper');
      const scrollArea = document.getElementById('rack-scroll-area');
      if (!wrapper || !scrollArea) return;
      const origOverflow = scrollArea.style.overflow; const origHeight = wrapper.style.height; const origMaxHeight = wrapper.style.maxHeight;
      scrollArea.style.overflow = 'visible'; wrapper.style.height = 'max-content'; wrapper.style.maxHeight = 'none';
      setTimeout(() => {
        window.html2canvas(wrapper, { backgroundColor: '#ffffff', scale: 3 }).then(canvas => {
          scrollArea.style.overflow = origOverflow; wrapper.style.height = origHeight; wrapper.style.maxHeight = origMaxHeight;
          try {
            canvas.toBlob(blob => {
              if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
                const item = new ClipboardItem({ "image/png": blob });
                navigator.clipboard.write([item]).then(() => showToast("이미지가 복사되었습니다! (Ctrl+V)", "success")).catch(() => downloadCanvas(canvas));
              } else downloadCanvas(canvas);
            });
          } catch (e) { downloadCanvas(canvas); }
        }).catch(err => {
           scrollArea.style.overflow = origOverflow; wrapper.style.height = origHeight; wrapper.style.maxHeight = origMaxHeight;
        });
      }, 150);
    };
    const downloadCanvas = (canvas) => {
       const link = document.createElement('a'); link.download = `${selectedRack.name}_실장도.png`; link.href = canvas.toDataURL('image/png'); link.click();
       showToast("보안 정책으로 파일 다운로드 되었습니다.", "success");
    };
    if (!window.html2canvas) {
      const script = document.createElement('script'); script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      script.onload = () => captureRack(); document.body.appendChild(script);
    } else captureRack();
  };

  const handleCopyExcelData = () => {
    const tableDiv = document.getElementById('rack-summary-tables');
    if (!tableDiv) return;
    try {
      const range = document.createRange(); range.selectNode(tableDiv);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('copy'); selection.removeAllRanges();
      showToast("표가 클립보드에 복사되었습니다. (Ctrl+V)", "success");
    } catch (err) { showToast("복사 중 오류가 발생했습니다.", "error"); }
  };

  const openStatusDrillDown = (statusCode) => {
    const list = [];
    siteData.forEach(c => c.buildings?.forEach(b => b.racks?.forEach(r => r.servers?.forEach(s => {
      if (s.status === statusCode) list.push({ ...s, locationPath: `${c.name} > ${b.name} > ${r.name}`, campus: c, building: b, rack: r });
    }))));
    
    setDrillDownPage(1); 
    setStatusModalInfo({ status: statusCode, title: getStatusText(statusCode), servers: list });
  };

  const getStatusColor = (status) => {
    switch(status) { case 'OPER': return 'bg-emerald-50 text-emerald-700 border-emerald-200'; case 'MAINT': return 'bg-red-50 text-red-700 border-red-200'; case 'IDLE': return 'bg-slate-50 text-slate-600 border-slate-200'; case 'WAIT': return 'bg-amber-50 text-amber-700 border-amber-200'; default: return 'bg-slate-50 text-slate-600 border-slate-200'; }
  };
  const getStatusLED = (status) => {
    switch(status) { case 'OPER': return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]'; case 'MAINT': return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse'; case 'IDLE': return 'bg-slate-400'; case 'WAIT': return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]'; default: return 'bg-slate-300'; }
  };
  const getStatusIcon = (status) => {
    switch(status) { case 'OPER': return <Activity size={16} className="mr-1 text-emerald-600" />; case 'MAINT': return <AlertTriangle size={16} className="mr-1 text-red-600" />; case 'IDLE': return <Moon size={16} className="mr-1 text-slate-500" />; default: return <Server size={16} className="mr-1 text-amber-600" />; }
  };
  const getStatusText = (status) => {
    switch(status) { case 'OPER': return '정상 운영'; case 'MAINT': return '장애/점검'; case 'IDLE': return '유휴 자산'; case 'WAIT': return '셋업 대기'; default: return '상태 미상'; }
  };
  const getAssetTypeIcon = (type, size = 16, className = "") => {
    if (type === 'switch') return <Network size={size} className={className} />;
    if (type === 'storage') return <Database size={size} className={className} />;
    return <Server size={size} className={className} />;
  };
  
  const filteredServers = useMemo(() => {
    if (!selectedRack || !searchTerm) return selectedRack?.servers || [];
    const term = searchTerm.toLowerCase();
    return selectedRack.servers.filter(s => (s.hostname && s.hostname.toLowerCase().includes(term)) || (s.specs?.ip && s.specs.ip.includes(term)) || (s.model_name && s.model_name.toLowerCase().includes(term)));
  }, [selectedRack, searchTerm]);

  // ⭐️ 48포트 스위치 렌더링 로직
  const renderSwitchPorts = (portsData, isEditMode = false) => {
    return (
      <div className="bg-[#1f2937] p-5 rounded-xl border border-slate-700 shadow-xl mb-8 w-full">
        <div className="flex justify-between items-center mb-4 px-2">
          <div className="text-slate-400 text-xs font-bold tracking-widest flex items-center"><Network size={16} className="mr-2 text-blue-400" /> 48-PORT NETWORK SWITCH</div>
          <div className="flex gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_4px_#10b981]"></div><div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_4px_#3b82f6]"></div></div>
        </div>
        
        {/* 가로 스크롤 영역을 추가하여 화면이 좁을 때 레이아웃이 깨지지 않게 방어합니다. */}
        <div className="overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
          <div className="grid gap-1 bg-black p-3 rounded-lg border border-slate-800 min-w-[750px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
            
            {/* 상단 포트 (홀수: 1, 3, 5, ..., 47) */}
            {Array.from({length: 24}, (_, i) => i * 2 + 1).map(port => {
              const hasConnection = !!portsData?.[port];
              return (
                <div key={port} onClick={() => { if (isEditMode) { setActivePort(port); setPortInputValue(portsData?.[port] || ''); } else { if (hasConnection) showToast(`포트 ${port}: ${portsData[port]} 연결됨`, "success"); else showToast(`포트 ${port}: 연결 없음`, "error"); } }} 
                  className={`cursor-pointer w-full aspect-square border-2 rounded-sm flex flex-col items-center justify-between py-0.5 sm:py-1 transition-colors relative ${hasConnection ? 'border-emerald-500 bg-slate-800' : 'border-slate-700 bg-slate-900'} hover:bg-slate-700 ${activePort === port ? 'ring-2 ring-blue-400 scale-110 z-10' : ''}`} title={hasConnection ? `Port ${port}: ${portsData[port]}` : `Port ${port}: 비어있음`}>
                   <span className="text-[8px] sm:text-[9px] text-slate-400 font-mono leading-none">{port}</span>
                   <div className="w-full h-1 sm:h-1.5 flex justify-center px-1"><div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${hasConnection ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'bg-slate-700'}`}></div></div>
                   <div className="w-3/4 h-1.5 sm:h-2 bg-black rounded border border-slate-800"></div>
                </div>
              );
            })}
            
            {/* 하단 포트 (짝수: 2, 4, 6, ..., 48) */}
            {Array.from({length: 24}, (_, i) => i * 2 + 2).map(port => {
              const hasConnection = !!portsData?.[port];
              return (
                <div key={port} onClick={() => { if (isEditMode) { setActivePort(port); setPortInputValue(portsData?.[port] || ''); } else { if (hasConnection) showToast(`포트 ${port}: ${portsData[port]} 연결됨`, "success"); else showToast(`포트 ${port}: 연결 없음`, "error"); } }} 
                  className={`cursor-pointer w-full aspect-square border-2 rounded-sm flex flex-col items-center justify-between py-0.5 sm:py-1 transition-colors relative ${hasConnection ? 'border-emerald-500 bg-slate-800' : 'border-slate-700 bg-slate-900'} hover:bg-slate-700 ${activePort === port ? 'ring-2 ring-blue-400 scale-110 z-10' : ''}`} title={hasConnection ? `Port ${port}: ${portsData[port]}` : `Port ${port}: 비어있음`}>
                   <span className="text-[8px] sm:text-[9px] text-slate-400 font-mono leading-none">{port}</span>
                   <div className="w-full h-1 sm:h-1.5 flex justify-center px-1"><div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${hasConnection ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'bg-slate-700'}`}></div></div>
                   <div className="w-3/4 h-1.5 sm:h-2 bg-black rounded border border-slate-800"></div>
                </div>
              );
            })}
          </div>
        </div>

        {isEditMode && activePort && (
          <div className="mt-4 p-3 bg-slate-800 rounded flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <span className="text-blue-400 font-bold font-mono bg-blue-900/50 px-2 py-1 rounded border border-blue-800">PORT {activePort}</span>
            <input type="text" value={portInputValue} onChange={(e) => setPortInputValue(e.target.value)} placeholder="연결된 장비명 입력 (예: RDK-DAQ-MAIN-S)" className="flex-1 bg-slate-900 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:border-blue-500 outline-none font-mono shadow-inner" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handlePortSave(); }} />
            <button onClick={handlePortSave} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">매핑 저장</button>
            <button onClick={() => setActivePort(null)} className="text-slate-400 hover:text-white px-2 transition-colors font-medium">취소</button>
          </div>
        )}
      </div>
    );
  };

  // ⭐️ 로그인 화면 (인증되지 않았을 때만 렌더링)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-600/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl"></div>
        
        <div className="bg-slate-800 border border-slate-700 p-10 rounded-2xl shadow-2xl w-full max-w-md relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-700 mb-4 shadow-inner">
              <Server size={32} className="text-blue-500" />
            </div>
            <h1 className="text-3xl font-black text-white tracking-wider">
              <span className="text-orange-500">MIRERO</span> ITAM
            </h1>
            <p className="text-slate-400 text-sm mt-2 font-medium tracking-wide">IT Asset Management System</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Username</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon size={18} className="text-slate-500" />
                </div>
                <input type="text" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="관리자 아이디" required />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className="text-slate-500" />
                </div>
                <input type="password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="비밀번호" required />
              </div>
            </div>
            
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-3 rounded-lg flex items-center font-bold">
                <AlertTriangle size={16} className="mr-2 shrink-0" />
                {loginError}
              </div>
            )}

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-lg shadow-lg hover:shadow-blue-600/20 transition-all flex items-center justify-center group mt-4">
              시스템 로그인 <ArrowRight size={18} className="ml-2 opacity-70 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans relative">
      <datalist id="model-list">{existingSpecs.models.map((m,i) => <option key={i} value={m}/>)}</datalist>
      <datalist id="cpu-list">{existingSpecs.cpus.map((c,i) => <option key={i} value={c}/>)}</datalist>
      <datalist id="ram-list">{existingSpecs.rams.map((r,i) => <option key={i} value={r}/>)}</datalist>
      <datalist id="gpu-list">{existingSpecs.gpus.map((g,i) => <option key={i} value={g}/>)}</datalist>

      {/* UX Toast Component */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-5 py-3.5 rounded-lg shadow-xl font-medium text-sm flex items-center animate-in slide-in-from-bottom-5 z-[100] border ${toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-800 text-white border-slate-700'}`}>
          {toast.type === 'error' ? <AlertTriangle size={18} className="mr-2" /> : <CheckCircle size={18} className="mr-2 text-emerald-400" />} {toast.message}
        </div>
      )}

      {/* Sidebar Navigation */}
      <div className="w-72 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-10 shrink-0">
        <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="cursor-pointer hover:bg-slate-900 transition-colors flex-1" onClick={goHome} title="처음 화면으로">
            <h1 className="text-xl font-bold text-white tracking-wider flex items-center"><span className="text-orange-500 mr-1">MIRERO</span> ITAM</h1>
            <p className="text-xs text-slate-500 mt-1">Asset Management</p>
          </div>
          <button onClick={handleLogout} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-red-400 transition-colors group" title="로그아웃">
            <LogOut size={20} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-3 px-2 uppercase tracking-widest flex justify-between items-center group">
            <span>Site Topology</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setIsAddingCampus(true)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="새 캠퍼스/사이트 추가"><Plus size={14}/></button>
              <button onClick={fetchSiteData} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="새로고침"><RefreshCw size={14} className={loading ? 'animate-spin text-blue-400' : ''} /> </button>
            </div>
          </div>

          {isAddingCampus && (
            <div className="mb-2 p-2 bg-slate-800 rounded flex gap-2 animate-in fade-in slide-in-from-top-2">
              <input type="text" value={newCampusName} onChange={(e)=>setNewCampusName(e.target.value)} placeholder="캠퍼스 이름" className="flex-1 bg-slate-900 text-white text-sm px-2 py-1 rounded outline-none border border-slate-700" autoFocus onKeyDown={(e) => { if(e.key==='Enter') handleSaveCampus(); }}/>
              <button onClick={handleSaveCampus} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={16}/></button>
              <button onClick={() => { setIsAddingCampus(false); setNewCampusName(''); }} className="text-slate-500 hover:text-slate-300"><X size={16}/></button>
            </div>
          )}

          {loading ? <div className="text-center p-4 text-slate-500 text-sm animate-pulse">데이터 동기화 중...</div> : siteData.length === 0 ? <div className="text-center p-4 text-slate-500 text-sm">등록된 사이트가 없습니다.</div> : siteData.map(campus => (
            <div key={campus.id} className="mb-1">
              <div className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-800 transition-colors group">
                <button onClick={() => handleCampusClick(campus.id)} className="flex-1 flex items-center text-left">
                  {expandedCampus === campus.id ? <FolderOpen size={18} className="text-blue-400 mr-2 shrink-0" /> : <Folder size={18} className="text-slate-500 mr-2 shrink-0" />}
                  <span className={`truncate ${expandedCampus === campus.id ? 'text-white font-medium' : ''}`}>{campus.name}</span>
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setTargetCampusId(campus.id); setIsAddingBuilding(true); setExpandedCampus(campus.id); }} className="text-slate-400 hover:text-white p-0.5 rounded"><Plus size={14}/></button>
                  {campus.buildings && campus.buildings.length > 0 && <ChevronRight size={14} className={`transition-transform ${expandedCampus === campus.id ? 'rotate-90 text-slate-400' : 'text-slate-600'}`} onClick={() => handleCampusClick(campus.id)} />}
                </div>
              </div>
              
              {expandedCampus === campus.id && (
                <div className="ml-6 mt-1 border-l border-slate-700 pl-2">
                  {isAddingBuilding && targetCampusId === campus.id && (
                    <div className="mb-1 p-1 bg-slate-800 rounded flex gap-1 animate-in fade-in slide-in-from-top-2">
                      <input type="text" value={newBuildingName} onChange={(e)=>setNewBuildingName(e.target.value)} placeholder="건물 이름" className="flex-1 w-full bg-slate-900 text-white text-xs px-2 py-1 rounded outline-none border border-slate-700" autoFocus onKeyDown={(e) => { if(e.key==='Enter') handleSaveBuilding(); }}/>
                      <button onClick={handleSaveBuilding} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={14}/></button>
                      <button onClick={() => { setIsAddingBuilding(false); setNewBuildingName(''); setTargetCampusId(null); }} className="text-slate-500 hover:text-slate-300"><X size={14}/></button>
                    </div>
                  )}

                  {campus.buildings?.map(building => (
                    <button key={building.id} onClick={() => handleBuildingClick(building, campus)} className={`w-full flex items-center p-2 rounded mb-1 transition-colors ${selectedBuilding?.id === building.id ? 'bg-blue-600/20 text-blue-400 font-medium' : 'hover:bg-slate-800 text-sm'}`}>
                      <Building size={14} className="mr-2 opacity-70 shrink-0" />
                      <span className="truncate">{building.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10 shrink-0">
          <div className="flex items-center text-sm font-medium text-slate-500 flex-1">
            <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={goHome}>사이트 현황</span>
            {selectedBuilding && (
              <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => { setSelectedBuilding(null); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); }}>{selectedBuilding.campusName}</span><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-blue-600 cursor-pointer hover:underline" onClick={() => handleBuildingClick(selectedBuilding, {name: selectedBuilding.campusName})}>{selectedBuilding.name}</span></>
            )}
            {selectedRack && (
              <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-slate-800 font-bold cursor-pointer hover:text-blue-600 hover:underline" onClick={handleRackNameClick}>{selectedRack.name}</span></>
            )}
          </div>
          <div className="flex-1 max-w-lg mx-4 relative z-50">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Search size={16} className={searchTerm ? 'text-blue-500' : 'text-slate-400'} /></div>
            <input type="text" placeholder="전체 자산 검색 (Hostname, IP, 모델명 입력)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-100 border border-slate-200 rounded-full py-2 pl-11 pr-4 text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner" />
            {searchTerm && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[400px] overflow-y-auto animate-in fade-in">
                {globalSearchResults.length > 0 ? (
                  <div className="py-2"><div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase">검색 결과</div>
                    {globalSearchResults.map((res, idx) => (
                      <div key={idx} onClick={() => handleGlobalSearchSelect(res)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 flex flex-col gap-1">
                        <div className="flex justify-between items-center"><span className="font-bold text-blue-700 font-mono text-sm">{res.server.hostname}</span><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-500 border border-slate-200">{res.server.specs?.ip || 'IP 없음'}</span></div>
                        <div className="flex justify-between items-end"><span className="text-xs text-slate-500">{res.server.model_name}</span><div className="text-[10px] font-medium text-slate-400 flex items-center"><MapPin size={10} className="mr-1" />{res.building.name} &gt; {res.rack.name} ({res.server.start_u}U)</div></div>
                      </div>
                    ))}
                  </div>
                ) : <div className="p-6 text-center text-slate-500 flex flex-col items-center"><AlertTriangle size={24} className="text-slate-300 mb-2" /><p className="text-sm">검색 결과가 없습니다.</p></div>}
              </div>
            )}
          </div>
          {apiError && <div className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-full font-medium flex items-center"><AlertTriangle size={12} className="mr-1"/> {apiError}</div>}
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 flex relative z-0">
          
          {!selectedBuilding ? (
            <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-300 max-w-7xl mx-auto w-full">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
                    <span className="text-orange-500">MIRERO</span> 전체 INFRA 현황 DASHBOARD
                  </h2>
                  <p className="text-slate-500 text-sm mt-1">전사 IT 자산 및 랙(Rack) 실장 상태를 한눈에 모니터링합니다.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                  <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><Server size={16} className="mr-1.5 text-blue-500"/> 전체 등록 서버</h3>
                  <div className="flex items-baseline gap-2"><span className="text-4xl font-black text-slate-800">{dashboardStats.totalServers}</span><span className="text-sm font-medium text-slate-500">대</span></div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                  <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><CheckCircle size={16} className="mr-1.5 text-emerald-500"/> 정상 가동률</h3>
                  <div className="flex items-baseline gap-2"><span className="text-4xl font-black text-slate-800">{dashboardStats.operRate}</span><span className="text-sm font-medium text-slate-500">%</span></div>
                  <div className="mt-3 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div className="bg-emerald-500 h-full" style={{ width: `${dashboardStats.operRate}%` }}></div></div>
                </div>
                
                <div onClick={() => dashboardStats.waitCount > 0 && openStatusDrillDown('WAIT')} className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group transition-all ${dashboardStats.waitCount > 0 ? 'cursor-pointer hover:border-amber-300 hover:shadow-md' : ''}`}>
                  <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><Clock size={16} className="mr-1.5 text-amber-500"/> 셋업 대기 자산</h3>
                  <div className="flex items-baseline gap-2"><span className={`text-4xl font-black ${dashboardStats.waitCount > 0 ? 'text-amber-500 group-hover:text-amber-600' : 'text-slate-800'}`}>{dashboardStats.waitCount}</span><span className="text-sm font-medium text-slate-500">건</span></div>
                  {dashboardStats.waitCount > 0 && <div className="mt-2 text-xs font-bold text-amber-600 bg-amber-50 inline-block px-2 py-1 rounded">셋업이 필요합니다. (클릭하여 확인)</div>}
                </div>

                <div onClick={() => dashboardStats.maintCount > 0 && openStatusDrillDown('MAINT')} className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group transition-all ${dashboardStats.maintCount > 0 ? 'cursor-pointer hover:border-red-300 hover:shadow-md' : ''}`}>
                  <h3 className="text-slate-500 text-sm font-bold mb-1 flex items-center"><AlertTriangle size={16} className="mr-1.5 text-red-500"/> 장애 / 점검 대상</h3>
                  <div className="flex items-baseline gap-2"><span className={`text-4xl font-black ${dashboardStats.maintCount > 0 ? 'text-red-600 group-hover:text-red-700' : 'text-slate-800'}`}>{dashboardStats.maintCount}</span><span className="text-sm font-medium text-slate-500">건</span></div>
                  {dashboardStats.maintCount > 0 && <div className="mt-2 text-xs font-bold text-red-500 bg-red-50 inline-block px-2 py-1 rounded">조치가 필요합니다. (클릭하여 확인)</div>}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 col-span-1 flex flex-col">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center"><Info size={18} className="mr-2 text-blue-500" /> 자산 운영 상태 분포</h3>
                  <div className="w-full h-8 flex rounded-lg overflow-hidden mb-6 bg-slate-100 border shadow-inner">
                    {dashboardStats.totalServers > 0 && (
                      <>
                        <div className="bg-emerald-500 h-full" style={{ width: `${(dashboardStats.operCount / dashboardStats.totalServers) * 100}%` }}></div>
                        <div className="bg-red-500 h-full" style={{ width: `${(dashboardStats.maintCount / dashboardStats.totalServers) * 100}%` }}></div>
                        <div className="bg-slate-400 h-full" style={{ width: `${(dashboardStats.idleCount / dashboardStats.totalServers) * 100}%` }}></div>
                        <div className="bg-amber-400 h-full" style={{ width: `${(dashboardStats.waitCount / dashboardStats.totalServers) * 100}%` }}></div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col flex-1 justify-center">
                    <div onClick={() => dashboardStats.operCount > 0 && openStatusDrillDown('OPER')} className={`flex justify-between items-center py-2 px-2 rounded-lg transition-colors ${dashboardStats.operCount > 0 ? 'cursor-pointer hover:bg-emerald-50' : ''}`}>
                      <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-emerald-500 mr-2 shadow-[0_0_5px_#10b981]"></div><span className="text-sm font-bold text-slate-700">정상 운영 (OPER)</span></div>
                      <span className="font-bold text-slate-800 group-hover:text-emerald-700">{dashboardStats.operCount} 대</span>
                    </div>
                    <div onClick={() => dashboardStats.maintCount > 0 && openStatusDrillDown('MAINT')} className={`flex justify-between items-center py-2 px-2 rounded-lg transition-colors ${dashboardStats.maintCount > 0 ? 'cursor-pointer hover:bg-red-50' : ''}`}>
                      <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-500 mr-2 shadow-[0_0_5px_#ef4444]"></div><span className="text-sm font-bold text-slate-700">장애/점검 (MAINT)</span></div>
                      <span className="font-bold text-slate-800">{dashboardStats.maintCount} 대</span>
                    </div>
                    <div onClick={() => dashboardStats.idleCount > 0 && openStatusDrillDown('IDLE')} className={`flex justify-between items-center py-2 px-2 rounded-lg transition-colors ${dashboardStats.idleCount > 0 ? 'cursor-pointer hover:bg-slate-100' : ''}`}>
                      <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-slate-400 mr-2"></div><span className="text-sm font-bold text-slate-700">유휴 자산 (IDLE)</span></div>
                      <span className="font-bold text-slate-800">{dashboardStats.idleCount} 대</span>
                    </div>
                    <div onClick={() => dashboardStats.waitCount > 0 && openStatusDrillDown('WAIT')} className={`flex justify-between items-center py-2 px-2 rounded-lg transition-colors ${dashboardStats.waitCount > 0 ? 'cursor-pointer hover:bg-amber-50' : ''}`}>
                      <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-amber-400 mr-2 shadow-[0_0_5px_#fbbf24]"></div><span className="text-sm font-bold text-slate-700">셋업 대기 (WAIT)</span></div>
                      <span className="font-bold text-slate-800">{dashboardStats.waitCount} 대</span>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-0 col-span-1 lg:col-span-2 flex flex-col overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"><h3 className="text-lg font-bold text-slate-800 flex items-center"><AlertTriangle size={18} className="mr-2 text-red-500" /> 집중 관리 대상 (장애/수리 요망)</h3><span className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-full font-bold shadow-sm">{dashboardStats.maintList.length}건 발생</span></div>
                  <div className="flex-1 overflow-y-auto p-4 max-h-[300px] bg-slate-50/30">
                    {dashboardStats.maintList.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 py-8"><CheckCircle size={48} className="text-emerald-200 mb-3" /><p className="font-bold text-emerald-600">현재 장애가 없습니다.</p></div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {dashboardStats.maintList.map(server => (
                          <div key={server.id} className="bg-white border border-red-100 p-4 rounded-xl shadow-sm flex items-start cursor-pointer hover:bg-red-50/20" onClick={() => handleGlobalSearchSelect({ campus: server.campus, building: server.building, rack: server.rack, server })}>
                            <div className="p-2 bg-red-50 rounded-lg mr-4 mt-0.5 shadow-inner"><AlertTriangle size={20} className="text-red-500" /></div>
                            <div className="flex-1"><div className="flex justify-between items-center"><h4 className="font-bold text-slate-800 font-mono text-sm">{server.hostname}</h4><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-mono border">{server.specs?.ip}</span></div><p className="text-xs text-slate-500 mt-1 flex items-center font-medium"><MapPin size={12} className="mr-1 opacity-70" /> {server.locationPath}</p><div className="mt-2 pt-2 border-t border-slate-50 text-sm text-red-700 font-medium"><span className="text-xs font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded mr-1">사유</span>{server.description || '내용 없음'}</div></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : !selectedRack ? (
            <div className="flex-1 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold text-slate-800 flex items-center"><MapPin className="mr-2 text-blue-500" /> {selectedBuilding.name} 랙(Rack) 구성도</h2></div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {selectedBuilding.racks && selectedBuilding.racks.map(rack => (
                  <div key={rack.id} onClick={() => handleRackClick(rack)} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-400 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 rounded-xl group-hover:bg-blue-100 transition-colors"><Server size={24} className="text-blue-600" /></div><span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm">{rack.total_u_space}U</span></div>
                    <h3 className="text-lg font-bold text-slate-800">{rack.name}</h3>
                    <p className="text-sm text-slate-500 mt-1 flex items-center"><MapPin size={14} className="mr-1 opacity-70"/> {rack.location || '위치 미지정'}</p>
                    <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center text-sm"><span className="text-slate-500 font-medium">실장 장비</span><span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{rack.servers ? rack.servers.length : 0}대</span></div>
                  </div>
                ))}
                <div onClick={handleAddRackClick} className="bg-slate-50 p-5 rounded-2xl border-2 border-dashed border-slate-300 shadow-sm hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[160px] text-slate-500 group">
                  <div className="p-3 bg-white rounded-full mb-3 shadow-sm group-hover:bg-blue-100 transition-colors"><Plus size={24} className="text-slate-400 group-hover:text-blue-600" /></div>
                  <span className="font-bold">새 랙(Rack) 추가</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col lg:flex-row gap-6 h-full overflow-hidden animate-in fade-in duration-300">
              
              <div id="rack-panel-wrapper" className="w-full lg:w-96 flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden shrink-0">
                <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0 border-b-4 border-blue-500">
                  <div className="flex items-center cursor-pointer hover:text-blue-300 transition-colors group" onClick={handleRackNameClick} title="랙 자산 명세서 화면으로 돌아가기">
                    <AlignJustify size={18} className="mr-2 opacity-80 group-hover:opacity-100"/>
                    <h3 className="font-bold tracking-wide">{selectedRack.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleCopyRackImage} className="bg-slate-700 hover:bg-blue-600 text-slate-200 hover:text-white p-1.5 rounded transition-colors" title="실장도 고해상도 그림 캡처 및 복사"><Copy size={16} /></button>
                    <span className="text-xs bg-slate-700 px-2.5 py-1 rounded font-bold border border-slate-600">{selectedRack.total_u_space || 42}U</span>
                  </div>
                </div>

                <div id="rack-scroll-area" className="flex-1 overflow-y-auto p-4 bg-slate-100 flex justify-center relative">
                  {/* ⭐️ 디자인은 유지하면서, 1U 짤림 및 캡처 버그 원천 차단 구조 개편 */}
                  <div className="w-full max-w-[280px] bg-slate-800 rounded-t-xl border-x-[12px] border-t-[12px] border-b-[24px] border-slate-700 shadow-2xl relative box-content shrink-0" style={{height: `${(selectedRack.total_u_space || 42) * 20}px`}}>
                    
                    {Array.from({length: selectedRack.total_u_space || 42}, (_, i) => (selectedRack.total_u_space || 42) - i).map(u => (
                      <div key={u} onClick={() => handleEmptyUClick(u)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, u)} className="h-[20px] w-full border-b border-slate-700/50 flex items-center px-1 absolute cursor-pointer hover:bg-blue-900/40 group transition-colors box-border" style={{top: `${((selectedRack.total_u_space || 42) - u) * 20}px`}} title={`U${u} 위치에 새 장비 실장하기`}>
                        <span className="text-[9px] text-slate-500 font-mono w-5 shrink-0 select-none text-right pr-1 leading-none">{u}</span>
                        <div className="hidden group-hover:flex items-center text-[10px] text-blue-400 font-bold ml-1"><Plus size={12} className="mr-0.5" /> 배치/실장</div>
                      </div>
                    ))}

                    {filteredServers.map(server => {
                      if (!server.start_u) return null;
                      const totalU = selectedRack.total_u_space || 42;
                      const term = searchTerm.toLowerCase();
                      const isMatch = !term || (server.hostname && server.hostname.toLowerCase().includes(term)) || (server.model_name && server.model_name.toLowerCase().includes(term)) || (server.specs?.ip && server.specs.ip.includes(term));
                      return (
                        <div key={server.id} onClick={() => handleServerClick(server)} draggable="true" onDragStart={(e) => handleDragStart(e, server)} 
                          onDragOver={handleDragOver} onDrop={(e) => { e.stopPropagation(); handleDrop(e, server.start_u); }}
                          className={`absolute left-7 right-1 rounded-[3px] border flex items-center px-1.5 cursor-pointer transition-all hover:brightness-110 shadow-md overflow-hidden bg-gradient-to-r from-slate-100 to-white box-border ${server.status === 'OPER' ? 'border-l-4 border-l-emerald-500 border-y-slate-300 border-r-slate-300 text-slate-800' : ''} ${server.status === 'MAINT' ? 'border-l-4 border-l-red-500 border-y-red-200 border-r-red-200 text-red-900 bg-red-50' : ''} ${server.status === 'IDLE' ? 'border-l-4 border-l-slate-400 border-y-slate-300 border-r-slate-300 text-slate-600' : ''} ${server.status === 'WAIT' ? 'border-l-4 border-l-amber-400 border-y-amber-200 border-r-amber-200 text-amber-900 bg-amber-50' : ''} ${selectedServer?.id === server.id ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-800 z-20 scale-[1.02]' : 'z-10'} ${!isMatch && searchTerm ? 'opacity-20 grayscale' : 'opacity-100'}`} 
                          style={{ top: `${(totalU - server.start_u - server.size_u + 1) * 20}px`, height: `${server.size_u * 20}px` }}>
                          
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-20 cursor-grab active:cursor-grabbing"><div className="w-1 h-1 rounded-full bg-black"></div><div className="w-1 h-1 rounded-full bg-black"></div><div className="w-1 h-1 rounded-full bg-black"></div></div>
                          <div className="flex items-center w-full min-w-0 pr-3 z-10">
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${getStatusLED(server.status)}`} />
                            {getAssetTypeIcon(server.specs?.asset_type, 12, "mr-1 opacity-70 shrink-0 text-slate-500")}
                            <span className={`font-mono font-bold truncate flex-1 leading-none mt-[1px] text-slate-700 tracking-tight ${server.size_u === 1 ? 'text-[10px]' : 'text-xs'}`}>{server.hostname || server.model_name}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto p-6 xl:p-8 relative">
                {!selectedServer && !isEditing ? (
                  <div className="h-full animate-in fade-in duration-300 flex flex-col">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4 shrink-0">
                      <h2 className="text-xl font-bold text-slate-800 flex items-center"><List className="text-blue-500 mr-2" size={20} /> 랙 자산 및 자원 할당 명세서</h2>
                      <div className="flex items-center gap-2">
                        <button onClick={handleCopyExcelData} className="px-3 py-1.5 flex items-center bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold transition-colors shadow-sm" title="표 내용을 복사하여 엑셀에 붙여넣기"><Copy size={14} className="mr-1.5" /> 엑셀 표 통째로 복사</button>
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full shadow-inner border border-slate-200">총 실장 장비: {selectedRack.servers?.length || 0}대</span>
                      </div>
                    </div>

                    {selectedRack.servers?.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                        <Server size={48} className="mb-4 opacity-20 text-blue-500" />
                        <p className="text-lg font-bold text-slate-600">이 랙은 비어 있습니다.</p>
                        <p className="text-sm mt-2">좌측 랙 실장도에서 U번호(숫자)를 클릭하여 장비를 배치하세요.</p>
                      </div>
                    ) : (
                      <div className="overflow-y-auto pr-2 pb-8 flex-1">
                        <div id="rack-summary-tables" className="bg-white">
                          <div className="grid grid-cols-2 gap-4 mb-8">
                            
                            <div>
                              <h3 className="font-bold text-slate-700 mb-1.5 flex items-center text-xs"><Zap size={14} className="mr-1 text-amber-500" /> 전기 (Power) 합계</h3>
                              <table className="w-full border-collapse border border-slate-300 text-[10px] text-center">
                                <thead>
                                  <tr className="bg-[#ddebf7] text-slate-800 border-b border-slate-300">
                                    <th className="border-r border-slate-300 p-1 w-12 font-bold">구분</th><th className="border-r border-slate-300 p-1 text-left pl-2 font-bold">항목 (Model)</th><th className="border-r border-slate-300 p-1 w-12 font-bold">전력(W)</th><th className="border-r border-slate-300 p-1 w-10 font-bold">서버수</th><th className="border-r border-slate-300 p-1 w-14 font-bold">합계(W)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {summaryStats.power.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                      {idx === 0 && <td rowSpan={summaryStats.power.length} className="border border-slate-300 font-bold text-red-600 bg-white shadow-inner">전기</td>}
                                      <td className="border border-slate-300 p-1 text-left pl-2 text-slate-700">{item.model_name}</td><td className="border border-slate-300 p-1 text-slate-600 font-mono">{item.power_w}W</td><td className="border border-slate-300 p-1 font-bold">{item.count}</td><td className="border border-slate-300 p-1 font-bold bg-slate-50 font-mono">{item.power_w * item.count}W</td>
                                    </tr>
                                  ))}
                                  <tr className="bg-slate-100 font-bold"><td colSpan={4} className="border border-slate-300 p-1 text-right pr-3">총 합계</td><td className="border border-slate-300 p-1 text-red-600 font-black font-mono">{summaryStats.power.reduce((sum, item) => sum + (item.power_w * item.count), 0)}W</td></tr>
                                </tbody>
                              </table>
                            </div>

                            <div>
                              <h3 className="font-bold text-slate-700 mb-1.5 flex items-center text-xs"><Network size={14} className="mr-1 text-blue-500" /> Public LAN 할당</h3>
                              <table className="w-full border-collapse border border-slate-300 text-[10px] text-center">
                                <thead>
                                  <tr className="bg-[#ddebf7] text-slate-800 border-b border-slate-300">
                                    <th className="border-r border-slate-300 p-1 w-16 font-bold">구분</th><th className="border-r border-slate-300 p-1 text-left pl-2 font-bold">항목 (Model)</th><th className="border-r border-slate-300 p-1 w-12 font-bold">LAN(포트)</th><th className="border-r border-slate-300 p-1 w-10 font-bold">서버수</th><th className="border-r border-slate-300 p-1 w-14 font-bold">합계(포트)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {summaryStats.pubLan.map((item, idx, arr) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                      {idx === 0 && <td rowSpan={arr.length} className="border border-slate-300 font-bold text-red-600 bg-white">Pub LAN</td>}
                                      <td className="border border-slate-300 p-1 text-left pl-2 text-slate-700">{item.model_name}</td><td className="border border-slate-300 p-1 text-slate-600 font-mono">{item.pub_lan}ea</td><td className="border border-slate-300 p-1 font-bold">{item.count}</td><td className="border border-slate-300 p-1 font-bold bg-slate-50 font-mono">{item.pub_lan * item.count}ea</td>
                                    </tr>
                                  ))}
                                  {summaryStats.pubLan.length > 0 ? (
                                    <tr className="bg-slate-100 font-bold"><td colSpan={4} className="border border-slate-300 p-1 text-right pr-3">총 합계</td><td className="border border-slate-300 p-1 text-blue-700 font-black font-mono">{summaryStats.pubLan.reduce((sum, item) => sum + (item.pub_lan * item.count), 0)}ea</td></tr>
                                  ) : <tr><td colSpan={5} className="border border-slate-300 p-2 text-slate-400">할당된 내역이 없습니다.</td></tr>}
                                </tbody>
                              </table>
                            </div>

                            <div>
                              <h3 className="font-bold text-slate-700 mb-1.5 flex items-center text-xs"><Key size={14} className="mr-1 text-emerald-500" /> IP 할당 현황</h3>
                              <table className="w-full border-collapse border border-slate-300 text-[10px] text-center">
                                <thead>
                                  <tr className="bg-[#ddebf7] text-slate-800 border-b border-slate-300">
                                    <th className="border-r border-slate-300 p-1 w-16 font-bold">구분</th><th className="border-r border-slate-300 p-1 text-left pl-2 font-bold">항목 (Model)</th><th className="border-r border-slate-300 p-1 w-14 font-bold">할당 IP 총계</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Public IP */}
                                  {summaryStats.ip.filter(item => item.pub_ip_count > 0).map((item, idx, arr) => (
                                    <tr key={`pubip-${idx}`} className="hover:bg-slate-50">
                                      {idx === 0 && <td rowSpan={arr.length} className="border border-slate-300 font-bold text-red-600 bg-white">Public IP</td>}
                                      <td className="border border-slate-300 p-1 text-left pl-2 text-slate-700">{item.model_name} <span className="text-[9px] text-slate-400 tracking-tighter">({item.power_w}W)</span></td><td className="border border-slate-300 p-1 font-bold font-mono">{item.pub_ip_count}ea</td>
                                    </tr>
                                  ))}
                                  {/* Virtual IP */}
                                  {summaryStats.ip.filter(item => item.vip_count > 0).map((item, idx, arr) => (
                                    <tr key={`vip-${idx}`} className="hover:bg-slate-50">
                                      {idx === 0 && <td rowSpan={arr.length} className="border border-slate-300 font-bold text-red-600 bg-white">Virtual IP</td>}
                                      <td className="border border-slate-300 p-1 text-left pl-2 text-slate-700">{item.model_name} <span className="text-[9px] text-slate-400 tracking-tighter">({item.power_w}W)</span></td><td className="border border-slate-300 p-1 font-bold font-mono">{item.vip_count}ea</td>
                                    </tr>
                                  ))}
                                  {summaryStats.ip.filter(item => item.pub_ip_count > 0 || item.vip_count > 0).length === 0 && <tr><td colSpan={3} className="border border-slate-300 p-2 text-slate-400">할당된 특수 IP 내역이 없습니다.</td></tr>}
                                  
                                  {summaryStats.ip.filter(item => item.pub_ip_count > 0 || item.vip_count > 0).length > 0 && (
                                    <tr className="bg-slate-100 font-bold">
                                      <td colSpan={2} className="border border-slate-300 p-1 text-right pr-3">총 합계</td>
                                      <td className="border border-slate-300 p-1 text-emerald-600 font-black font-mono">{summaryStats.ip.reduce((sum, item) => sum + item.pub_ip_count + item.vip_count, 0)}ea</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <div>
                              <h3 className="font-bold text-slate-700 mb-1.5 flex items-center text-xs"><Network size={14} className="mr-1 text-slate-500" /> Private LAN 할당</h3>
                              <table className="w-full border-collapse border border-slate-300 text-[10px] text-center">
                                <thead>
                                  <tr className="bg-[#ddebf7] text-slate-800 border-b border-slate-300">
                                    <th className="border-r border-slate-300 p-1 w-16 font-bold">구분</th><th className="border-r border-slate-300 p-1 text-left pl-2 font-bold">항목 (Model)</th><th className="border-r border-slate-300 p-1 w-12 font-bold">LAN(포트)</th><th className="border-r border-slate-300 p-1 w-10 font-bold">서버수</th><th className="border-r border-slate-300 p-1 w-14 font-bold">합계(포트)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {summaryStats.privLan.map((item, idx, arr) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                      {idx === 0 && <td rowSpan={arr.length} className="border border-slate-300 font-bold text-red-600 bg-white">Priv LAN</td>}
                                      <td className="border border-slate-300 p-1 text-left pl-2 text-slate-700">{item.model_name}</td><td className="border border-slate-300 p-1 text-slate-600 font-mono">{item.priv_lan}ea</td><td className="border border-slate-300 p-1 font-bold">{item.count}</td><td className="border border-slate-300 p-1 font-bold bg-slate-50 font-mono">{item.priv_lan * item.count}ea</td>
                                    </tr>
                                  ))}
                                  {summaryStats.privLan.length > 0 ? (
                                    <tr className="bg-slate-100 font-bold"><td colSpan={4} className="border border-slate-300 p-1 text-right pr-3">총 합계</td><td className="border border-slate-300 p-1 text-blue-700 font-black font-mono">{summaryStats.privLan.reduce((sum, item) => sum + (item.priv_lan * item.count), 0)}ea</td></tr>
                                  ) : <tr><td colSpan={5} className="border border-slate-300 p-2 text-slate-400">할당된 내역이 없습니다.</td></tr>}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <h3 className="font-bold text-slate-800 mb-2 flex items-center text-sm"><HardDrive size={16} className="mr-1.5 text-blue-600" /> 상세 랙 실장도 목록</h3>
                          <div className="rounded-lg overflow-hidden border border-slate-300 shadow-sm">
                            <table className="w-full border-collapse text-[10px] text-center bg-white">
                              <thead>
                                <tr className="bg-[#ddebf7] text-slate-800 border-b border-slate-300">
                                  <th className="border-r border-slate-300 py-1.5 w-8 font-bold">No</th><th className="border-r border-slate-300 py-1.5 w-32 font-bold">Product</th><th className="border-r border-slate-300 py-1.5 font-bold">HOST</th><th className="border-r border-slate-300 py-1.5 w-12 font-bold">전기(W)</th><th className="border-r border-slate-300 py-1.5 w-12 font-bold">전류(A)</th><th className="border-r border-slate-300 py-1.5 w-10 font-bold">LAN</th><th className="border-r border-slate-300 py-1.5 w-10 font-bold">P.IP</th><th className="border-r border-slate-300 py-1.5 w-10 font-bold">V.IP</th><th className="py-1.5 w-12 font-bold">Private</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rackTableRows.map(row => (
                                  <tr key={`u-${row.u}`} className="hover:bg-slate-50 border-b border-slate-300 last:border-0">
                                    <td className="border-r border-slate-300 p-1.5 font-mono text-slate-600 bg-slate-50/50">{row.u}</td>
                                    {row.isServer ? (
                                      row.isTopU ? (
                                        <>
                                          <td className="border-r border-slate-300 p-1.5 font-medium truncate max-w-[120px]" rowSpan={row.rowSpan}>{row.server.model_name || '-'}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-bold text-slate-700 truncate max-w-[150px]" rowSpan={row.rowSpan}>{row.server.hostname || '-'}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-mono" rowSpan={row.rowSpan}>{row.server.specs?.power_w ? `${row.server.specs.power_w}W` : ''}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-mono text-slate-700" rowSpan={row.rowSpan}>{row.server.specs?.power_w ? `${(Number(row.server.specs.power_w) / 220).toFixed(2)}A` : ''}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-mono" rowSpan={row.rowSpan}>{row.server.specs?.public_lan || ''}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-mono text-red-600 font-bold" rowSpan={row.rowSpan}>{row.server.specs?.public_ip ? row.server.specs.public_ip.split(',').length : ''}</td>
                                          <td className="border-r border-slate-300 p-1.5 font-mono text-emerald-600 font-bold" rowSpan={row.rowSpan}>{row.server.specs?.virtual_ip ? row.server.specs.virtual_ip.split(',').length : ''}</td>
                                          <td className="p-1.5 font-mono text-blue-600 font-bold" rowSpan={row.rowSpan}>{row.server.specs?.private_lan || ''}</td>
                                        </>
                                      ) : null 
                                    ) : (
                                      <><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="border-r border-slate-300 p-1.5"></td><td className="p-1.5"></td></>
                                    )}
                                  </tr>
                                ))}
                                {/* ⭐️ 상세 실장도 총합계 */}
                                {selectedRack.servers?.length > 0 && (
                                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                                    <td colSpan={3} className="border-r border-slate-300 p-2 text-right pr-4 text-slate-700">전체 합계</td>
                                    <td className="border-r border-slate-300 p-2 text-red-600 font-mono">{detailedTotals.power}W</td>
                                    <td className="border-r border-slate-300 p-2 text-slate-700 font-mono">{detailedTotals.current > 0 ? detailedTotals.current.toFixed(2) + 'A' : '-'}</td>
                                    <td className="border-r border-slate-300 p-2 text-slate-700 font-mono">{detailedTotals.lan || '-'}</td>
                                    <td className="border-r border-slate-300 p-2 text-red-600 font-mono">{detailedTotals.pip || '-'}</td>
                                    <td className="border-r border-slate-300 p-2 text-emerald-600 font-mono">{detailedTotals.vip || '-'}</td>
                                    <td className="p-2 text-blue-600 font-mono">{detailedTotals.priv || '-'}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : isEditing ? (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
                      <h2 className="text-2xl font-bold text-slate-800 flex items-center">{editForm.id ? <><Edit size={24} className="mr-2 text-blue-600"/> 장비 정보 수정</> : <><Plus size={24} className="mr-2 text-emerald-600"/> 신규 장비 실장</>}</h2>
                      <div className="flex gap-2">
                        <button onClick={handleCancelEdit} className="px-4 py-2 flex items-center text-sm font-bold bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition shadow-sm"><X size={16} className="mr-1"/> 취소</button>
                        <button onClick={handleSave} className="px-4 py-2 flex items-center text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md"><Save size={16} className="mr-1"/> DB에 저장</button>
                      </div>
                    </div>

                    <div className="mb-6 p-4 bg-blue-50/50 border border-blue-100 rounded-xl flex justify-between items-center">
                      <div>
                        <span className="text-xs font-bold text-blue-700 uppercase tracking-widest flex items-center mb-1"><Save size={14} className="mr-1"/> 템플릿(프리셋) 관리</span>
                        <p className="text-xs text-slate-500">자주 쓰는 장비 제원을 템플릿으로 등록하여 빠르게 불러오세요.</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleSavePreset} className="bg-white border border-blue-200 text-blue-600 px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-50 transition-colors shadow-sm">현재 입력값으로 템플릿 생성</button>
                      </div>
                    </div>
                    
                    {Object.keys(presets).length > 0 && (
                      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
                        {Object.keys(presets).map(pName => (
                          <div key={pName} className="flex items-center bg-blue-600 text-white rounded-full shadow-sm text-xs font-bold shrink-0">
                            <button onClick={() => handleLoadPreset(pName)} className="px-3 py-1.5 hover:bg-blue-500 rounded-l-full transition-colors flex items-center" title="이 템플릿 제원 불러오기"><Copy size={12} className="mr-1.5 opacity-80" /> {pName}</button>
                            <button onClick={(e) => handleDeletePreset(e, pName)} className="px-2 py-1.5 bg-blue-700 hover:bg-red-500 rounded-r-full transition-colors" title="템플릿 삭제"><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <label className="block text-xs font-bold text-slate-700 mb-2">자산 유형 (Asset Type) 선택</label>
                      <div className="flex gap-4">
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'server' || !editForm.specs?.asset_type ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="server" className="hidden" checked={editForm.specs?.asset_type === 'server' || !editForm.specs?.asset_type} onChange={(e) => handleFormChange(e, 'asset_type', true)} />
                          <Server size={18} className="mr-2" /> 서버 (Server)
                        </label>
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'storage' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="storage" className="hidden" checked={editForm.specs?.asset_type === 'storage'} onChange={(e) => handleFormChange(e, 'asset_type', true)} />
                          <Database size={18} className="mr-2" /> 스토리지 (Storage)
                        </label>
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${editForm.specs?.asset_type === 'switch' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                          <input type="radio" name="asset_type" value="switch" className="hidden" checked={editForm.specs?.asset_type === 'switch'} onChange={(e) => handleFormChange(e, 'asset_type', true)} />
                          <Network size={18} className="mr-2" /> 스위치 (Switch)
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-5 mb-6">
                      <div className="col-span-2 sm:col-span-1 flex gap-2"><div className="w-1/2"><label className="block text-xs font-bold text-slate-700 mb-1">시작 위치 (U) <span className="text-red-500">*</span></label><input type="number" value={editForm.start_u || ''} onChange={(e) => handleFormChange(e, 'start_u')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 32" /></div><div className="w-1/2"><label className="block text-xs font-bold text-slate-700 mb-1">장비 높이 (Size) <span className="text-red-500">*</span></label><input type="number" min="1" value={editForm.size_u || 1} onChange={(e) => handleFormChange(e, 'size_u')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 2" /></div></div>
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">Hostname <span className="text-red-500">*</span></label><input type="text" value={editForm.hostname || ''} onChange={(e) => handleFormChange(e, 'hostname')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: kr-gh-nrdk-db01" /></div>
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">모델명 (Model)</label><input type="text" list="model-list" value={editForm.model_name || ''} onChange={(e) => handleFormChange(e, 'model_name')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: Dell PowerEdge R650" /></div>
                      
                      {/* ⭐️ OS Version을 무적의 specs 로 저장 */}
                      <div className="col-span-2 sm:col-span-1"><label className="block text-xs font-bold text-slate-700 mb-1">OS Version</label><input type="text" value={editForm.specs?.os_version || editForm.os_version || ''} onChange={(e) => handleFormChange(e, 'os_version', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: Ubuntu 22.04 LTS" /></div>
                      
                      <div className="col-span-2 sm:col-span-1 flex gap-4"><div className="flex-1"><label className="block text-xs font-bold text-slate-700 mb-1">운영 상태 <span className="text-red-500">*</span></label><select value={editForm.status || 'WAIT'} onChange={(e) => handleFormChange(e, 'status')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow font-bold"><option value="WAIT">입고/셋업 대기 (WAIT)</option><option value="OPER">정상 운영 (OPER)</option><option value="MAINT">장애/수리 (MAINT)</option><option value="IDLE">유휴/폐기 (IDLE)</option></select></div><div className="flex-1"><label className="block text-xs font-bold text-slate-700 mb-1">도입 년도</label><input type="text" value={editForm.setup_year || ''} onChange={(e) => handleFormChange(e, 'setup_year')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="예: 2024" /></div></div>
                      
                      {editForm.specs?.asset_type !== 'switch' && (
                        <div className="col-span-2"><label className="block text-xs font-bold text-slate-700 mb-1">자산 용도 / 비고 (설명)</label><input type="text" value={editForm.description || ''} onChange={(e) => handleFormChange(e, 'description')} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow placeholder-slate-300" placeholder="장비의 주요 용도를 적어주세요." /></div>
                      )}
                    </div>
                    
                    {editForm.specs?.asset_type === 'switch' ? (
                      <>
                        <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2 flex items-center"><Network size={18} className="mr-2 text-emerald-500"/> 스위치 기본 정보 및 포트 매핑 (Port Mapping)</h3>
                        <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-5 rounded-xl border border-slate-200 shadow-inner mb-6">
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Management IP</label><input type="text" value={editForm.specs?.mgmt_ip || editForm.specs?.ip || ''} onChange={(e) => handleFormChange(e, 'mgmt_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 10.1.2.3" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Serial Number (S/N)</label><input type="text" value={editForm.specs?.serial_number || ''} onChange={(e) => handleFormChange(e, 'serial_number', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SN-12345ABC" /></div>
                        </div>

                        <div className="mb-2"><span className="text-sm font-bold text-slate-700">포트 시각화 매핑 (포트를 클릭하여 연결된 서버를 할당하세요)</span></div>
                        {renderSwitchPorts(editForm.specs?.switch_ports || {}, true)}
                      </>
                    ) : (
                      <>
                        <h3 className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2 flex items-center"><Activity size={18} className="mr-2 text-blue-500"/> 상세 제원 및 자원 할당</h3>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50/50 p-5 rounded-xl border border-slate-200 shadow-inner">
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">CPU</label><input type="text" list="cpu-list" value={editForm.specs?.cpu || ''} onChange={(e) => handleFormChange(e, 'cpu', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: Intel Xeon Silver" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Memory (RAM)</label><input type="text" list="ram-list" value={editForm.specs?.ram || ''} onChange={(e) => handleFormChange(e, 'ram', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 128GB" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Storage (Disk)</label><input type="text" value={editForm.specs?.storage || ''} onChange={(e) => handleFormChange(e, 'storage', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 1.92TB NVMe x2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">GPU / 가속기</label><input type="text" list="gpu-list" value={editForm.specs?.gpu || ''} onChange={(e) => handleFormChange(e, 'gpu', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                          
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">전력 소모량 (W)</label><input type="number" value={editForm.specs?.power_w || ''} onChange={(e) => handleFormChange(e, 'power_w', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 1200" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Public LAN (포트 수)</label><input type="number" value={editForm.specs?.public_lan || ''} onChange={(e) => handleFormChange(e, 'public_lan', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Private LAN (포트 수)</label><input type="number" value={editForm.specs?.private_lan || ''} onChange={(e) => handleFormChange(e, 'private_lan', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 2" /></div>

                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Public IP</label><input type="text" value={editForm.specs?.public_ip || ''} onChange={(e) => handleFormChange(e, 'public_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 100.100.181.2" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Virtual IP</label><input type="text" value={editForm.specs?.virtual_ip || ''} onChange={(e) => handleFormChange(e, 'virtual_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 100.100.180.1" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Private IP</label><input type="text" value={editForm.specs?.private_ip || ''} onChange={(e) => handleFormChange(e, 'private_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 192.168.90.71" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">MGMT IP (iDRAC 등)</label><input type="text" value={editForm.specs?.mgmt_ip || editForm.specs?.ip || ''} onChange={(e) => handleFormChange(e, 'mgmt_ip', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: 192.168.1.10" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">Serial Number (S/N)</label><input type="text" value={editForm.specs?.serial_number || ''} onChange={(e) => handleFormChange(e, 'serial_number', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SN-12345ABC" /></div>

                          <div><label className="block text-xs font-bold text-slate-600 mb-1">상단 L2 스위치</label><input type="text" value={editForm.specs?.l2_switch || ''} onChange={(e) => handleFormChange(e, 'l2_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: SW-L2-01" /></div>
                          <div><label className="block text-xs font-bold text-slate-600 mb-1">상단 SAN 스위치</label><input type="text" value={editForm.specs?.san_switch || ''} onChange={(e) => handleFormChange(e, 'san_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: SW-SAN-01" /></div>
                          
                          <div className="md:col-span-2 lg:col-span-1"><label className="block text-xs font-bold text-slate-600 mb-1">하단 SAN 스위치</label><input type="text" value={editForm.specs?.bottom_san_switch || ''} onChange={(e) => handleFormChange(e, 'bottom_san_switch', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" placeholder="예: SW-SAN-02" /></div>
                          {/* ⭐️ 볼륨 마운트 입력칸 (와이드 배치) */}
                          <div className="col-span-2 lg:col-span-3"><label className="block text-xs font-bold text-slate-600 mb-1">볼륨 마운트 (Volume Mount)</label><input type="text" value={editForm.specs?.volume_mount || ''} onChange={(e) => handleFormChange(e, 'volume_mount', true)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono text-blue-700" placeholder="예: /data, /backup" /></div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center shadow-sm ${getStatusColor(selectedServer.status)}`}>
                            {getStatusIcon(selectedServer.status)}{getStatusText(selectedServer.status)}
                          </span>
                          <span className="text-xs font-bold font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 shadow-sm flex items-center">
                            {getAssetTypeIcon(selectedServer.specs?.asset_type, 14, "mr-1 text-slate-500")}
                            {selectedServer.specs?.asset_type === 'switch' ? 'SWITCH' : selectedServer.specs?.asset_type === 'storage' ? 'STORAGE' : 'SERVER'}
                          </span>
                          <span className="text-xs font-bold font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 shadow-sm">
                            U{selectedServer.start_u} ~ U{selectedServer.start_u + selectedServer.size_u - 1} ({selectedServer.size_u}U)
                          </span>
                        </div>
                        <h2 className="text-3xl font-black text-slate-800 font-mono tracking-tight">{selectedServer.hostname || 'Hostname 미지정'}</h2><p className="text-lg text-slate-500 mt-1 font-medium">{selectedServer.model_name}</p>
                      </div>
                      <div className="text-right bg-slate-50 px-4 py-2 rounded-xl border border-slate-100"><p className="text-xs text-slate-400 font-bold uppercase tracking-wider">도입년도</p><p className="text-2xl font-black text-slate-700">{selectedServer.setup_year || '-'}</p></div>
                    </div>
                    {selectedServer.status === 'MAINT' && (
                      <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start text-red-800 shadow-inner"><AlertTriangle size={20} className="mr-3 shrink-0 mt-0.5" /><div><h4 className="font-bold">장애/수리 접수 알림</h4><p className="text-sm mt-1 font-medium">{selectedServer.description}</p></div></div>
                    )}
                    
                    {selectedServer.specs?.asset_type === 'switch' ? (
                      <>
                        {renderSwitchPorts(selectedServer.specs?.switch_ports || {}, false)}
                        
                        <div className="pt-2 border-t border-slate-100 flex-1">
                          <h4 className="font-bold text-slate-800 mb-4 flex items-center"><Info size={18} className="mr-2 text-blue-600"/> 스위치 기본 정보</h4>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">Management IP</dt><dd className="font-mono font-bold text-blue-700 break-words">{selectedServer.specs?.mgmt_ip || selectedServer.specs?.ip || selectedServer.specs?.public_ip || '할당 안됨'}</dd></div>
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">Serial Number</dt><dd className="font-mono font-bold text-slate-800 break-words">{selectedServer.specs?.serial_number || '-'}</dd></div>
                          </dl>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
                          <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl mr-4"><Cpu size={24} strokeWidth={1.5} /></div><div className="min-w-0"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Processor</p><p className="font-bold text-slate-800 truncate">{selectedServer.specs?.cpu || '정보 없음'}</p></div></div>
                          <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl mr-4"><Database size={24} strokeWidth={1.5} /></div><div className="min-w-0"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Memory</p><p className="font-bold text-slate-800 truncate">{selectedServer.specs?.ram || '정보 없음'}</p></div></div>
                          <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className="p-3 bg-blue-50 text-blue-600 rounded-xl mr-4"><HardDrive size={24} strokeWidth={1.5} /></div><div className="min-w-0"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Storage</p><p className="font-bold text-slate-800 truncate">{selectedServer.specs?.storage || '정보 없음'}</p></div></div>
                          
                          {selectedServer.specs?.gpu ? (
                            <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className="p-3 bg-amber-50 text-amber-600 rounded-xl mr-4"><Monitor size={24} strokeWidth={1.5} /></div><div className="min-w-0"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">GPU Accelerator</p><p className="font-bold text-slate-800 truncate">{selectedServer.specs?.gpu}</p></div></div>
                          ) : (
                            <div className="p-4 bg-white rounded-xl border border-slate-200 flex items-center shadow-sm opacity-50"><div className="p-3 bg-slate-50 text-slate-400 rounded-xl mr-4"><Monitor size={24} strokeWidth={1.5} /></div><div><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">GPU Accelerator</p><p className="font-bold text-slate-400">없음</p></div></div>
                          )}
                        </div>
                        
                        <div className="pt-6 border-t border-slate-100 flex-1">
                          <h4 className="font-bold text-slate-800 mb-4 flex items-center"><Activity size={18} className="mr-2 text-blue-600"/> 네트워킹 및 관리 정보</h4>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                            
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                              <dt className="text-slate-400 mb-2 text-[10px] font-bold uppercase tracking-widest flex items-center"><Key size={12} className="mr-1.5"/> Public & Virtual IP</dt>
                              <dd className="text-sm mb-1.5 flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">Public</span> <span className="font-mono font-bold text-blue-600 break-all ml-2 text-right">{selectedServer.specs?.public_ip || '-'}</span></dd>
                              <dd className="text-sm flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">Virtual</span> <span className="font-mono font-bold text-emerald-600 break-all ml-2 text-right">{selectedServer.specs?.virtual_ip || '-'}</span></dd>
                            </div>

                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                              <dt className="text-slate-400 mb-2 text-[10px] font-bold uppercase tracking-widest flex items-center"><Key size={12} className="mr-1.5"/> Private & MGMT IP</dt>
                              <dd className="text-sm mb-1.5 flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">Private</span> <span className="font-mono font-bold text-indigo-600 break-all ml-2 text-right">{selectedServer.specs?.private_ip || '-'}</span></dd>
                              <dd className="text-sm flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">MGMT</span> <span className="font-mono font-bold text-slate-700 break-all ml-2 text-right">{selectedServer.specs?.mgmt_ip || selectedServer.specs?.ip || '-'}</span></dd>
                            </div>

                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                              <dt className="text-slate-400 mb-2 text-[10px] font-bold uppercase tracking-widest flex items-center"><Database size={12} className="mr-1.5"/> SAN Switch</dt>
                              <dd className="text-sm mb-1.5 flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">TOP</span> <span className="font-mono font-bold text-slate-800 break-all ml-2 text-right">{selectedServer.specs?.san_switch || '-'}</span></dd>
                              <dd className="text-sm flex justify-between items-center"><span className="text-slate-500 font-bold text-[11px] bg-slate-200/50 px-2 py-0.5 rounded">BOT</span> <span className="font-mono font-bold text-slate-800 break-all ml-2 text-right">{selectedServer.specs?.bottom_san_switch || '-'}</span></dd>
                            </div>
                            
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">할당 전력량</dt><dd className="font-bold text-slate-800 mt-auto">{selectedServer.specs?.power_w ? `${selectedServer.specs.power_w} W` : '-'}</dd></div>
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">LAN 포트 (Pub/Priv)</dt><dd className="font-bold text-slate-800 mt-auto">{selectedServer.specs?.public_lan || 0} 개 / {selectedServer.specs?.private_lan || 0} 개</dd></div>
                            
                            {/* ⭐️ OS 버전을 무적의 specs에서 꺼내옴 (데이터 증발 해결) */}
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">OS Version</dt><dd className="font-bold text-slate-800 mt-auto">{selectedServer.specs?.os_version || selectedServer.os_version || '-'}</dd></div>

                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">상단 L2 스위치</dt><dd className="font-bold text-slate-800 break-words mt-auto">{selectedServer.specs?.l2_switch || '-'}</dd></div>
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">Serial Number</dt><dd className="font-bold font-mono text-slate-800 break-words mt-auto">{selectedServer.specs?.serial_number || '-'}</dd></div>
                            
                            {/* ⭐️ 볼륨 마운트 표시 */}
                            <div className="flex flex-col bg-slate-50 p-4 rounded-xl border border-slate-100"><dt className="text-slate-400 mb-1 text-[10px] font-bold uppercase tracking-widest">볼륨 마운트 (Volume Mount)</dt><dd className="font-mono text-sm font-bold text-blue-600 break-words mt-auto">{selectedServer.specs?.volume_mount || '-'}</dd></div>

                            <div className="flex flex-col bg-white p-5 rounded-xl border border-slate-300 shadow-sm sm:col-span-2 lg:col-span-3 mt-2 border-l-4 border-l-slate-400">
                              <dt className="text-slate-400 mb-2 text-[10px] font-bold uppercase tracking-widest flex items-center"><AlertTriangle size={12} className="mr-1.5" /> 비고 (설명 및 특이사항)</dt>
                              <dd className="font-medium text-slate-700 mt-auto whitespace-pre-wrap leading-relaxed">{selectedServer.description || '등록된 내용이 없습니다.'}</dd>
                            </div>
                          </dl>
                        </div>
                      </>
                    )}

                    <div className="mt-8 pt-6 flex justify-between border-t border-slate-100">
                      <div className="flex gap-3">
                        <button onClick={handleEditClick} className="px-6 py-2.5 flex items-center bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"><Edit size={16} className="mr-2"/> 정보 수정</button>
                        <button onClick={() => fetchServerHistory(selectedServer.id)} className="px-6 py-2.5 flex items-center bg-white text-slate-700 font-bold rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors shadow-sm"><Clock size={16} className="mr-2 text-slate-500" /> 상세 이력 조회</button>
                      </div>
                      <button onClick={handleDelete} className="px-4 py-2.5 flex items-center text-red-500 hover:text-white font-bold rounded-lg hover:bg-red-500 transition-colors"><Trash2 size={16} className="mr-2" /> 자산 폐기</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 상태 드릴다운 팝업 모달 */}
          {statusModalInfo && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl shrink-0">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg mr-3 shadow-inner ${
                      statusModalInfo.status === 'OPER' ? 'bg-emerald-100 text-emerald-600' :
                      statusModalInfo.status === 'MAINT' ? 'bg-red-100 text-red-600' :
                      statusModalInfo.status === 'IDLE' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      {getStatusIcon(statusModalInfo.status)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">{statusModalInfo.title} 자산 목록</h3>
                      <p className="text-sm font-medium text-slate-500 mt-0.5">총 {statusModalInfo.servers.length}대</p>
                    </div>
                  </div>
                  <button onClick={() => setStatusModalInfo(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 p-2 rounded-full transition-colors"><X size={24} /></button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30">
                  {statusModalInfo.servers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400"><Info size={48} className="text-slate-300 mb-4" /><p className="font-bold text-slate-500">해당 상태의 자산이 없습니다.</p></div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {statusModalInfo.servers.slice((drillDownPage - 1) * ITEMS_PER_PAGE, drillDownPage * ITEMS_PER_PAGE).map((server, idx) => (
                        <div 
                          key={idx} 
                          onClick={() => handleGlobalSearchSelect({ campus: server.campus, building: server.building, rack: server.rack, server })}
                          className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-start cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group"
                        >
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center">
                                {getAssetTypeIcon(server.specs?.asset_type, 14, "mr-1.5 text-slate-400")}
                                <h4 className="font-bold text-blue-700 group-hover:text-blue-600 font-mono text-base">{server.hostname}</h4>
                              </div>
                              <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-mono border">{server.specs?.ip || server.specs?.public_ip || 'IP 없음'}</span>
                            </div>
                            <div className="flex justify-between items-end">
                              <span className="text-xs font-medium text-slate-500">{server.model_name || '모델명 없음'}</span>
                              <div className="text-xs font-bold text-slate-400 flex items-center bg-slate-50 px-2 py-1 rounded">
                                <MapPin size={12} className="mr-1 text-slate-400" />
                                {server.locationPath} ({server.start_u}U)
                              </div>
                            </div>
                          </div>
                          <ChevronRight size={20} className="ml-4 text-slate-300 group-hover:text-blue-500 self-center transition-colors" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {statusModalInfo.servers.length > ITEMS_PER_PAGE && (
                  <div className="p-4 border-t border-slate-100 bg-white rounded-b-2xl flex justify-center items-center gap-4 shrink-0">
                    <button 
                      onClick={() => setDrillDownPage(p => Math.max(1, p - 1))} 
                      disabled={drillDownPage === 1}
                      className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white transition-colors"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <span className="text-sm font-bold text-slate-700">
                      {drillDownPage} <span className="text-slate-400 font-normal">/ {Math.ceil(statusModalInfo.servers.length / ITEMS_PER_PAGE)}</span>
                    </span>
                    <button 
                      onClick={() => setDrillDownPage(p => Math.min(Math.ceil(statusModalInfo.servers.length / ITEMS_PER_PAGE), p + 1))} 
                      disabled={drillDownPage === Math.ceil(statusModalInfo.servers.length / ITEMS_PER_PAGE)}
                      className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white transition-colors"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 상세 이력 조회 모달 */}
          {showHistoryModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl shrink-0">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center"><Clock className="mr-2 text-blue-500" /> 자산 변경 이력 조회</h3>
                    <p className="text-sm font-medium text-slate-500 mt-1">{selectedServer?.hostname || '알 수 없음'} 장비의 타임라인</p>
                  </div>
                  <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 p-2 rounded-full transition-colors"><X size={24} /></button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30">
                  {loadingHistory ? (
                    <div className="flex flex-col items-center justify-center h-40"><RefreshCw size={32} className="text-blue-500 animate-spin mb-4" /><p className="font-bold text-slate-500">이력을 불러오는 중...</p></div>
                  ) : serverHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400"><Info size={48} className="text-slate-300 mb-4" /><p className="font-bold text-slate-500">기록된 이력이 없습니다.</p></div>
                  ) : (
                    <div className="relative border-l-2 border-slate-200 ml-3 pl-6 space-y-6">
                      {serverHistory.map((hist, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-[31px] p-1.5 rounded-full border-2 border-white ${hist.type === 'Created' ? 'bg-emerald-500' : hist.type === 'Deleted' ? 'bg-red-500' : 'bg-blue-500'}`}><Clock size={12} className="text-white" /></div>
                          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                            <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-2">
                              <div><span className={`text-xs font-bold px-2 py-0.5 rounded mr-2 ${hist.type === 'Created' ? 'bg-emerald-100 text-emerald-700' : hist.type === 'Deleted' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{hist.type === 'Created' ? '신규 등록' : hist.type === 'Deleted' ? '장비 폐기' : '정보 수정'}</span><span className="text-sm font-bold text-slate-700">{hist.date}</span></div>
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono font-bold flex items-center"><UserIcon size={12} className="mr-1" />{hist.user}</span>
                            </div>
                            <div className="space-y-2">
                              {hist.changes && hist.changes.length > 0 ? hist.changes.map((change, cIdx) => (
                                <div key={cIdx} className="text-sm flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                  <span className="font-bold text-slate-600 w-24 shrink-0 bg-slate-50 px-2 py-1 rounded">{change.field}</span>
                                  <div className="flex-1 flex flex-wrap items-center gap-2 bg-slate-50/50 p-1.5 rounded border border-slate-100">
                                    <span className="text-red-500 line-through truncate max-w-[150px]" title={change.old}>{change.old || '(없음)'}</span>
                                    <ArrowRight size={14} className="text-slate-400" />
                                    <span className="text-emerald-600 font-bold truncate max-w-[150px]" title={change.new}>{change.new || '(비워짐)'}</span>
                                  </div>
                                </div>
                              )) : <p className="text-sm text-slate-500 italic">변경 사항 상세 정보 없음</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 신규 랙 추가 팝업 모달 */}
          {isAddingRack && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center"><Server className="mr-2 text-blue-500" size={20} /> 신규 랙(Rack) 추가</h3>
                  <button onClick={() => setIsAddingRack(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 p-1.5 rounded-full transition-colors"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">랙 이름 (필수)</label>
                    <input type="text" value={newRackForm.name} onChange={(e) => handleNewRackChange('name', e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: NRD-K DAQ Rack 3" autoFocus onKeyDown={(e) => { if(e.key==='Enter') handleSaveRack(); }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">상세 위치</label>
                    <input type="text" value={newRackForm.location} onChange={(e) => handleNewRackChange('location', e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 3층 통신실 A구역" onKeyDown={(e) => { if(e.key==='Enter') handleSaveRack(); }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">전체 상면 크기 (U)</label>
                    <input type="number" value={newRackForm.total_u_space} onChange={(e) => handleNewRackChange('total_u_space', parseInt(e.target.value) || 0)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="기본값: 42" onKeyDown={(e) => { if(e.key==='Enter') handleSaveRack(); }}/>
                  </div>
                </div>
                <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                  <button onClick={() => setIsAddingRack(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">취소</button>
                  <button onClick={handleSaveRack} className="px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm">추가하기</button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
