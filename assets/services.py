"""장비 배치/입력값 검증과 CSV 가져오기 로직.

뷰(views.py)는 요청/응답만 다루고, 실제 규칙은 여기에 모아 둔다.
화면 입력, API 호출, CSV 가져오기가 모두 같은 규칙을 거치게 하기 위함.
"""
import csv
import io
import ipaddress
import re

from .models import ServerAsset

# ---------------------------------------------------------------------------
# 모델 → U 크기 추정 (모델명이 이 키워드를 포함하면 해당 U로 판단)
# ---------------------------------------------------------------------------
MODEL_SIZE_MAP = [
    ("R760XA", 2), ("R760", 2), ("R660XS", 1), ("R660", 1), ("R7715", 2), ("R470", 1), ("R360", 1),
    ("DL380", 2), ("DL360", 1), ("DL320", 1), ("DL20", 1),
    ("A400", 4), ("A250", 2), ("FAS2820", 2), ("FAS7200", 6),
    ("UNITY380", 2), ("POWERSCALE", 4), ("H700", 4), ("X20", 3),
    ("MDS9148", 1), ("MDS9132", 1), ("S5148", 1), ("S4148", 1), ("S5248", 1), ("S3248", 1),
    ("JL814A", 1), ("7010TX", 1), ("7050SX", 1), ("THUNDER", 1), ("CL5716", 1),
    ("R650", 1), ("R750", 2), ("R2500", 1), ("EF300", 2), ("KVM", 1),
]


def guess_size_u(model_name):
    name = (model_name or "").upper().replace(" ", "").replace("-", "").replace("_", "")
    for key, size in MODEL_SIZE_MAP:
        if key in name:
            return size
    return 1


STATUS_CODES = {code for code, _ in ServerAsset.STATUS_CHOICES}
# CSV에 한글 상태명으로 적어도 인식되도록
STATUS_ALIASES = {label.replace(" ", ""): code for code, label in ServerAsset.STATUS_CHOICES}
STATUS_ALIASES.update({"입고대기": "WAIT", "셋업": "SETUP", "운영": "OPER", "장애": "MAINT", "수리": "MAINT", "유휴": "IDLE", "폐기": "IDLE"})

ASSET_TYPES = {"server", "storage", "switch"}
IP_FIELDS = ("public_ip", "virtual_ip", "private_ip", "mgmt_ip")


class ValidationError(Exception):
    pass


# ---------------------------------------------------------------------------
# 공통 검증
# ---------------------------------------------------------------------------
def to_int(value, field_label, required=False, minimum=None):
    if value is None or str(value).strip() == "":
        if required:
            raise ValidationError(f"{field_label} 값이 필요합니다.")
        return None
    text = re.sub(r"(?i)\s*(u|w|ea)$", "", str(value).strip())
    try:
        number = int(float(text))
    except ValueError:
        raise ValidationError(f"{field_label}은(는) 숫자여야 합니다: '{value}'")
    if minimum is not None and number < minimum:
        raise ValidationError(f"{field_label}은(는) {minimum} 이상이어야 합니다.")
    return number


def placement_error(rack, start_u, size_u, exclude_id=None, extra=()):
    """랙 높이 초과 / 다른 장비와 겹침을 검사. 문제가 없으면 None.

    extra: 아직 저장되지 않은 (이름, start, size) 목록 (CSV 안의 앞 행들)
    """
    end_u = start_u + size_u - 1
    total = rack.total_u_space or 42
    if start_u < 1:
        return "시작 U는 1 이상이어야 합니다."
    if end_u > total:
        return f"랙 높이({total}U)를 벗어납니다. (U{start_u}~U{end_u})"

    others = [
        (s.hostname or s.model_name or "이름 없음", s.start_u, s.size_u or 1)
        for s in rack.servers.exclude(id=exclude_id)
        if s.start_u is not None
    ]
    for name, s_start, s_size in list(others) + list(extra):
        s_end = s_start + s_size - 1
        if start_u <= s_end and end_u >= s_start:
            return f"[{name}] 장비(U{s_start}~U{s_end})와 위치가 겹칩니다."
    return None


def hostname_taken(hostname, exclude_id=None):
    qs = ServerAsset.objects.filter(hostname__iexact=hostname.strip())
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.exists()


def normalize_ip_list(value):
    """'1.1.1.1; 2.2.2.2' / 줄바꿈 / 쉼표 → '1.1.1.1, 2.2.2.2'. 잘못된 IP는 ValidationError."""
    parts = [p.strip() for p in re.split(r"[,;\s]+", value or "") if p.strip()]
    for p in parts:
        try:
            ipaddress.ip_interface(p)  # 10.0.0.1 과 10.0.0.1/24 모두 허용
        except ValueError:
            raise ValidationError(f"IP 형식이 올바르지 않습니다: '{p}'")
    return ", ".join(parts)


