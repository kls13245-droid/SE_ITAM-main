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

- 화면의 **monday CSV 가져오기** 또는 서버에서:
  ```bash
  python manage.py import_field_assets monday_PM현황_20261109.csv --dry-run   # 확인만
  python manage.py import_field_assets monday_PM현황_20261109.csv
  ```
- monday 항목 ID가 같은 장비는 갱신하고, 파일에 없는 장비는 지우지 않습니다.
- 호스트명·IP는 현장마다 겹칠 수 있어 중복 검사를 하지 않습니다.
- **장비 추가 / 정보 수정**: 화면의 *장비 추가* 버튼, 장비 상세의 연필 아이콘
- **PM 점검 기록**: 장비 상세 → *점검 기록 추가* (점검일·결과·부품 상태·작업자·작업 내용). 가장 최근 기록이 목록의 PM 날짜/상태/부품 상태로 반영됩니다.
- ITAM에서 수정했거나 점검 기록을 남긴 장비에는 `ITAM` 표시가 붙고, monday CSV를 다시 가져와도 덮어쓰지 않습니다.

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
