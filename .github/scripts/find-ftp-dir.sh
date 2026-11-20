#!/usr/bin/env bash
# Finds — and proves — the FTP folder that https://billiards.velouraone.in serves.
#
# For each candidate folder it uploads a random probe file over FTP, fetches it over HTTPS,
# and deletes it again. The first folder whose probe the website serves becomes DEPLOY_DIR.
# Candidates, in order: FTP_SERVER_DIR (if set), the FTP login folder, then usual Hostinger paths.
#
# Env: FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, optional FTP_SERVER_DIR.
# Prints only folder names and results — never credentials.
set -uo pipefail

SUB="${SUBDOMAIN:-billiards}"
DOMAIN="${DOMAIN:-velouraone.in}"
FQDN="$SUB.$DOMAIN"

# Accept "ftp://host/", "host:21" etc.
HOST="${FTP_SERVER#*://}"; HOST="${HOST%%/*}"; HOST="${HOST%%:*}"; HOST="$(echo "$HOST" | tr -d '[:space:]')"
USER_="$(echo "$FTP_USERNAME" | tr -d '[:space:]')"

ftp() { # curl over explicit FTPS, falling back to plain FTP
  curl -s --max-time 25 --ftp-ssl --insecure --user "$USER_:$FTP_PASSWORD" "$@" 2>/dev/null \
  || curl -s --max-time 25 --user "$USER_:$FTP_PASSWORD" "$@" 2>/dev/null
}

explain() { # human reason for a curl exit code — never prints credentials
  case "$1" in
    6)  echo "FTP_SERVER does not resolve. Use the FTP host from hPanel → Files → FTP Accounts (e.g. ftp.velouraone.in), not the website address." ;;
    7|28) echo "Nothing answers FTP on that host. FTP_SERVER is probably the website address (behind Hostinger's CDN). Use ftp.velouraone.in or the FTP IP from hPanel." ;;
    67) echo "The server rejected the username or password. Copy the exact FTP username from hPanel → FTP Accounts and reset the password if unsure." ;;
    35|64|91) echo "TLS problem with FTPS. Try adding the variable FTP_PROTOCOL = ftp." ;;
    *)  echo "curl exit code $1." ;;
  esac
}

# 1) Log in
if ! root=$(ftp --list-only "ftp://$HOST/"); then
  code=$(curl -s --max-time 25 -o /dev/null --list-only --user "$USER_:$FTP_PASSWORD" "ftp://$HOST/" 2>/dev/null; echo $?)
  echo "::error title=FTP login failed::$(explain "$code")"
  exit 1
fi
listing="$(echo "$root" | grep -vxE '\.{1,2}' | tr '\n' ' ')"
echo "FTP login folder contains: ${listing:-(empty)}"

# 2) Candidates
norm() { local d="${1#./}"; d="${d#/}"; d="${d%/}"; [ "$d" = "." ] && d=""; echo "$d"; }
CANDIDATES=()
[ -n "${FTP_SERVER_DIR:-}" ] && CANDIDATES+=("$(norm "$FTP_SERVER_DIR")")
CANDIDATES+=(
  ""                                   # the FTP login folder itself
  "domains/$DOMAIN/public_html/$SUB"
  "domains/$FQDN/public_html"
  "public_html/$SUB"
  "$SUB"
  "$FQDN"
)

# 3) Probe each candidate until the website serves the probe
token="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
probe="vb-probe-$token.txt"
echo "veloura-deploy-probe-$token" > "/tmp/$probe"
tried=()
for c in "${CANDIDATES[@]}"; do
  label="${c:-./}"
  case " ${tried[*]-} " in *" $label "*) continue ;; esac
  tried+=("$label")
  path="${c:+$c/}$probe"
  if ! ftp -T "/tmp/$probe" "ftp://$HOST/$path" >/dev/null; then
    echo "· $label — folder doesn't exist or isn't writable"
    continue
  fi
  body="$(curl -s --max-time 20 "https://$FQDN/$probe?nocache=$token" || true)"
  ftp "ftp://$HOST/" -Q "DELE $path" -o /dev/null >/dev/null || true
  if [ "$body" = "veloura-deploy-probe-$token" ]; then
    echo "✓ $label — https://$FQDN/ serves this folder"
    if [ -n "$c" ]; then echo "DEPLOY_DIR=$c/" >> "$GITHUB_ENV"; else echo "DEPLOY_DIR=./" >> "$GITHUB_ENV"; fi
    if [ -n "${FTP_SERVER_DIR:-}" ] && [ "$(norm "$FTP_SERVER_DIR")" != "$c" ]; then
      echo "::warning title=FTP_SERVER_DIR is wrong::The saved FTP_SERVER_DIR is not the website's folder. Deployed to '$label' instead — update the FTP_SERVER_DIR variable to: $label"
    else
      echo "::notice title=Deploying to $label::Verified: https://$FQDN/ serves FTP folder '$label'."
    fi
    exit 0
  fi
  echo "· $label — exists, but the website doesn't serve it"
done

echo "::error title=Website folder not found::None of these FTP folders is served by https://$FQDN/: ${tried[*]}. FTP login folder contains: ${listing:-(empty)}. In hPanel → File Manager, find the folder for $FQDN and set FTP_SERVER_DIR to its path as seen by this FTP account."
exit 1