def split_ips(value):
    return [p.strip().split("/")[0] for p in re.split(r"[,;\s]+", value or "") if p.strip()]


def normalize_os(data, specs):
    """OS 버전은 모델 필드(os_version)가 기준. 화면 호환을 위해 specs에도 같은 값을 둔다."""
    os_version = (data.get("os_version") or specs.get("os_version") or "").strip()
    specs["os_version"] = os_version
    return os_version


def validate_server_payload(rack, data, exclude_id=None):
    """화면/API에서 장비를 저장할 때 쓰는 검증. 정리된 값 dict를 돌려준다."""
    hostname = (data.get("hostname") or "").strip()
    if not hostname:
        raise ValidationError("Hostname은 필수입니다.")
    if hostname_taken(hostname, exclude_id):
        raise ValidationError(f"같은 호스트명의 장비가 이미 있습니다: {hostname}")

    start_u = to_int(data.get("start_u"), "시작 U", required=True, minimum=1)
    size_u = to_int(data.get("size_u"), "크기(U)", minimum=1) or guess_size_u(data.get("model_name"))
    err = placement_error(rack, start_u, size_u, exclude_id=exclude_id)
    if err:
        raise ValidationError(err)

    status = data.get("status") or "WAIT"
    if status not in STATUS_CODES:
        raise ValidationError(f"알 수 없는 상태값입니다: {status}")

    specs = dict(data.get("specs") or {})
    for field in IP_FIELDS:
        if specs.get(field):
            specs[field] = normalize_ip_list(specs[field])
    os_version = normalize_os(data, specs)

    return {
        "hostname": hostname,
        "start_u": start_u,
        "size_u": size_u,
        "status": status,
        "specs": specs,
        "os_version": os_version,
    }


# ---------------------------------------------------------------------------
# CSV 가져오기
# ---------------------------------------------------------------------------
# (내부 키, 한글 설명, 예시값, 인식할 열 이름들)
CSV_COLUMNS = [
    ("hostname", "호스트명 (필수)", "kr-gh-web01", ["호스트명", "호스트", "host"]),
    ("model_name", "모델명", "PowerEdge R660", ["model", "모델", "모델명", "product"]),
    ("asset_type", "장비 종류 server/storage/switch", "server", ["type", "종류", "장비종류"]),
    ("status", "상태 WAIT/SETUP/OPER/MAINT/IDLE", "OPER", ["상태"]),
    ("start_u", "시작 U (장비의 가장 아래 U, 필수)", "40", ["start", "시작u", "u", "위치"]),
    ("size_u", "크기 U (비우면 모델명으로 추정)", "1", ["size", "크기", "높이"]),
    ("setup_year", "도입년도", "2025", ["year", "도입년도"]),
    ("os_version", "OS 버전", "Ubuntu 22.04 LTS", ["os", "운영체제"]),
    ("serial_number", "시리얼 번호", "ABC1234", ["serial", "시리얼", "s/n", "sn"]),
    ("cpu", "CPU", "Xeon Gold 6430 x2", []),
    ("ram", "메모리", "512GB", ["memory", "메모리"]),
    ("storage", "스토리지/디스크", "1.92TB SSD x4", ["disk", "디스크"]),
    ("gpu", "GPU", "", []),
    ("power_w", "소비전력 W (숫자)", "800", ["power", "전력", "전기"]),
    ("public_lan", "Public LAN 포트 수", "2", ["lan", "publiclan", "pub_lan"]),
    ("private_lan", "Private LAN 포트 수", "2", ["privatelan", "priv_lan", "private"]),
    ("public_ip", "Public IP (여러 개면 ; 로 구분)", "203.0.113.11", ["publicip", "p.ip", "pip"]),
    ("virtual_ip", "Virtual IP (여러 개면 ; 로 구분)", "", ["virtualip", "vip", "v.ip"]),
    ("private_ip", "Private IP", "10.10.1.11", ["privateip"]),
    ("mgmt_ip", "관리 IP (iDRAC/iLO)", "10.99.1.11", ["mgmt", "mgmtip", "관리ip", "idrac", "ilo"]),
    ("description", "용도/설명", "웹 서버", ["desc", "설명", "용도", "비고"]),
]
SPEC_KEYS = ["asset_type", "serial_number", "cpu", "ram", "storage", "gpu",
             "power_w", "public_lan", "private_lan", *IP_FIELDS]


def _norm_header(h):
    return re.sub(r"[\s_\-()]", "", (h or "").strip().lstrip("﻿").lower())


HEADER_MAP = {}
for key, _label, _ex, aliases in CSV_COLUMNS:
    for name in [key, *aliases]:
        HEADER_MAP.setdefault(_norm_header(name), key)


