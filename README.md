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
| `MONDAY_API_TOKEN` | (없음) | 장애·유지보수 보고 → monday 주간보고 반영용 토큰. 없으면 '글 복사'만 됩니다 |
| `MONDAY_REPORT_BOARD_ID` | `5333463389` | 주간보고 보드 (SE파트 주간 보고) |
| `MONDAY_DOC_COLUMN_ID` | `monday_doc` | 보드에서 주간보고 문서가 연결된 칸 |
| `MONDAY_API_URL` / `MONDAY_API_VERSION` | `https://api.monday.com/v2` / (기본) | 보통 바꿀 일 없음 |

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

화면: 현장 장비 화면의 **랙에 배치 (미배치 N대)** 버튼 → 결과 확인 → 배치. 서버 명령으로도 할 수 있습니다.

```bash
python manage.py place_field_assets --dry-run   # 어떻게 배치될지 확인만
python manage.py place_field_assets             # 실제 배치
```

- 캠퍼스 = 단지, 건물 = 현장(monday 그룹에서 제품명을 뺀 부분), 랙 = `{제품}-RACK-01` (42U, U1부터 차례로, 맨 위 2U 비움)
- 랙이 차면 `-02` 랙을 새로 만듭니다. 이미 배치한 장비는 건너뛰므로 다시 실행해도 중복되지 않습니다.
- 같은 현장에 같은 호스트명이 있으면 ` (2)`를 붙이고, 형식이 맞지 않는 IP는 비워 둔 채 설명란에 원래 값을 남깁니다.
- 호스트명 중복 검사는 **같은 건물 안**에서만 합니다. (현장이 다르면 ControlPC 같은 같은 이름 허용)
- 배치한 뒤 현장 장비에서 고친 **호스트명·모델·상태·S/N·IP**는 랙 장비에도 반영됩니다. 랙 위치·크기·전력·LAN은 랙 화면에서 따로 관리합니다.
- 현장 장비 상세의 **랙 위치 → 랙에서 보기**로 해당 랙으로 이동합니다.
- 랙 장비를 지우면 그 현장 장비는 다시 '미배치'로 표시됩니다.

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

## 투자심의 자료 (ADB-Doc)

왼쪽 메뉴 **Docs → 투자심의 자료**에서 심의 PPT와 배포용 엑셀을 만듭니다. PC용 `InvestPPT.exe`(make_ppt.py)와 같은 엔진(`reviews/engine/make_ppt.py`)을 서버에서 돌리므로, 각자 PC에 exe를 깔 필요가 없습니다.

1. **PPT 템플릿 올리기** (처음 한 번): 심의건 화면 위쪽 'PPT 템플릿'에서 `.pptx`를 올립니다.
2. **새 심의건**: 구매 사양 엑셀(.xlsm/.xlsx)을 올리면 업무명을 엑셀에서 읽어 옵니다.
3. **PPT 만들기**: PPT와 배포용 엑셀(매크로 제거)이 만들어지고, 만든 기록이 남습니다.

**기준정보 (이름 관리자)** 탭: 심의 매크로 엑셀의 이름 관리자 내용(품목 CIS 코드, 선택 목록, CPU 사양)을 DB로 가져옵니다. 화면에서 매크로 엑셀을 올리거나 명령어로 가져올 수 있습니다.

```bash
python manage.py import_review_master 26년라인명_제품_투자심의_매크로_V3.xlsm --dry-run   # 바뀔 내용만 확인
python manage.py import_review_master 26년라인명_제품_투자심의_매크로_V3.xlsm
```

- 올린 파일과 만든 파일은 `media/` 폴더(환경변수 `DJANGO_MEDIA_ROOT`로 바꿀 수 있음)에 저장됩니다. **백업할 때 `db.sqlite3`와 함께 `media/` 폴더도 챙겨 주세요.**
- PC용 make_ppt.py를 고치면 `reviews/engine/make_ppt.py`도 같은 파일로 바꿔 주세요.
- 회사 보안(DRM)이 걸린 엑셀은 서버에서 열 수 없으니 해제 후 올려야 합니다.

## 장애·유지보수 보고 (monday 주간보고 반영)

사이드바 **Docs → 장애·유지보수 보고**에서 장애 / PM(후속 조치) / 유지 보수 건을 입력하고, 건마다 날짜별 진행 기록을 쌓습니다.
**주간보고 반영**을 누르면 monday 'SE파트 주간 보고' 보드에서 이번 주 아이템(이름에 `WW47` 등)을 찾아, 연결된 문서의
**「[20xx년 장애 및 유지보수]」 섹션만** 새 내용으로 바꿉니다. 다른 섹션은 건드리지 않습니다.

- 섹션 범위: '장애 및 유지보수' 제목 다음 줄부터, 그다음 `[`로 시작하는 큰·중간 제목(예: `[심의 & H/W SPEC 산정]`) 앞까지
- 들어가는 내용: 건수 표(올해 총 건수·진행 중·완료·보류 및 대기) + 건별 줄 `[장애] 제목 | 상태`, 그 아래 `(MM/DD) 진행 내용`
  - 넣는 건: 끝나지 않은 건 전부 + 최근 7일 안에 끝난 건 ('주간보고에 넣지 않기' 체크한 건 제외)
  - 최근 7일 진행 기록은 초록 배경, 상태는 초록 굵은 글씨 (지금 문서 서식과 같게)
- 안전장치
  - 반드시 **미리보기 → 반영** 순서. 미리보기 뒤 누가 그 섹션을 고쳤으면 반영하지 않고 다시 미리보기를 하라고 알려 줍니다
  - 새 내용을 먼저 넣고 다 들어간 뒤 옛 내용을 지웁니다. 넣다가 실패하면 넣은 것만 도로 지워 문서는 그대로 둡니다
  - 반영 기록(누가, 언제, 어느 문서, 결과)은 화면과 관리자 페이지에 남습니다
- 처음 한 번: 목록이 비어 있으면 **monday 문서에서 가져오기**로 지금 문서의 건·기록을 옮길 수 있습니다.
  이때 'ITAM 이전 완료 건수'(문서 표 총 건수 − 가져오는 건수)를 저장해 두어 건수 표가 문서와 맞게 이어집니다

### 토큰 설정 (서버)

monday 오른쪽 위 프로필 → **Developers → My access tokens**에서 토큰을 복사합니다 (주간보고 보드·문서를 고칠 수 있는 계정).
토큰은 저장소에 넣지 말고 서버에만 둡니다.

```bash
sudo mkdir -p /etc/itam
echo 'MONDAY_API_TOKEN=여기에_토큰' | sudo tee /etc/itam/monday.env
sudo chmod 600 /etc/itam/monday.env
sudo cp deploy/itam.service /etc/systemd/system/itam.service   # EnvironmentFile 줄이 들어간 새 유닛
sudo systemctl daemon-reload && sudo systemctl restart itam
python manage.py migrate     # incidents 표 생성 (처음 한 번)
```

ITAM 서버에서 `api.monday.com`(HTTPS 443)으로 나갈 수 있어야 합니다. 막혀 있으면 화면에 연결 실패 안내가 뜨고,
그동안은 반영 창의 **글 복사**로 붙여 넣으면 됩니다.

