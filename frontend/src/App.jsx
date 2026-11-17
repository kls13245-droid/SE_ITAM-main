import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, FolderOpen, Server, ChevronRight, Activity, AlertTriangle, 
  Moon, HardDrive, Cpu, Database, MapPin, RefreshCw, Home, Save, 
  X, Edit, Plus, Search, CheckCircle, Info, Clock, ArrowRight, Trash2, 
  Zap, Network, Key, List, Copy, Monitor, AlignJustify, Building, ChevronLeft,
  LogOut, Lock, User as UserIcon
} from 'lucide-react';
import RackDiagram from './components/RackDiagram';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ServerForm from './components/ServerForm';
import { apiFetch, apiJson, jsonBody, loadCsrfToken, setCsrfToken } from './api/client';
import ImportCsvModal from './components/ImportCsvModal';
import FieldAssets from './components/FieldAssets';
import ReviewDocs from './components/ReviewDocs';
import IncidentReports from './components/IncidentReports';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import { matchesSearch, primaryIp, matchesFieldSearch, fieldIp } from './utils/server';
import { STATUS_STYLE as FIELD_STATUS_STYLE } from './components/fieldAssetConstants';

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
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState('topology'); // 'topology' | 'field' (현장 장비) | 'reviews' (투자심의 자료) | 'incidents' (장애·유지보수 보고)
  const [fieldAssets, setFieldAssets] = useState([]); // 전체 검색용 현장 장비 목록
  const [fieldFocusId, setFieldFocusId] = useState(null); // 검색에서 고른 현장 장비
  const [currentUser, setCurrentUser] = useState({ username: '', isAdmin: false });
  const [deleteRequest, setDeleteRequest] = useState(null); // 관리자 확인 삭제 창
  // 삭제는 모두 이 창을 거친다: 경고 문구 + 관리자 아이디/비밀번호
  const askDelete = ({ title, target, warnings = [], url, onDone }) => setDeleteRequest({
    title, target, warnings,
    onConfirm: (creds) => apiJson(url, jsonBody('DELETE', creds)).then(onDone),
  });
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // silent: 화면 전체 로딩 표시 없이 새로고침하고, 보고 있던 건물/랙/장비 선택은 새 데이터로 다시 맞춘다
  const fetchSiteData = (silent = false) => {
    if (!silent) setLoading(true);
    setApiError(null);
    apiFetch(`/api/site-data/`) 
      .then(res => {
        if (!res.ok) throw new Error('서버 응답 오류');
        return res.json();
      })
      .then(data => {
        setSiteData(data);
        const campus = data.find(c => c.buildings?.some(b => b.id === selectedBuilding?.id));
        const building = campus?.buildings.find(b => b.id === selectedBuilding?.id);
        setSelectedBuilding(building ? { ...building, campusName: campus.name } : null);
        const rack = building?.racks.find(r => r.id === selectedRack?.id) || null;
        setSelectedRack(rack);
        setSelectedServer(prev => (prev && !prev.isNew ? rack?.servers.find(s => s.id === prev.id) || null : prev));
        setLoading(false);
      })
      .catch(err => {
        setApiError("서버와 통신할 수 없습니다.");
        setSiteData([]); 
        showToast("서버 연동 실패", "error");
        setLoading(false);
      });
  };

  useEffect(() => {
    loadCsrfToken().then(() => apiFetch('/api/me/'))
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.authenticated) {
          setIsAuthenticated(true);
          localStorage.setItem('itam_auth', 'true');
          localStorage.setItem('itam_user', data.username);
          setCurrentUser({ username: data.username, isAdmin: !!data.is_admin });
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem('itam_auth');
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  useEffect(() => { if (isAuthenticated) fetchSiteData(); }, [isAuthenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    apiFetch(`/api/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm)
    })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (ok) {
        setCsrfToken(data.csrf_token);
        localStorage.setItem('itam_auth', 'true');
        localStorage.setItem('itam_user', data.username);
        setCurrentUser({ username: data.username, isAdmin: !!data.is_admin });
        setIsAuthenticated(true);
        showToast(`${data.username}님, 환영합니다!`, "success");
      } else {
        setLoginError(data.error || "로그인에 실패했습니다.");
      }
    })
    .catch(() => setLoginError("서버와 통신할 수 없습니다."));
  };

  const handleLogout = () => {
    apiFetch('/api/logout/', { method: 'POST' }).finally(() => {
      loadCsrfToken();
      localStorage.removeItem('itam_auth');
      localStorage.removeItem('itam_user');
      setIsAuthenticated(false);
    });
  };

  const fetchServerHistory = (serverId) => {
    setLoadingHistory(true);
    setShowHistoryModal(true);
    apiFetch(`/api/server/history/${serverId}/`)
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
    if (!searchTerm.trim()) return { items: [], total: 0 };
    const term = searchTerm.toLowerCase();
    const results = [];
    siteData.forEach(campus => campus.buildings?.forEach(building => building.racks?.forEach(rack => rack.servers?.forEach(server => {
      if (matchesSearch(server, term)) {
        results.push({ campus, building, rack, server });
      }
    }))));
    return { items: results.slice(0, 10), total: results.length };
  }, [siteData, searchTerm]);

  // 검색을 시작할 때마다 현장 장비 목록을 새로 받아온다 (현장 장비 화면에서 고친 내용 반영)
  const isSearching = searchTerm.trim() !== '';
  useEffect(() => {
    if (!isSearching || !isAuthenticated) return;
    apiJson('/api/field-assets/').then(d => setFieldAssets(d.items)).catch(() => {});
  }, [isSearching, isAuthenticated]);

  const fieldSearchResults = useMemo(() => {
    if (!isSearching) return { items: [], total: 0 };
    const found = fieldAssets.filter(a => matchesFieldSearch(a, searchTerm));
    return { items: found.slice(0, 10), total: found.length };
  }, [fieldAssets, searchTerm, isSearching]);

  // 현장 장비 상세의 '랙에서 보기': 최신 랙 데이터를 받아 해당 랙·장비로 이동
  const openRackFromField = (link) => {
    apiJson('/api/site-data/').then(data => {
      setSiteData(data);
      const campus = data.find(c => c.id === link.campus_id);
      const building = campus?.buildings.find(b => b.id === link.building_id);
      const rack = building?.racks.find(r => r.id === link.rack_id);
      const server = rack?.servers.find(sv => sv.id === link.server_id);
      if (!rack) { showToast('랙을 찾을 수 없습니다. 새로고침해 주세요.', 'error'); return; }
      handleGlobalSearchSelect({ campus, building, rack, server: server || null });
    }).catch(err => showToast(err.message, 'error'));
  };

  const handleFieldSearchSelect = (asset) => {
    setView('field'); setFieldFocusId(asset.id); setSearchTerm('');
  };

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

  const goHome = () => { setView('topology'); setSelectedBuilding(null); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); setSearchTerm(''); setActivePort(null); };
  const handleCampusClick = (campusId) => setExpandedCampus(expandedCampus === campusId ? null : campusId);
  const handleBuildingClick = (building, campus) => { setView('topology'); setSelectedBuilding({ ...building, campusName: campus.name }); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleRackClick = (rack) => { setSelectedRack(rack); setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleRackNameClick = () => { setSelectedServer(null); setIsEditing(false); setActivePort(null); };
  const handleServerClick = (server) => { setSelectedServer(server); setIsEditing(false); setActivePort(null); };
  
  const handleGlobalSearchSelect = (result) => {
    setView('topology');
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
    apiJson(`/api/campus/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCampusName }) })
    .then(savedCampus => {
      setSiteData([...siteData, { ...savedCampus, buildings: [] }]);
      setIsAddingCampus(false); setNewCampusName(''); showToast("캠퍼스가 추가되었습니다.", "success");
    }).catch(err => showToast(err.message, 'error'));
  };

  const handleSaveBuilding = () => {
    if (!newBuildingName.trim()) { showToast("건물 이름을 입력해주세요.", "error"); return; }
    apiJson(`/api/building/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campus_id: targetCampusId, name: newBuildingName }) })
    .then(savedBuilding => {
      setSiteData(siteData.map(c => c.id === targetCampusId ? { ...c, buildings: [...(c.buildings || []), { ...savedBuilding, racks: [] }] } : c));
      setIsAddingBuilding(false); setNewBuildingName(''); setTargetCampusId(null); setExpandedCampus(targetCampusId); showToast("건물이 추가되었습니다.", "success");
    }).catch(err => showToast(err.message, 'error'));
  };


  const handleRenameCampus = (campus) => {
    const name = window.prompt('캠퍼스 이름', campus.name);
    if (!name || name === campus.name) return;
    apiJson(`/api/campus/update/${campus.id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .then(() => { setSiteData(siteData.map(c => c.id === campus.id ? { ...c, name } : c)); showToast('캠퍼스 이름이 수정되었습니다.'); })
      .catch(err => showToast(err.message, 'error'));
  };
  // 캠퍼스/건물/랙 안에 들어 있는 랙·장비 수 (삭제 경고용)
  const countIn = (racks) => ({ racks: racks.length, servers: racks.reduce((n, r) => n + (r.servers?.length || 0), 0) });
  const handleDeleteCampus = (campus) => {
    const buildings = campus.buildings || [];
    const { racks, servers } = countIn(buildings.flatMap(b => b.racks || []));
    askDelete({
      title: '캠퍼스 삭제', target: campus.name, url: `/api/campus/delete/${campus.id}/`,
      warnings: [`건물 ${buildings.length}개, 랙 ${racks}개, 장비 ${servers}대가 함께 삭제됩니다.`],
      onDone: (r) => { goHome(); fetchSiteData(true); showToast(`캠퍼스를 삭제했습니다. (장비 ${r.deleted_servers}대 포함, 승인: ${r.approved_by})`); },
    });
  };
  const handleRenameBuilding = (building) => {
    const name = window.prompt('건물 이름', building.name);
    if (!name || name === building.name) return;
    apiJson(`/api/building/update/${building.id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .then(() => {
        setSiteData(siteData.map(c => ({ ...c, buildings: c.buildings?.map(b => b.id === building.id ? { ...b, name } : b) })));
        if (selectedBuilding?.id === building.id) setSelectedBuilding({ ...selectedBuilding, name });
        showToast('건물 이름이 수정되었습니다.');
      })
      .catch(err => showToast(err.message, 'error'));
  };
  const handleDeleteBuilding = (building) => {
    const { racks, servers } = countIn(building.racks || []);
    askDelete({
      title: '건물 삭제', target: building.name, url: `/api/building/delete/${building.id}/`,
      warnings: [`랙 ${racks}개, 장비 ${servers}대가 함께 삭제됩니다.`],
      onDone: (r) => {
        if (selectedBuilding?.id === building.id) goHome();
        fetchSiteData(true); showToast(`건물을 삭제했습니다. (장비 ${r.deleted_servers}대 포함, 승인: ${r.approved_by})`);
      },
    });
  };
  const handleRenameRack = (rack) => {
    const name = window.prompt('랙 이름', rack.name);
    if (!name || name === rack.name) return;
    apiJson(`/api/rack/update/${rack.id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .then(() => {
        const updated = { ...selectedBuilding, racks: selectedBuilding.racks.map(r => r.id === rack.id ? { ...r, name } : r) };
        setSelectedBuilding(updated);
        if (selectedRack?.id === rack.id) setSelectedRack({ ...selectedRack, name });
        showToast('랙 이름이 수정되었습니다.');
      })
      .catch(err => showToast(err.message, 'error'));
  };
  const handleDeleteRack = (rack) => {
    const n = rack.servers?.length || 0;
    askDelete({
      title: '랙 삭제', target: rack.name, url: `/api/rack/delete/${rack.id}/`,
      warnings: [n ? `이 랙에 실장된 장비 ${n}대가 함께 삭제됩니다.` : '비어 있는 랙입니다.'],
      onDone: (r) => { fetchSiteData(true); showToast(`랙을 삭제했습니다.${r.deleted_servers ? ` (장비 ${r.deleted_servers}대 포함)` : ''}`); },
    });
  };
  const handleAddRackClick = () => { setNewRackForm({ name: '', location: '', total_u_space: 42 }); setIsAddingRack(true); };
  const handleNewRackChange = (field, value) => setNewRackForm(prev => ({ ...prev, [field]: value }));
  const handleSaveRack = () => {
    if (!newRackForm.name.trim()) { showToast("랙 이름을 입력해주세요.", "error"); return; }
    apiJson(`/api/rack/add/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newRackForm, building_id: selectedBuilding.id }) })
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
    }).catch(err => showToast(err.message, 'error'));
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
    const url = isNew ? `/api/server/add/` : `/api/server/update/${editForm.id}/`;
    
    apiJson(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editForm, rack_id: selectedRack.id }) })
    .then(savedData => {
      const completeData = { ...editForm, ...savedData };
      updateLocalState(completeData, isNew);
      showToast(isNew ? "새 장비 실장 완료" : "업데이트 완료", "success");
    }).catch(err => showToast(err.message, 'error'));
  };

  const handleDelete = () => {
    const srv = selectedServer;
    askDelete({
      title: '장비 삭제', target: `${srv.hostname} (U${srv.start_u}${srv.size_u > 1 ? `~U${srv.start_u + srv.size_u - 1}` : ''})`,
      url: `/api/server/delete/${srv.id}/`,
      warnings: ['장비 정보와 제원이 삭제됩니다. 변경 이력은 관리자 페이지에 남습니다.'],
      onDone: () => {
        setSelectedServer(null); setIsEditing(false); fetchSiteData(true);
        showToast('장비를 삭제했습니다.', 'success');
      },
    });
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
    apiJson(`/api/server/update/${serverToMove.id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedServer) })
    .then(() => {
      updateLocalState(updatedServer, false); showToast("장비 위치가 이동되었습니다.", "success");
    }).catch(err => showToast(err.message, 'error'));
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

  const handleExportExcel = () => {
    if (!selectedRack?.servers?.length) { showToast("내보낼 장비가 없습니다.", "error"); return; }

    const th = 'background:#ddebf7;color:#1e293b;font-weight:700;font-size:11pt;border:1px solid #94a3b8;padding:4px 6px;text-align:center;font-family:Calibri,Arial,sans-serif;';
    const td = 'font-size:11pt;border:1px solid #94a3b8;padding:4px 6px;text-align:center;font-family:Calibri,Arial,sans-serif;';
    const tdL = td + 'text-align:left;';
    const total = 'background:#f1f5f9;font-weight:700;font-size:11pt;border:1px solid #94a3b8;padding:4px 6px;text-align:right;font-family:Calibri,Arial,sans-serif;';
    const red = 'color:#dc2626;font-weight:700;';
    const green = 'color:#059669;font-weight:700;';
    const blue = 'color:#2563eb;font-weight:700;';

    const table = (title, headers, body) => `
      <h3 style="font-size:12pt;margin:16px 0 6px;color:#1e293b;">${title}</h3>
      <table style="border-collapse:collapse;margin-bottom:12px;">
        <tr>${headers.map(h => `<th style="${th}">${h}</th>`).join('')}</tr>
        ${body}
      </table>`;

    const powerBody = summaryStats.power.map((item, idx) => `
      <tr>
        ${idx === 0 ? `<td rowspan="${summaryStats.power.length}" style="${td}${red}">전기</td>` : ''}
        <td style="${tdL}">${item.model_name}</td>
        <td style="${td}">${item.power_w}W</td>
        <td style="${td}">${item.count}</td>
        <td style="${td}${red}">${item.power_w * item.count}W</td>
      </tr>`).join('') + `
      <tr><td colspan="4" style="${total}">총 합계</td><td style="${td}${red}">${summaryStats.power.reduce((s,i)=>s+i.power_w*i.count,0)}W</td></tr>`;

    const lanBody = (label, items, key) => items.map((item, idx) => `
      <tr>
        ${idx === 0 ? `<td rowspan="${items.length}" style="${td}${red}">${label}</td>` : ''}
        <td style="${tdL}">${item.model_name}</td>
        <td style="${td}">${item[key]}ea</td>
        <td style="${td}">${item.count}</td>
        <td style="${td}">${item[key] * item.count}ea</td>
      </tr>`).join('') + `
      <tr><td colspan="4" style="${total}">총 합계</td><td style="${td}${blue}">${items.reduce((s,i)=>s+i[key]*i.count,0)}ea</td></tr>`;

    const ipItems = summaryStats.ip.filter(i => i.pub_ip_count > 0 || i.vip_count > 0);
    const ipBody = ipItems.map(item => `
      ${item.pub_ip_count > 0 ? `<tr><td style="${td}${red}">Public IP</td><td style="${tdL}">${item.model_name} (${item.power_w}W)</td><td style="${td}">${item.pub_ip_count}ea</td></tr>` : ''}
      ${item.vip_count > 0 ? `<tr><td style="${td}${red}">Virtual IP</td><td style="${tdL}">${item.model_name} (${item.power_w}W)</td><td style="${td}${green}">${item.vip_count}ea</td></tr>` : ''}
    `).join('') + `
      <tr><td colspan="2" style="${total}">총 합계</td><td style="${td}${green}">${ipItems.reduce((s,i)=>s+i.pub_ip_count+i.vip_count,0)}ea</td></tr>`;

    const detailBody = rackTableRows.map(row => {
      if (!row.isServer) return `<tr><td style="${td}">${row.u}</td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td></tr>`;
      if (!row.isTopU) return `<tr><td style="${td}">${row.u}</td></tr>`;
      const s = row.server;
      const power = Number(s.specs?.power_w) || 0;
      return `<tr>
        <td style="${td}">${row.u}</td>
        <td rowspan="${row.rowSpan}" style="${tdL}">${s.model_name || '-'}</td>
        <td rowspan="${row.rowSpan}" style="${tdL}">${s.hostname || '-'}</td>
        <td rowspan="${row.rowSpan}" style="${td}">${power ? power + 'W' : ''}</td>
        <td rowspan="${row.rowSpan}" style="${td}">${power ? (power/220).toFixed(2) + 'A' : ''}</td>
        <td rowspan="${row.rowSpan}" style="${td}">${s.specs?.public_lan || ''}</td>
        <td rowspan="${row.rowSpan}" style="${td}${red}">${s.specs?.public_ip ? s.specs.public_ip.split(',').filter(Boolean).length : ''}</td>
        <td rowspan="${row.rowSpan}" style="${td}${green}">${s.specs?.virtual_ip ? s.specs.virtual_ip.split(',').filter(Boolean).length : ''}</td>
        <td rowspan="${row.rowSpan}" style="${td}${blue}">${s.specs?.private_lan || ''}</td>
      </tr>`;
    }).join('') + `
      <tr>
        <td colspan="3" style="${total}">전체 합계</td>
        <td style="${td}${red}">${detailedTotals.power}W</td>
        <td style="${td}">${detailedTotals.current > 0 ? detailedTotals.current.toFixed(2) + 'A' : '-'}</td>
        <td style="${td}">${detailedTotals.lan || '-'}</td>
        <td style="${td}${red}">${detailedTotals.pip || '-'}</td>
        <td style="${td}${green}">${detailedTotals.vip || '-'}</td>
        <td style="${td}${blue}">${detailedTotals.priv || '-'}</td>
      </tr>`;

    const html = `<html><head><meta charset="utf-8"></head><body>
      ${table('전기 (Power) 합계', ['구분','항목 (Model)','전력(W)','서버수','합계(W)'], powerBody)}
      ${table('Public LAN 할당', ['구분','항목 (Model)','LAN(포트)','서버수','합계(포트)'], lanBody('Pub LAN', summaryStats.pubLan, 'pub_lan'))}
      ${table('Private LAN 할당', ['구분','항목 (Model)','LAN(포트)','서버수','합계(포트)'], lanBody('Priv LAN', summaryStats.privLan, 'priv_lan'))}
      ${table('IP 할당 현황', ['구분','항목 (Model)','할당 IP 총계'], ipBody)}
      ${table('상세 랙 실장도 목록', ['No','Product','HOST','전기(W)','전류(A)','LAN','P.IP','V.IP','Private'], detailBody)}
    </body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedRack.name}-summary.xls`;
    a.click();
    showToast("색상과 상세 실장도가 포함된 엑셀 파일을 다운로드했습니다.", "success");
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
    return selectedRack.servers.filter(s => matchesSearch(s, term));
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

  if (!isAuthenticated) {
    return (
      <Login
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        onSubmit={handleLogin}
      />
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
      <Sidebar
        siteData={siteData}
        loading={loading}
        expandedCampus={expandedCampus}
        selectedBuilding={selectedBuilding}
        isAddingCampus={isAddingCampus}
        newCampusName={newCampusName}
        setNewCampusName={setNewCampusName}
        isAddingBuilding={isAddingBuilding}
        newBuildingName={newBuildingName}
        setNewBuildingName={setNewBuildingName}
        targetCampusId={targetCampusId}
        onGoHome={goHome}
        onLogout={handleLogout}
        onRefresh={() => fetchSiteData()}
        activeView={view}
        onOpenFieldAssets={() => { setView('field'); setSearchTerm(''); }}
        onOpenReviews={() => { setView('reviews'); setSearchTerm(''); }}
        onOpenIncidents={() => { setView('incidents'); setSearchTerm(''); }}
        onStartAddCampus={() => setIsAddingCampus(true)}
        onSaveCampus={handleSaveCampus}
        onCancelCampus={() => { setIsAddingCampus(false); setNewCampusName(''); }}
        onCampusClick={handleCampusClick}
        onStartAddBuilding={(id) => { setTargetCampusId(id); setIsAddingBuilding(true); setExpandedCampus(id); }}
        onSaveBuilding={handleSaveBuilding}
        onCancelBuilding={() => { setIsAddingBuilding(false); setNewBuildingName(''); setTargetCampusId(null); }}
        onBuildingClick={handleBuildingClick}
        onRenameCampus={handleRenameCampus}
        onDeleteCampus={handleDeleteCampus}
        onRenameBuilding={handleRenameBuilding}
        onDeleteBuilding={handleDeleteBuilding}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10 shrink-0">
          <div className="flex items-center text-sm font-medium text-slate-500 flex-1">
            <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={goHome}>사이트 현황</span>
            {view === 'field' && <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-slate-800 font-bold">서버 현황</span></>}
            {view === 'reviews' && <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-slate-800 font-bold">투자심의 자료</span></>}
            {view === 'incidents' && <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-slate-800 font-bold">장애·유지보수 보고</span></>}
            {view === 'topology' && selectedBuilding && (
              <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => { setSelectedBuilding(null); setSelectedRack(null); setSelectedServer(null); setIsEditing(false); }}>{selectedBuilding.campusName}</span><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-blue-600 cursor-pointer hover:underline" onClick={() => handleBuildingClick(selectedBuilding, {name: selectedBuilding.campusName})}>{selectedBuilding.name}</span></>
            )}
            {view === 'topology' && selectedRack && (
              <><ChevronRight size={16} className="mx-2 text-slate-400" /><span className="text-slate-800 font-bold cursor-pointer hover:text-blue-600 hover:underline" onClick={handleRackNameClick}>{selectedRack.name}</span></>
            )}
          </div>
          <div className="flex-1 max-w-lg mx-4 relative z-50">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Search size={16} className={searchTerm ? 'text-blue-500' : 'text-slate-400'} /></div>
            <input type="text" placeholder="전체 자산 검색 (Hostname, IP, 모델명, S/N) · 랙 + 서버 현황" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-100 border border-slate-200 rounded-full py-2 pl-11 pr-4 text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner" />
            {searchTerm && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[400px] overflow-y-auto animate-in fade-in">
                {globalSearchResults.total + fieldSearchResults.total > 0 ? (
                  <div className="py-1">
                    {globalSearchResults.total > 0 && (
                      <div className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase flex justify-between">
                        <span>랙 장비</span><span>{globalSearchResults.total > 10 ? `${globalSearchResults.total}건 중 10건` : `${globalSearchResults.total}건`}</span>
                      </div>
                    )}
                    {globalSearchResults.items.map((res, idx) => (
                      <div key={`r${idx}`} onClick={() => handleGlobalSearchSelect(res)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex justify-between items-center"><span className="font-bold text-blue-700 font-mono text-sm">{res.server.hostname}</span><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-500 border border-slate-200">{primaryIp(res.server) || 'IP 없음'}</span></div>
                          <div className="flex justify-between items-end"><span className="text-xs text-slate-500">{res.server.model_name}</span><div className="text-[10px] font-medium text-slate-400 flex items-center"><MapPin size={10} className="mr-1" />{res.building.name} {'>'} {res.rack.name} ({res.server.start_u}U)</div></div>
                        </div>
                        <span className="text-[10px] font-bold text-blue-600 shrink-0">이동</span>
                      </div>
                    ))}
                    {fieldSearchResults.total > 0 && (
                      <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-orange-500 uppercase flex justify-between">
                        <span>서버 현황</span><span>{fieldSearchResults.total > 10 ? `${fieldSearchResults.total}건 중 10건` : `${fieldSearchResults.total}건`}</span>
                      </div>
                    )}
                    {fieldSearchResults.items.map(a => (
                      <div key={`f${a.id}`} onClick={() => handleFieldSearchSelect(a)} className="px-4 py-3 hover:bg-orange-50 cursor-pointer border-b border-slate-50 flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex justify-between items-center gap-2">
                            <span className="font-bold text-orange-700 font-mono text-sm truncate">{a.hostname}</span>
                            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-500 border border-slate-200 shrink-0">{fieldIp(a) || 'IP 없음'}</span>
                          </div>
                          <div className="flex justify-between items-end gap-2">
                            <span className="text-xs text-slate-500 truncate">
                              {a.status && <span className={`mr-1.5 px-1 py-px rounded border text-[9px] font-bold ${FIELD_STATUS_STYLE[a.status] || 'bg-slate-100 border-slate-200'}`}>{a.status}</span>}
                              {a.model_name}
                            </span>
                            <div className="text-[10px] font-medium text-slate-400 flex items-center shrink-0"><MapPin size={10} className="mr-1" />{a.complex} {'>'} {a.site_group}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-orange-600 shrink-0">이동</span>
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
          
          {view === 'incidents' ? (
            <IncidentReports showToast={showToast} askDelete={askDelete} />
          ) : view === 'reviews' ? (
            <ReviewDocs showToast={showToast} askDelete={askDelete} />
          ) : view === 'field' ? (
            <FieldAssets showToast={showToast} focusId={fieldFocusId} onFocusHandled={() => setFieldFocusId(null)} askDelete={askDelete}
              onPlaced={() => fetchSiteData(true)} onOpenRack={openRackFromField} />
          ) : !selectedBuilding ? (
            <Dashboard stats={dashboardStats} onOpenStatus={openStatusDrillDown} />
          ) : !selectedRack ? (
            <div className="flex-1 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold text-slate-800 flex items-center"><MapPin className="mr-2 text-blue-500" /> {selectedBuilding.name} 랙(Rack) 구성도</h2></div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {selectedBuilding.racks && selectedBuilding.racks.map(rack => (
                  <div key={rack.id} onClick={() => handleRackClick(rack)} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-400 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 rounded-xl group-hover:bg-blue-100 transition-colors"><Server size={24} className="text-blue-600" /></div><span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm">{rack.total_u_space}U</span></div>
                    <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-800">{rack.name}</h3><span className="flex gap-1"><button onClick={(e) => { e.stopPropagation(); handleRenameRack(rack); }} className="text-slate-400 hover:text-blue-600"><Edit size={14}/></button><button onClick={(e) => { e.stopPropagation(); handleDeleteRack(rack); }} className="text-slate-400 hover:text-red-600"><Trash2 size={14}/></button></span></div>
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
              
              <RackDiagram
                rack={selectedRack}
                servers={filteredServers}
                selectedServerId={selectedServer?.id}
                searchTerm={searchTerm}
                onEmptyUClick={handleEmptyUClick}
                onServerClick={handleServerClick}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onRackNameClick={handleRackNameClick}
                onCopyImage={handleCopyRackImage}
              />

              <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto p-6 xl:p-8 relative">
                {!selectedServer && !isEditing ? (
                  <div className="h-full animate-in fade-in duration-300 flex flex-col">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4 shrink-0">
                      <h2 className="text-xl font-bold text-slate-800 flex items-center"><List className="text-blue-500 mr-2" size={20} /> 랙 자산 및 자원 할당 명세서</h2>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowImport(true)} className="px-3 py-1.5 flex items-center bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-xs font-bold transition-colors shadow-sm">CSV 가져오기</button>
                        <button onClick={handleExportExcel} className="px-3 py-1.5 flex items-center bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold transition-colors shadow-sm" title="CSV 다운로드와 엑셀 붙여넣기용 복사를 함께 수행"><Copy size={14} className="mr-1.5" /> 엑셀 내보내기</button>
<span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full shadow-inner border border-slate-200">총 실장 장비: {(selectedRack.servers?.length || 0)}대</span>
                      </div>
                    </div>

                    {(selectedRack.servers?.length || 0) === 0 ? (
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
                  <ServerForm
                    editForm={editForm}
                    presets={presets}
                    activePort={activePort}
                    portInputValue={portInputValue}
                    setPortInputValue={setPortInputValue}
                    onCancel={handleCancelEdit}
                    onSave={handleSave}
                    onFormChange={handleFormChange}
                    onSavePreset={handleSavePreset}
                    onLoadPreset={handleLoadPreset}
                    onDeletePreset={handleDeletePreset}
                    onPortSave={handlePortSave}
                    renderSwitchPorts={renderSwitchPorts}
                  />
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
          {deleteRequest && (
            <DeleteConfirmModal
              request={deleteRequest}
              defaultUsername={currentUser.isAdmin ? currentUser.username : ''}
              onClose={() => setDeleteRequest(null)}
            />
          )}

          {showImport && selectedRack && (
            <ImportCsvModal
              rack={selectedRack}
              onClose={() => setShowImport(false)}
              onImported={() => fetchSiteData(true)}
              showToast={showToast}
            />
          )}

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
                              <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-mono border">{primaryIp(server) || 'IP 없음'}</span>
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
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono font-bold flex items-center"><UserIcon size={12} className="mr-1" />{hist.user}</span><span className="text-xs text-slate-500 ml-2">{hist.changes?.map(c => c.field).join(', ') || '변경 없음'}</span>
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
