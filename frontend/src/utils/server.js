// 장비에 기록된 IP 필드들. specs.ip는 예전 데이터 호환용.
const IP_FIELDS = ['mgmt_ip', 'public_ip', 'private_ip', 'virtual_ip', 'ip'];

export const serverIps = (server) =>
  IP_FIELDS.flatMap(f => String(server?.specs?.[f] || '').split(/[,;\s]+/)).filter(Boolean);

// 목록에 한 줄로 보여줄 대표 IP (관리 IP 우선)
export const primaryIp = (server) => serverIps(server)[0] || '';

// 호스트명 / 모델명 / 모든 IP 중 하나라도 검색어를 포함하면 true
export const matchesSearch = (server, term) => {
  const t = (term || '').trim().toLowerCase();
  if (!t) return false;
  return (server.hostname || '').toLowerCase().includes(t)
    || (server.model_name || '').toLowerCase().includes(t)
    || String(server.specs?.serial_number || '').toLowerCase().includes(t)
    || serverIps(server).some(ip => ip.includes(t));
};

// 현장 장비(PM) 검색: 호스트명 / 모델 / S/N / 현장 / IP
export const fieldIp = (asset) => asset.ipmi_ip || asset.public_ip || asset.private_ip || '';

export const matchesFieldSearch = (asset, term) => {
  const t = (term || '').trim().toLowerCase();
  if (!t) return false;
  return [asset.hostname, asset.model_name, asset.serial_number, asset.site_group,
    asset.ipmi_ip, asset.public_ip, asset.private_ip]
    .some(v => (v || '').toLowerCase().includes(t));
};
