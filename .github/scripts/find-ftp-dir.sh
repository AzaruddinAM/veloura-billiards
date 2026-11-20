#!/usr/bin/env bash
# Finds the billiards subdomain folder on Hostinger over FTP when FTP_SERVER_DIR isn't set.
# Needs FTP_SERVER, FTP_USERNAME, FTP_PASSWORD in the environment. Prints only folder names.
# Writes DEPLOY_DIR=<path>/ to $GITHUB_ENV when exactly one candidate exists.
set -uo pipefail

SUB="${SUBDOMAIN:-billiards}"
DOMAIN="${DOMAIN:-velouraone.in}"
FQDN="$SUB.$DOMAIN"

# Hostinger layouts, relative to where the FTP account logs in.
CANDIDATES=(
  "domains/$DOMAIN/public_html/$SUB"
  "domains/$FQDN/public_html"
  "public_html/$SUB"
  "$SUB"
  "$FQDN"
)

ftp_ls() { # list a directory; succeeds only if it exists
  curl -s --max-time 25 --ftp-ssl --insecure --list-only --user "$FTP_USERNAME:$FTP_PASSWORD" "ftp://$FTP_SERVER/$1" 2>/dev/null \
  || curl -s --max-time 25 --list-only --user "$FTP_USERNAME:$FTP_PASSWORD" "ftp://$FTP_SERVER/$1" 2>/dev/null
}

root=$(ftp_ls "") || { echo "::error title=FTP login failed::Could not list the FTP root. Check FTP_SERVER, FTP_USERNAME and FTP_PASSWORD."; exit 1; }
echo "FTP login folder contains: $(echo "$root" | tr '\n' ' ')"

found=()
for c in "${CANDIDATES[@]}"; do
  if ftp_ls "$c/" >/dev/null; then echo "✓ found $c/"; found+=("$c"); else echo "· no $c/"; fi
done

if [ ${#found[@]} -eq 1 ]; then
  echo "DEPLOY_DIR=${found[0]}/" >> "$GITHUB_ENV"
  echo "::notice title=Using FTP folder ${found[0]}/::Found the subdomain folder automatically. To pin it, add a repository variable FTP_SERVER_DIR = ${found[0]}/"
  exit 0
fi

listing=$(echo "$root" | tr '\n' ' ')
if [ ${#found[@]} -eq 0 ]; then
  echo "::error title=Subdomain folder not found::FTP login folder contains: $listing — none of: ${CANDIDATES[*]}. Set FTP_SERVER_DIR to the folder shown in hPanel File Manager for $FQDN."
else
  echo "::error title=Several possible folders::Found: ${found[*]}. Set FTP_SERVER_DIR to the one that is $FQDN's document root."
fi
exit 1
