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


def hostname_taken(hostname, exclude_id=None, building=None):
    """같은 건물(현장) 안에서 호스트명이 겹치는지 확인. 현장이 다르면 같은 이름(예: ControlPC)도 허용."""
    qs = ServerAsset.objects.filter(hostname__iexact=hostname.strip())
    if building is not None:
        qs = qs.filter(rack__building=building)
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
    if hostname_taken(hostname, exclude_id, building=rack.building):
        raise ValidationError(f"같은 건물에 같은 호스트명의 장비가 이미 있습니다: {hostname}")

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
            if hostname_taken(hostname, building=rack.building):
                raise ValidationError("같은 건물에 같은 호스트명의 장비가 이미 등록되어 있습니다.")

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
    파일에 없는 기존 장비는 지우지 않는다. ITAM에서 직접 고친 장비(locally_modified)는 건너뛴다.
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
    created = updated = kept = 0
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
                existing = FieldAsset.objects.filter(monday_item_id=mid).first() if mid else None
                if existing and existing.locally_modified:
                    kept += 1  # ITAM에서 고친 장비는 그대로 둔다
                    continue
                if existing:
                    for k, v in values.items():
                        setattr(existing, k, v)
                    existing.save()
                    updated += 1
                else:
                    FieldAsset.objects.create(monday_item_id=mid, **values)
                    created += 1
            except ValidationError as e:
                errors.append({"line": line_no, "hostname": item.get("hostname", ""), "error": str(e)})
        if dry_run:
            transaction.set_rollback(True)
    return {"created": created, "updated": updated, "kept": kept, "errors": errors, "total": len(rows) - 1}


# ---------------------------------------------------------------------------
# 현장 장비 직접 등록/수정, PM 점검 기록
# ---------------------------------------------------------------------------
FIELD_STATUSES = ("가동", "Setup 전", "운영 전환", "확인 필요", "Parts 교체 필요", "유휴 서버 전환", "사용불가", "폐기")
IPMI_STATUSES = ("접속 가능", "접속 불가", "확인 필요", "IP 없음")
HEALTH_VALUES = ("정상", "Fault", "Disable", "")
FIELD_TEXT_KEYS = ("hostname", "site_group", "complex", "product", "status", "model_name", "serial_number",
                   "ipmi_ip", "public_ip", "private_ip", "ipmi_status", "pm_status", "note")


def _choice(value, allowed, label, current=None):
    v = (value or "").strip()
    if v and v not in allowed and v != current:
        raise ValidationError(f"{label} 값이 올바르지 않습니다: '{v}' ({' / '.join(a for a in allowed if a)})")
    return v


def clean_health(data, parts):
    health = {}
    for p in parts:
        v = (data or {}).get(p, "") or ""
        health[p] = _choice(v, HEALTH_VALUES, f"부품 상태({p})")
    return health


def clean_field_asset(data, asset=None):
    """화면에서 장비를 추가/수정할 때의 검증. asset이 있으면 보낸 값만 바꾼다."""
    from .models import FieldAsset
    cur = (lambda k: getattr(asset, k)) if asset else (lambda k: "")
    out = {}
    for k in FIELD_TEXT_KEYS:
        if k in data or not asset:
            out[k] = (data.get(k) or "").strip()
    if "hostname" in out and not out["hostname"]:
        raise ValidationError("Hostname은 필수입니다.")
    if "status" in out:
        out["status"] = _choice(out["status"], FIELD_STATUSES, "상태", cur("status"))
    if "ipmi_status" in out:
        out["ipmi_status"] = _choice(out["ipmi_status"], IPMI_STATUSES, "IPMI 상태", cur("ipmi_status"))
    if "pm_status" in out:
        out["pm_status"] = _choice(out["pm_status"], ("완료", "확인 필요", "미사용"), "PM 상태", cur("pm_status"))
    for k in ("ipmi_ip", "public_ip", "private_ip"):
        # monday에서 온 값은 형식이 제각각이라, 바뀐 경우에만 IP 형식을 검사한다
        if k in out and out[k] and out[k] != cur(k):
            out[k] = normalize_ip_list(out[k])
    for k, label in (("pm_date", "PM 날짜"), ("warranty_end", "워런티 종료")):
        if k in data or not asset:
            out[k] = _parse_date(data.get(k), label)
    if "health" in data or not asset:
        out["health"] = clean_health(data.get("health"), FieldAsset.HEALTH_PARTS)
    out["locally_modified"] = True
    return out


def refresh_asset_pm(asset):
    """가장 최근 PM 기록을 장비의 PM 날짜/상태/부품 상태로 반영한다."""
    latest = asset.pm_records.order_by("-pm_date", "-id").first()
    if latest:
        asset.pm_date = latest.pm_date
        asset.pm_status = latest.pm_status
        asset.health = latest.health
        asset.locally_modified = True
        asset.save()


# ---------------------------------------------------------------------------
# 현장 장비 → 랙 자동(임시) 배치
# ---------------------------------------------------------------------------
# monday 그룹 이름 끝에 붙은 제품명 (그룹 = '현장 + 제품')
PRODUCT_SUFFIXES = ["DMM 25", "MI-MCA", "MiDEWS", "BlueCats", "OPTICA", "AEGIS", "SSAT", "IRIS",
                    "MiOS", "MMS", "DAQ", "ADC", "DM"]
