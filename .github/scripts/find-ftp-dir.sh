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

# Accept "ftp://host/", "host:21" etc.
HOST="${FTP_SERVER#*://}"; HOST="${HOST%%/*}"; HOST="${HOST%%:*}"; HOST="$(echo "$HOST" | tr -d '[:space:]')"
USER_="$(echo "$FTP_USERNAME" | tr -d '[:space:]')"

ftp_ls() { # list a directory; succeeds only if it exists
  curl -s --max-time 25 --ftp-ssl --insecure --list-only --user "$USER_:$FTP_PASSWORD" "ftp://$HOST/$1" 2>/dev/null \
  || curl -s --max-time 25 --list-only --user "$USER_:$FTP_PASSWORD" "ftp://$HOST/$1" 2>/dev/null
}

explain() { # human reason for a curl exit code — never prints credentials
  case "$1" in
    6)  echo "FTP_SERVER does not resolve. Use the FTP host from hPanel → Files → FTP Accounts (e.g. ftp.velouraone.in), not the website address." ;;
    7|28) echo "Nothing answers FTP on that host (connection refused / timed out). FTP_SERVER is probably the website address, which goes through Hostinger's CDN. Use ftp.velouraone.in or the FTP IP from hPanel." ;;
    67) echo "The server rejected the username or password. In hPanel → FTP Accounts copy the exact FTP username (e.g. u123456789 or u123456789.velouraone.in) and reset the password if unsure." ;;
    35|64|91) echo "TLS problem with FTPS. Try adding the variable FTP_PROTOCOL = ftp." ;;
    *)  echo "curl exit code $1." ;;
  esac
}

if ! root=$(ftp_ls ""); then
  code=$(curl -s --max-time 25 -o /dev/null --list-only --user "$USER_:$FTP_PASSWORD" "ftp://$HOST/" 2>/dev/null; echo $?)
  echo "Login test: host looks like '${HOST%%.*}.…' (${#HOST} chars), username is ${#USER_} chars, curl exit $code"
  echo "::error title=FTP login failed::$(explain "$code")"
  exit 1
fi
echo "FTP_HOST_CLEAN=$HOST" >> "$GITHUB_ENV"
echo "FTP_USER_CLEAN=$USER_" >> "$GITHUB_ENV"
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