def template_csv():
    """BOM 포함 UTF-8 (엑셀에서 바로 열어도 한글이 깨지지 않음)."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([c[0] for c in CSV_COLUMNS])
    writer.writerow([c[2] for c in CSV_COLUMNS])
    return "﻿" + out.getvalue()


def decode_csv(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValidationError("파일 인코딩을 읽을 수 없습니다. 엑셀에서 'CSV UTF-8' 형식으로 저장해 주세요.")


def parse_csv(raw: bytes):
    """CSV를 읽어 (행 dict 목록, 인식 못한 열 목록) 반환."""
    text = decode_csv(raw)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        raise ValidationError("CSV 파일이 비어 있습니다.")

    header = rows[0]
    keys = [HEADER_MAP.get(_norm_header(h)) for h in header]
    if "hostname" not in keys:
        raise ValidationError("첫 줄에 hostname 열이 없습니다. 양식을 내려받아 열 이름을 확인해 주세요.")
    unknown = [h for h, k in zip(header, keys) if k is None and h.strip()]

    parsed = []
    for line_no, cols in enumerate(rows[1:], start=2):
        item = {}
        for k, v in zip(keys, cols):
            if k and k not in item:
                item[k] = v.strip()
        parsed.append((line_no, item))
    return parsed, unknown


def _existing_ip_owners():
    owners = {}
    for s in ServerAsset.objects.only("id", "hostname", "specs"):
        for field in ("public_ip", "private_ip", "mgmt_ip"):
            for ip in split_ips((s.specs or {}).get(field, "")):
                owners.setdefault(ip, s.hostname or f"#{s.id}")
    return owners


def validate_import(rack, parsed_rows):
    """각 행을 검증해 저장할 값(data)과 오류/경고를 붙여 돌려준다. 저장은 하지 않음."""
    results = []
    seen_hosts = {}
    placed = []  # 이 파일 안에서 앞서 배치된 (이름, start, size)
    ip_owners = _existing_ip_owners()

    for line_no, row in parsed_rows:
        errors, warnings = [], []
        hostname = row.get("hostname", "")
        data = None
        try:
            if not hostname:
                raise ValidationError("hostname이 비어 있습니다.")
            if hostname.lower() in seen_hosts:
                raise ValidationError(f"파일 안에서 {seen_hosts[hostname.lower()]}행과 호스트명이 중복됩니다.")
            if hostname_taken(hostname):
                raise ValidationError("같은 호스트명의 장비가 이미 등록되어 있습니다.")

            start_u = to_int(row.get("start_u"), "start_u", required=True, minimum=1)
            size_u = to_int(row.get("size_u"), "size_u", minimum=1)
            if size_u is None:
                size_u = guess_size_u(row.get("model_name"))
                warnings.append(f"size_u가 비어 있어 모델명으로 {size_u}U로 추정했습니다.")
            err = placement_error(rack, start_u, size_u, extra=placed)
            if err:
                raise ValidationError(err)

            raw_status = (row.get("status") or "WAIT").strip()
            status = raw_status.upper() if raw_status.upper() in STATUS_CODES else STATUS_ALIASES.get(raw_status.replace(" ", ""))
            if not status:
                raise ValidationError(f"알 수 없는 상태값: '{raw_status}' (WAIT/SETUP/OPER/MAINT/IDLE 중 하나)")

            asset_type = (row.get("asset_type") or "server").strip().lower()
            if asset_type not in ASSET_TYPES:
                raise ValidationError(f"알 수 없는 장비 종류: '{asset_type}' (server/storage/switch 중 하나)")

            for f, label in (("power_w", "power_w"), ("public_lan", "public_lan"), ("private_lan", "private_lan")):
                n = to_int(row.get(f), label, minimum=0)
                row[f] = "" if n is None else str(n)

            setup_year = (row.get("setup_year") or "").strip()
            if setup_year and not re.fullmatch(r"\d{4}", setup_year):
                raise ValidationError(f"setup_year는 4자리 연도여야 합니다: '{setup_year}'")

            for f in IP_FIELDS:
                row[f] = normalize_ip_list(row.get(f, ""))
                if f == "virtual_ip":
                    continue  # VIP는 이중화 장비끼리 공유할 수 있어 중복 검사 제외
                for ip in split_ips(row[f]):
                    if ip in ip_owners:
                        warnings.append(f"{f} {ip}는 [{ip_owners[ip]}]에서 이미 사용 중입니다.")

            specs = {k: row.get(k, "") for k in SPEC_KEYS}
            specs["asset_type"] = asset_type
            specs["os_version"] = row.get("os_version", "")
            data = {
                "hostname": hostname,
                "model_name": row.get("model_name", ""),
                "status": status,
                "start_u": start_u,
                "size_u": size_u,
                "setup_year": setup_year,
                "description": row.get("description", ""),
                "os_version": row.get("os_version", ""),
                "specs": specs,
            }
            seen_hosts[hostname.lower()] = line_no
            placed.append((hostname, start_u, size_u))
            for f in ("public_ip", "private_ip", "mgmt_ip"):
                for ip in split_ips(row[f]):
                    ip_owners.setdefault(ip, hostname)
        except ValidationError as e:
            errors.append(str(e))

        results.append({
            "line": line_no,
            "hostname": hostname,
            "model_name": row.get("model_name", ""),
            "start_u": row.get("start_u", ""),
            "size_u": data["size_u"] if data else row.get("size_u", ""),
            "status": data["status"] if data else row.get("status", ""),
            "errors": errors,
            "warnings": warnings,
            "data": data,
        })
    return results


# ---------------------------------------------------------------------------
# 현장 장비 (monday PM 현황 스냅샷) 가져오기
# ---------------------------------------------------------------------------
FIELD_COLUMNS = {
    # 내부 키: 인식할 열 이름들 (영문 키 / monday 열 제목)
    "monday_item_id": ["monday_item_id", "monday ID", "item id", "id"],
    "hostname": ["hostname", "name", "호스트명"],
    "site_group": ["group", "그룹", "그룹(현장/제품)", "site_group"],
    "complex": ["complex", "단지"],
    "product": ["product", "제품명", "제품"],
    "status": ["status", "상태"],
    "model_name": ["model", "model_name", "모델"],
    "serial_number": ["serial_number", "s/n", "sn", "시리얼"],
    "ipmi_ip": ["ipmi_ip", "ipmi ip"],
    "public_ip": ["public_ip", "public ip"],
    "private_ip": ["private_ip", "private ip"],
    "ipmi_status": ["ipmi_status", "ipmi 상태"],
    "pm_date": ["pm_date", "pm 날짜"],
    "pm_status": ["pm_status", "pm 상태"],
    "warranty_end": ["warranty_end", "워런티 종료", "워런티종료"],
    "cpu": ["cpu"], "memory": ["memory"], "network": ["network"], "disk": ["disk"],
    "fans": ["fans"], "cache_battery": ["cache_battery", "cache battery"],
    "note": ["note", "비고"],
}
FIELD_HEADER_MAP = {_norm_header(a): k for k, aliases in FIELD_COLUMNS.items() for a in aliases}


def _parse_date(value, label):
    from datetime import date
    v = (value or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        raise ValidationError(f"{label} 날짜 형식이 올바르지 않습니다: '{v}' (YYYY-MM-DD)")


def import_field_assets(raw: bytes, dry_run=False):
    """monday에서 내보낸 PM 현황 CSV를 현장 장비로 반영한다.

    monday ID가 같은 장비는 갱신, 없으면 새로 만든다. (호스트명은 현장마다 겹칠 수 있어 기준으로 쓰지 않음)
    파일에 없는 기존 장비는 지우지 않는다.
    """
    from django.db import transaction
    from django.utils import timezone
    from .models import FieldAsset

    text = decode_csv(raw)
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        raise ValidationError("CSV 파일이 비어 있습니다.")
    keys = [FIELD_HEADER_MAP.get(_norm_header(h)) for h in rows[0]]
    if "hostname" not in keys:
        raise ValidationError("hostname(또는 Hostname) 열이 없습니다. monday에서 받은 PM 현황 파일인지 확인해 주세요.")

    now = timezone.now()
    created = updated = 0
    errors = []
    with transaction.atomic():
        for line_no, cols in enumerate(rows[1:], start=2):
            item = {}
            for k, v in zip(keys, cols):
                if k and k not in item:
                    item[k] = v.strip()
            try:
                if not item.get("hostname"):
                    raise ValidationError("hostname이 비어 있습니다.")
                values = {
                    k: item.get(k, "") for k in (
                        "hostname", "site_group", "complex", "product", "status", "model_name",
                        "serial_number", "ipmi_ip", "public_ip", "private_ip", "ipmi_status", "pm_status", "note")
                }
                values["pm_date"] = _parse_date(item.get("pm_date"), "PM 날짜")
                values["warranty_end"] = _parse_date(item.get("warranty_end"), "워런티 종료")
                values["health"] = {p: item.get(p, "") for p in FieldAsset.HEALTH_PARTS}
                values["imported_at"] = now
                mid = item.get("monday_item_id") or None
                if mid:
                    _, was_created = FieldAsset.objects.update_or_create(monday_item_id=mid, defaults=values)
                else:
                    FieldAsset.objects.create(**values)
                    was_created = True
                created += was_created
                updated += not was_created
            except ValidationError as e:
                errors.append({"line": line_no, "hostname": item.get("hostname", ""), "error": str(e)})
        if dry_run:
            transaction.set_rollback(True)
    return {"created": created, "updated": updated, "errors": errors, "total": len(rows) - 1}
