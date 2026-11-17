"""monday 'WW46 SE파트 주간보고' 문서의 [2026년 장애 및 유지보수] 섹션을 ITAM에 넣는다 (처음 한 번).

실행:  python manage.py shell < scripts/seed_incidents_2026.py
 - 같은 유형·제목의 건이 이미 있으면 건너뛴다 (여러 번 실행해도 중복 안 됨)
 - 건수 표가 문서와 맞도록 'ITAM 이전 완료 건수'도 넣는다 (이미 값이 있으면 그대로 둔다)
"""
from datetime import date

from django.db import transaction

from incidents.models import Incident, IncidentLog, ReportBaseline

Y = 2026


def d(m, day):
    return date(Y, m, day)


# (유형, 제목, 상태, 완료일, [(날짜 또는 None, 들여쓰기, 내용), ...])
DATA = [
    ('FAULT', 'P2F MMS PureStorage F/W 장애', 'WAIT', None, [
        (d(8, 7), 1, 'MMS Storage 확인 중 PureStorage GUI,CLI 접속 불가 확인 - 6.5.x 버전 F/W 버그로 추정'),
        (d(8, 11), 1, '평택 P1-C D/C 내방후 점검 결과 컨트롤러1번 Log풀로 인한 Down 상태 확인 및 Log 삭제 및 Failover후 재부팅으로 컨트롤러1,2번 선조치 완료'),
        (None, 2, '추후 재발 방지를 위해 F/W 업그레이드 필요'),
        (None, 2, '공급사에서 견적을 받아 영업에 공유 및 담당자 전달 완료'),
        (d(9, 9), 2, 'LOG FULL ERROR, MGMT ERROR 관련 벤더사 정보 전달 완료'),
        (d(9, 14), 2, '업데이트 필요 여부 재 전송 완료'),
        (d(9, 30), 2, '영업팀에 항목 재정리 전달 유상건으로 고객사 확정후 진행 가능'),
        (d(10, 14), 2, '고객사 결재 진행중으로 담당자 확인되어 영업팀 컨펌이후 진행 예정'),
    ]),
    ('FAULT', 'P3D DM,MiDEWS PureStorage F/W 장애', 'WAIT', None, [
        (d(8, 14), 1, 'Storage 확인 중 PureStorage GUI 접속 불가 확인 - 6.5.x 버전 F/W 버그로 추정'),
        (None, 1, 'CLI로 접근이 가능하여 1차 점검 완료 스토리지 정상 작동 확인 완료'),
        (d(8, 24), 1, 'GUI 접근 불가 버그 관련 펌웨어 업그레이드 작업 필요'),
        (d(8, 27), 1, '벤더사에서 견적 수신 및 영업에서 담당자 전송 완료'),
        (d(9, 9), 1, 'LOG FULL ERROR, MGMT ERROR 관련 벤더사 정보 전달 완료'),
        (d(9, 30), 1, '영업팀에 항목 재정리 전달 유상건으로 고객사 확정후 진행 가능'),
        (d(11, 10), 1, '고객사 F/W 관련 서비스 코드 발행중'),
    ]),
    ('FAULT', 'P2F DM,MiDEWS PureStorage 캐시 모듈 장애', 'WAIT', None, [
        (d(9, 8), 1, 'P2F DM,MiDEWS PureStorage 점검 중 캐시 모듈 1건 확인'),
        (d(9, 8), 1, '담당자 보고 후 벤더사 견적 요청 완료'),
        (d(9, 9), 1, '영업으로 견적 전달 완료'),
        (d(9, 30), 1, '영업팀에 항목 재정리 전달 유상건으로 고객사 확정후 진행 가능'),
        (d(10, 22), 1, '고객쪽에서 신규 채번 진행 중으로 확인'),
        (d(11, 10), 1, 'NVRAM 사내 입고 / 11/17 납품 및 교체 예정'),
    ]),
    ('FAULT', 'S3 DM MSA 스토리지 Disk 장애', 'WAIT', None, [
        (d(10, 8), 1, 'Disk 견적 요청하여 영업팀 전달'),
        (d(10, 20), 1, 'Disk Failed 추가1건 확인 담당자 인폼 완료'),
        (None, 1, '고객 구매 결정 후 작업 진행 예정'),
    ]),
    ('FAULT', 'MMS Unity380 스토리지 장애', 'HOLD', None, [
        (d(10, 30), 1, 'P2F MMS Unity 스토리지 사용량 95% 확인 및 쓰레스홀드 로그 확인'),
        (None, 2, '실제 OS 에서 사용량은 5~60% 수준이나 스토리지에서 사용량은 95%로 확인'),
        (d(11, 2), 1, '벤더사 문의 결과 Retrim (용량 회수) 로 수동 공간 회수 가능 확인'),
        (None, 2, '해당 작업 진행 결과 OS 용량 회수 필요한 볼륨들이 Retrim이 불가능한 상태로 확인이 되어 작업 진행 불가'),
        (d(11, 5), 2, '해당 Dirty 볼륨 디스크 점검시 DownTime 필요 하여 작업 관련 협의 중'),
    ]),
    ('FAULT', 'NRDK MMS DB 서버 볼륨 증설 간 장애', 'DONE', d(11, 12), [
        (d(11, 12), 1, 'NRD-K MMS DB 서버 볼륨 증설 작업 진행'),
        (None, 1, '진행 이후 MMS Client 비정상 작동 확인'),
        (None, 1, 'DB 리스너 비정상 작동으로 인하여 Client 접속 불가 확인'),
        (None, 1, 'DB 서버 재부팅 후 정상 작동 확인'),
        (None, 1, '로그 및 상태 확인 결과 디스크 관리자가 비정상적 동작을 하였지만 서비스엔 영향을 주지않음'),
        (None, 1, '볼륨 증설엔 문제 없었지만 VMware 로 구성된 DB서버 볼륨 증설에 영향이 있을 것 같다는 예상'),
        (None, 1, '추후 VMware 볼륨 증설에 대한 정확한 문제 발생에 대비 및 작업 시 개발과 함께 작업 하는 것으로 재발 방지 대책이 필요'),
    ]),
    ('FAULT', 'P4 AEGIS SAN Switch 장애', 'WAIT', None, [
        (d(11, 12), 1, '고객 담당자 통하여 P4 AEGIS SAN Switch LED 점등 관련 확인 요청'),
        (None, 1, 'SAN Switch LOG 확인 결과 기준 온도 40도 이상의 열이 발생하여 생긴 LED 점등으로 확인'),
        (None, 1, '11/12 이후 SAN Switch 모니터링을 통하여 정상 범위로 돌아오지 않을 경우 SAN Switch 재부팅 (11/18) 작업 예정'),
    ]),
    ('FAULT', 'SRD DAMS HA 장애', 'WAIT', None, [
        (d(11, 12), 1, 'SRD DAMS HA 이중화 장애 발생'),
        (None, 1, '확인 결과 DAMS Standby 서버 장애로 인하여 HA 비정상 작동 확인'),
        (None, 1, 'Standby 서버 전원 OFF 상태로 인하여 발생한 장애로 확인되며 iLO 접속이 불가능하여 현장 점검 필요'),
        (None, 1, '추후 고객 담당자 확인 후 현장 점검 예정'),
    ]),
    ('MAINT', 'NETAPP 보안 취약점 조치', 'WAIT', None, [
        (d(11, 2), 1, '벤더사로 부터 NETAPP STORAGE 펌웨어 버그로 최신 펌웨어(HF1 버전) 외 GUI 접근 불가 등 보안 취약점 접수'),
        (d(11, 3), 1, 'SYSTEM Manager 를 비활성화시켜 임시 조치 완료'),
        (None, 2, '근본 해결인 F/W 업그레이드는 각 제품별 담당자 인폼 후 날짜 조율 예정'),
        (None, 2, '펌웨어 업그레이드 관련하여 제품별 고객 담당자 부재 및 일정 확정이 안되어 작업 대기 중'),
    ]),
]

