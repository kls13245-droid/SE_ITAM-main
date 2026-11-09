# SE_ITAM

IT 자산 관리 시스템 (Django + React)

## 실행

### 백엔드
```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
```

### 프론트엔드
```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DJANGO_SECRET_KEY` | insecure default | 운영 시 반드시 변경 |
| `DJANGO_DEBUG` | `True` | 운영 시 `False` |
| `DJANGO_ALLOWED_HOSTS` | `*` | 예: `192.168.70.250,localhost` |
| `CSRF_TRUSTED_ORIGINS` | localhost/250:5173 | 프론트 화면 주소 목록 (쉼표 구분). **화면을 여는 주소가 여기에 없으면 저장·삭제가 403으로 막힙니다.** CORS 허용 목록으로도 쓰입니다 |
| `FRONTEND_URL` | `/` | 관리자 페이지 '사이트 보기' 링크 |
| `VITE_API_URL` | `http://192.168.70.250:8000` | 프론트 API 주소 |

## 인증

로그인 후 세션 쿠키로 API를 보호합니다. 프론트는 `credentials: 'include'`로 요청합니다.
저장·삭제 요청은 CSRF 토큰(`X-CSRFToken` 헤더)이 있어야 합니다. 프론트는 시작할 때 `/api/csrf/`에서 토큰을 받습니다.

### 삭제 (관리자 확인)
캠퍼스·건물·랙·장비·현장 장비를 지울 때는 경고 창에서 **관리자(staff) 아이디와 비밀번호**를 입력해야 합니다.
- 관리자 = Django 관리자 페이지에 들어갈 수 있는 계정 (`createsuperuser`로 만든 계정 또는 관리자 페이지에서 '스태프 권한'을 준 계정)
- 일반 사용자로 로그인했어도 관리자가 자기 계정을 입력하면 삭제됩니다.
- 랙·건물·캠퍼스를 지우면 안에 있는 장비도 함께 지워집니다.
- 비밀번호를 5번 틀리면 5분 동안 삭제가 막힙니다. (PM 점검 기록 삭제는 확인 창만)

## CSV 가져오기

랙 화면의 **CSV 가져오기** → 파일 선택 → 검사 결과 확인 → 확정 순서로 동작합니다.
양식은 같은 창의 **양식 내려받기**(`/api/server/import/template/`)에서 받을 수 있습니다.

- 필수: `hostname`, `start_u`(장비의 가장 아래 U)
- U 겹침·랙 높이 초과·호스트명 중복·잘못된 상태값/IP가 있는 행은 저장하지 않고 이유를 보여줍니다.
- 이미 다른 장비가 쓰는 IP는 경고로만 표시합니다. (Virtual IP는 검사하지 않음)
- 한글 열 이름(호스트명, 모델명, 시작U 등)과 엑셀 기본 CSV(CP949)도 읽습니다.

## 현장 장비 (PM)

고객사 현장에 설치된 장비 목록입니다. 랙 실장도와는 따로 관리합니다. 왼쪽 메뉴 **현장 장비 (PM)**에서 볼 수 있습니다.
데이터는 monday 'SE파트 - PM 현황' 보드에서 내보낸 CSV를 가져옵니다. (자동 연동은 아직 없음)

- 화면의 **등록 양식**으로 빈 양식(monday PM 현황과 같은 열)을 받아 작성한 뒤 **CSV로 등록**, 또는 서버에서:
  ```bash
  python manage.py import_field_assets monday_PM현황_20261109.csv --dry-run   # 확인만
  python manage.py import_field_assets monday_PM현황_20261109.csv
  ```
- monday ID가 없는 행은 새 장비로 등록합니다. **같은 현장(그룹)에 같은 호스트명**이 이미 있거나 파일 안에서 겹치면 중복으로 건너뜁니다.
- monday ID가 있는 행은 같은 ID의 장비를 갱신하고, 파일에 없는 장비는 지우지 않습니다.
- 상태·IPMI 상태·PM 상태·부품 상태·날짜가 정해진 값이 아니면 그 행은 오류로 제외됩니다.
- 호스트명·IP는 현장마다 겹칠 수 있어 중복 검사를 하지 않습니다.
- **장비 추가 / 정보 수정**: 화면의 *장비 추가* 버튼, 장비 상세의 연필 아이콘
- **PM 점검 기록**: 장비 상세 → *점검 기록 추가* (점검일·결과·부품 상태·작업자·작업 내용). 가장 최근 기록이 목록의 PM 날짜/상태/부품 상태로 반영됩니다.
- ITAM에서 수정했거나 점검 기록을 남긴 장비에는 `ITAM` 표시가 붙고, monday CSV를 다시 가져와도 덮어쓰지 않습니다.

## 현장 장비를 랙에 임시 배치

현장 장비(PM)를 랙 실장도에 자동으로 넣습니다. 위치는 임시이므로, 실제 위치는 화면에서 드래그해 옮기면 됩니다.

```bash
python manage.py place_field_assets --dry-run   # 어떻게 배치될지 확인만
python manage.py place_field_assets             # 실제 배치
```

- 캠퍼스 = 단지, 건물 = 현장(monday 그룹에서 제품명을 뺀 부분), 랙 = `{제품}-RACK-01` (42U, U1부터 차례로, 맨 위 2U 비움)
- 랙이 차면 `-02` 랙을 새로 만듭니다. 이미 배치한 장비는 건너뛰므로 다시 실행해도 중복되지 않습니다.
- 같은 현장에 같은 호스트명이 있으면 ` (2)`를 붙이고, 형식이 맞지 않는 IP는 비워 둔 채 설명란에 원래 값을 남깁니다.
- 호스트명 중복 검사는 **같은 건물 안**에서만 합니다. (현장이 다르면 ControlPC 같은 같은 이름 허용)

## 테스트

```bash
python manage.py test assets
```


## 운영 배포 (gunicorn + Nginx)

### 1. 프론트 빌드
```bash
cd frontend
npm install
npm run build
```
`VITE_API_URL`을 비우면 같은 주소의 `/api`를 사용합니다.

### 2. 백엔드
```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3
```

환경변수 예:
```bash
export DJANGO_DEBUG=False
export DJANGO_ALLOWED_HOSTS=192.168.70.250,localhost
export CSRF_TRUSTED_ORIGINS=http://192.168.70.250
export DJANGO_SECRET_KEY=임의-긴-문자열
```

### 3. Nginx
`deploy/nginx.conf`를 서버 경로에 맞게 복사합니다.
- API `/api/` → gunicorn `127.0.0.1:8000`
- 화면 `/` → `frontend/dist`

### 4. systemd
`deploy/itam.service`를 `/etc/systemd/system/`에 넣고
```bash
systemctl daemon-reload
systemctl enable --now itam
```
