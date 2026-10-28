#!/bin/bash
cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  npm install
fi

echo 'VITE_API_URL=' > .env.production
npm run build
echo "빌드 완료: frontend/dist"
