#!/usr/bin/env bash
# Builds a ready-to-upload release in ./release
#
#   release/
#     public/      <- point the domain's document root here (index.php + Angular app + .htaccess)
#     src/ database/ config.php config.local.example.php
#
# Upload the *contents* of release/ to the server, set the document root of
# billiards.veloura.in to release/public, and you're live.
set -euo pipefail
cd "$(dirname "$0")"

echo "› Building Angular (production)…"
(cd frontend && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npx ng build --configuration production)

echo "› Assembling release/…"
rm -rf release
mkdir -p release/public release/data
cp -r backend/src backend/database backend/config.php backend/config.local.example.php release/
cp backend/public/index.php backend/public/.htaccess release/public/
cp -r frontend/dist/frontend/browser/. release/public/
# Deny web access to the data folder in case the document root is set one level too high.
printf 'Require all denied\n' > release/data/.htaccess
printf 'Require all denied\n' > release/src/.htaccess
printf 'Require all denied\n' > release/database/.htaccess

echo "✔ Release ready in $(pwd)/release — document root: release/public"
