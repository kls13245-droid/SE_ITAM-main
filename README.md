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
| `CSRF_TRUSTED_ORIGINS` | localhost/250:5173 | 프론트 주소 |
| `VITE_API_URL` | `http://192.168.70.250:8000` | 프론트 API 주소 |

## 인증

로그인 후 세션 쿠키로 API를 보호합니다. 프론트는 `credentials: 'include'`로 요청합니다.


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