# 문서 건수 표: 장애 34, PM(후속 조치) 7, 유지 보수 47 → 위 건을 뺀 나머지는 ITAM 이전에 끝난 건
BASELINE = {'FAULT': 34 - 8, 'PM': 7, 'MAINT': 47 - 1}

added = skipped = 0
with transaction.atomic():
    for kind, title, status, done_on, logs in DATA:
        if Incident.objects.filter(kind=kind, title=title).exists():
            skipped += 1
            continue
        first = next(x[0] for x in logs if x[0])
        inc = Incident.objects.create(kind=kind, title=title, status=status, occurred_on=first, done_on=done_on)
        IncidentLog.objects.bulk_create([
            IncidentLog(incident=inc, date=dt, level=lv, text=tx, order=n)
            for n, (dt, lv, tx) in enumerate(logs, start=1)])
        added += 1
    for kind, n in BASELINE.items():
        ReportBaseline.objects.get_or_create(year=Y, kind=kind, defaults={'done_before': n})

print(f'장애·유지보수 {added}건 추가, {skipped}건은 이미 있어 건너뜀')
for kind, label in Incident.KIND_CHOICES:
    b = ReportBaseline.objects.filter(year=Y, kind=kind).first()
    print(f'  {label}: ITAM 이전 완료 {b.done_before if b else 0}건')
