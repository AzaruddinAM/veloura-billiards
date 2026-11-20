#!/usr/bin/env bash
# Builds a ready-to-upload release in ./release
#
#   release/
#     .htaccess    <- forwards requests into public/ (works when the docroot is this folder)
#     public/      <- or point the document root here directly (index.php + Angular app)
#     src/ database/ config.php config.local.example.php
#
# Upload the *contents* of release/ into the subdomain folder of
# billiards.velouraone.in (Hostinger: domains/velouraone.in/public_html/billiards or similar).
set -euo pipefail
cd "$(dirname "$0")"

echo "› Building Angular (production)…"
(cd frontend && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npx ng build --configuration production)

echo "› Assembling release/…"
rm -rf release
mkdir -p release/public release/data
cp -r backend/src backend/database backend/config.php backend/config.local.example.php release/
cp backend/public/index.php backend/public/.htaccess release/public/
cp backend/release-root.htaccess release/.htaccess
cp -r frontend/dist/frontend/browser/. release/public/
# Deny web access to the data folder in case the document root is set one level too high.
printf 'Require all denied\n' > release/data/.htaccess
printf 'Require all denied\n' > release/src/.htaccess
printf 'Require all denied\n' > release/database/.htaccess

echo "✔ Release ready in $(pwd)/release — document root: release/public"
