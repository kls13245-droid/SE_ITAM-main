#!/bin/bash
cd "$(dirname "$0")"

export DJANGO_DEBUG="${DJANGO_DEBUG:-False}"
export DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-192.168.70.250,localhost}"
export CSRF_TRUSTED_ORIGINS="${CSRF_TRUSTED_ORIGINS:-http://192.168.70.250}"
export DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-change-me-in-production}"

exec gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 120