FIELD_STATUS_MAP = {
    "가동": "OPER", "Setup 전": "SETUP", "운영 전환": "SETUP",
    "확인 필요": "MAINT", "Parts 교체 필요": "MAINT", "사용불가": "MAINT",
    "유휴 서버 전환": "IDLE", "폐기": "IDLE",
}
AUTO_RACK_LOCATION = "자동 배치 (임시) - 실제 위치로 옮겨 주세요"
AUTO_RACK_HEIGHT = 42
AUTO_RACK_USABLE = 40  # 맨 위 2U는 스위치 등을 위해 비워 둔다


def site_from_group(group):
    """'P1D MiDEWS' → 'P1D', '1L , 2L ,6L DM' → '1L, 2L, 6L', 'P4  DMM 25' → 'P4'"""
    g = re.sub(r"\s+", " ", (group or "").strip())
    for suffix in PRODUCT_SUFFIXES:
        if g.lower().endswith(" " + suffix.lower()):
            g = g[: -len(suffix)].strip()
            break
    g = re.sub(r"\s*,\s*", ", ", g)
    return g or "현장 미지정"


def guess_asset_type(asset):
    text = f"{asset.hostname} {asset.model_name}".lower()
    if any(k in text for k in ("storage", "unity", "pure", "netapp", "powerscale", "x20", "fas")):
        return "storage"
    if "switch" in text:
        return "switch"
    return "server"


def _clean_ip_for_rack(value):
    """랙 장비의 IP 칸에 넣을 수 있는 값이면 정리해서, 아니면 None."""
    try:
        return normalize_ip_list(value)
    except ValidationError:
        return None


def place_field_assets(dry_run=False):
    """아직 랙에 배치되지 않은 현장 장비를 단지/현장/제품별 랙에 아래(U1)부터 차례로 넣는다.

    캠퍼스=단지, 건물=현장, 랙='{제품}-RACK-NN'. 랙이 차면 다음 번호 랙을 만든다.
    이미 배치한 장비(specs.field_asset_id)는 건너뛰므로 여러 번 실행해도 된다.
    """
    from collections import defaultdict
    from django.db import transaction
    from .models import Building, Campus, FieldAsset, Rack

    placed_ids = {
        str(s.specs.get("field_asset_id")) for s in ServerAsset.objects.only("specs")
        if isinstance(s.specs, dict) and s.specs.get("field_asset_id")
    }
    todo = [a for a in FieldAsset.objects.order_by("complex", "site_group", "hostname") if str(a.id) not in placed_ids]

    groups = defaultdict(list)
    for a in todo:
        groups[(a.complex or "단지 미지정", site_from_group(a.site_group), a.product or "기타")].append(a)

    summary = {"placed": 0, "skipped_already": len(placed_ids), "racks_created": 0,
               "renamed": [], "ip_fixed": [], "racks": []}
    with transaction.atomic():
        for (complex_name, site, product), assets in sorted(groups.items()):
            campus, _ = Campus.objects.get_or_create(name=complex_name)
            building, _ = Building.objects.get_or_create(campus=campus, name=site)
            rack_no, rack, cursor = 0, None, 1
            for a in sorted(assets, key=lambda x: x.hostname.lower()):
                size = guess_size_u(a.model_name)
                # 현재 랙에 자리가 없으면 다음 랙
                while rack is None or cursor + size - 1 > AUTO_RACK_USABLE:
                    rack_no += 1
                    name = f"{product}-RACK-{rack_no:02d}"
                    rack, created = Rack.objects.get_or_create(
                        building=building, name=name,
                        defaults={"location": AUTO_RACK_LOCATION, "total_u_space": AUTO_RACK_HEIGHT})
                    summary["racks_created"] += created
                    used = [s.start_u + (s.size_u or 1) - 1 for s in rack.servers.all() if s.start_u]
                    cursor = max(used, default=0) + 1
                    summary["racks"].append(f"{complex_name} > {site} > {name}")

                hostname, notes = a.hostname.strip(), []
                if hostname_taken(hostname, building=building):
                    n = 2
                    while hostname_taken(f"{hostname} ({n})", building=building):
                        n += 1
                    notes.append(f"monday 원래 이름: {hostname} (같은 현장에 같은 이름이 있어 ({n})을 붙임)")
                    summary["renamed"].append(f"{site}: {hostname} → {hostname} ({n})")
                    hostname = f"{hostname} ({n})"

                specs = {"asset_type": guess_asset_type(a), "serial_number": a.serial_number,
                         "field_asset_id": a.id, "monday_item_id": a.monday_item_id or "",
                         "power_w": "", "public_lan": "", "private_lan": "", "virtual_ip": "", "os_version": ""}
                for src, dst in (("ipmi_ip", "mgmt_ip"), ("public_ip", "public_ip"), ("private_ip", "private_ip")):
                    raw = getattr(a, src) or ""
                    clean = _clean_ip_for_rack(raw) if raw else ""
                    if clean is None:
                        notes.append(f"{src} 원래 값: {raw}")
                        summary["ip_fixed"].append(f"{a.hostname} {src}={raw}")
                        clean = ""
                    specs[dst] = clean

                desc = "\n".join([f"[현장 장비에서 자동 배치] {a.site_group}"] + notes + ([a.note] if a.note else []))
                ServerAsset.objects.create(
                    rack=rack, hostname=hostname, model_name=a.model_name, start_u=cursor, size_u=size,
                    status=FIELD_STATUS_MAP.get(a.status, "WAIT"), description=desc, specs=specs,
                )
                cursor += size
                summary["placed"] += 1
        if dry_run:
            transaction.set_rollback(True)
    summary["racks"] = sorted(set(summary["racks"]))
    return summary
