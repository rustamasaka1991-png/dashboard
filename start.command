#!/bin/bash
# macOS / Linux: ikki marta bosib ishga tushiring
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "XATO: Node.js o'rnatilmagan. https://nodejs.org dan LTS versiyani o'rnating."
  read -r -p "Yopish uchun Enter bosing..." _
  exit 1
fi
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
OPEN_BROWSER=1 node server.js
read -r -p "Yopish uchun Enter bosing..." _
