#!/bin/zsh
# remote-control-mcp — setup script

# ── Colors & Styles ──────────────────────────────────────────────────────────
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
CYAN=$'\033[36m'
WHITE=$'\033[97m'

BG_BLUE='\033[44m'
BG_RED='\033[41m'

# ── Helpers ──────────────────────────────────────────────────────────────────
print_step()  { echo "\n${BOLD}${CYAN}  ❯ ${WHITE}$1${RESET}" }
print_ok()    { echo "  ${GREEN}✓${RESET}  $1" }
print_warn()  { echo "  ${YELLOW}⚠${RESET}  $1" }
print_error() { echo "  ${RED}✗${RESET}  $1" }
print_info()  { echo "  ${DIM}$1${RESET}" }

fail() { print_error "$1"; echo ""; exit 1 }

prompt() {
  printf "  ${BOLD}${WHITE}? ${RESET}${WHITE}$1${RESET}"
  if [[ -n "$2" ]]; then printf " ${DIM}($2)${RESET}"; fi
  printf " › "
}

divider() { echo "  ${DIM}──────────────────────────────────────────────${RESET}" }

# ── Arrow-key Y/N selector ───────────────────────────────────────────────────
# Usage: yn_select "Question text" ["yes"|"no"]
#   Optional second arg: marks which option as recommended.
# Returns 0 = Yes, 1 = No
yn_select() {
  local label="$1"
  local recommend="${2:-}"
  local selected=0   # 0=Yes  1=No
  local key seq

  # Print question label
  echo "  ${BOLD}${WHITE}? ${RESET}${WHITE}${label}${RESET}"
  echo ""

  tput civis 2>/dev/null  # hide cursor

  _render_yn() {
    tput cr 2>/dev/null
    tput el 2>/dev/null
    if [[ "$recommend" == "yes" ]]; then
      if [[ $selected -eq 0 ]]; then
        printf "       ${BOLD}${GREEN}▶  Yes (recommended)  ${RESET}   ${WHITE}   No  ${RESET}"
      else
        printf "       ${WHITE}   Yes (recommended)  ${RESET}   ${BOLD}${RED}▶  No   ${RESET}"
      fi
    else
      if [[ $selected -eq 0 ]]; then
        printf "       ${BOLD}${GREEN}▶  Yes  ${RESET}   ${WHITE}   No  ${RESET}"
      else
        printf "       ${WHITE}   Yes  ${RESET}   ${BOLD}${RED}▶  No   ${RESET}"
      fi
    fi
  }

  _render_yn

  while true; do
    # Read one character; detect escape sequences for arrow keys
    IFS= read -r -s -k1 key

    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -r -s -k2 seq
      case "$seq" in
        '[D'|'[A') selected=0 ;;   # ← / ↑  → Yes
        '[C'|'[B') selected=1 ;;   # → / ↓  → No
      esac
      _render_yn
    elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == '' ]]; then
      break
    elif [[ "$key" == 'y' || "$key" == 'Y' ]]; then
      selected=0; _render_yn; break
    elif [[ "$key" == 'n' || "$key" == 'N' ]]; then
      selected=1; _render_yn; break
    fi
  done

  tput cnorm 2>/dev/null  # restore cursor
  echo "\n"
  return $selected
}

# ── menu_select ───────────────────────────────────────────────────────────────
# Usage: menu_select "Question" "Label1" "Desc1" "Label2" "Desc2" ...
# Result: MENU_RESULT (1-based index)
menu_select() {
  local label="$1"; shift
  local -a opts descs
  while [[ $# -ge 2 ]]; do
    opts+=("$1"); descs+=("$2"); shift 2
  done
  local n=${#opts[@]}
  local selected=1
  local key seq

  echo "  ${BOLD}${WHITE}? ${RESET}${WHITE}${label}${RESET}"
  echo ""

  tput civis 2>/dev/null

  _render_menu() {
    # move cursor up n lines to redraw in place
    printf "\033[%dA" "$n"
    local i
    for (( i=1; i<=n; i++ )); do
      printf "\r\033[K"  # cr + erase line
      if [[ $i -eq $selected ]]; then
        printf "    ${BOLD}${GREEN}▶  %-24s${RESET}${DIM}%s${RESET}" "${opts[$i]}" "${descs[$i]}"
      else
        printf "       ${WHITE}%-24s${DIM}%s${RESET}" "${opts[$i]}" "${descs[$i]}"
      fi
      printf "\n"
    done
  }

  # Initial render
  local i
  for (( i=1; i<=n; i++ )); do
    if [[ $i -eq $selected ]]; then
      printf "    ${BOLD}${GREEN}▶  %-24s${RESET}${DIM}%s${RESET}" "${opts[$i]}" "${descs[$i]}"
    else
      printf "       ${WHITE}%-24s${DIM}%s${RESET}" "${opts[$i]}" "${descs[$i]}"
    fi
    printf "\n"
  done

  while true; do
    IFS= read -r -s -k1 key

    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -r -s -k2 seq
      case "$seq" in
        '[A') (( selected > 1 ))   && (( selected-- )) ;;   # ↑
        '[B') (( selected < n ))   && (( selected++ )) ;;   # ↓
      esac
      _render_menu
    elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == '' ]]; then
      break
    elif [[ "$key" =~ ^[1-9]$ && $(( key - 1 )) -lt $n ]]; then
      # number shortcut — select and confirm immediately
      selected=$(( key ))
      _render_menu
      break
    fi
  done

  tput cnorm 2>/dev/null
  echo ""
  MENU_RESULT=$selected
}


# ── Banner ───────────────────────────────────────────────────────────────────
clear
echo ""
echo "${BOLD}${CYAN}"
cat << 'EOF'
  ██████╗  ██████╗    ███╗   ███╗ ██████╗██████╗
  ██╔══██╗██╔════╝    ████╗ ████║██╔════╝██╔══██╗
  ██████╔╝██║         ██╔████╔██║██║     ██████╔╝
  ██╔══██╗██║         ██║╚██╔╝██║██║     ██╔═══╝
  ██║  ██║╚██████╗    ██║ ╚═╝ ██║╚██████╗██║
  ╚═╝  ╚═╝ ╚═════╝    ╚═╝     ╚═╝ ╚═════╝╚═╝
EOF
echo "${RESET}${DIM}  REMOTE CONTROL MCP SERVER — Setup${RESET}"
echo ""
divider
print_info "  Grants AI services remote shell, file, and AppleScript access to your Mac."
print_info "  Linux support coming soon. Always run behind a secure tunnel."
divider
echo ""
sleep 0.4

# ── Disclaimer & Consent ─────────────────────────────────────────────────────
echo "  ${BOLD}${RED}⚠  IMPORTANT — READ BEFORE CONTINUING${RESET}"
echo ""
echo "  ${WHITE}This software enables AI services to execute shell commands,${RESET}"
echo "  ${WHITE}read and write files, and run AppleScript on your Mac.${RESET}"
echo ""
echo "  ${BOLD}${WHITE}By proceeding, you acknowledge that:${RESET}"
echo ""
echo "  ${YELLOW}•${RESET} Anyone with a valid OAuth token gains ${BOLD}full shell access${RESET} to your Mac"
echo "    — equivalent to being logged in as you."
echo ""
echo "  ${YELLOW}•${RESET} You are ${BOLD}solely responsible${RESET} for securing the tunnel, revoking tokens,"
echo "    and any consequences of misuse or misconfiguration."
echo ""
echo "  ${YELLOW}•${RESET} This software is provided ${BOLD}AS IS${RESET} with no warranty. The author bears"
echo "    no liability for damage, data loss, or unauthorized access."
echo ""
echo "  ${YELLOW}•${RESET} ${BOLD}Never${RESET} expose this server without a configured tunnel"
echo "    (Cloudflare or ngrok)."
echo ""
divider
echo ""

yn_select "Do you understand the risks and accept full responsibility?"
CONSENT=$?

if [[ $CONSENT -ne 0 ]]; then
  print_warn "Setup cancelled. No changes were made."
  echo ""
  exit 0
fi

print_ok "Consent recorded. Proceeding with setup."
echo ""
sleep 0.3

# ── Step 1: Homebrew ─────────────────────────────────────────────────────────
print_step "Checking Homebrew"
if command -v brew &>/dev/null; then
  print_ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"
else
  print_warn "Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || fail "Homebrew installation failed."
  print_ok "Homebrew installed"
fi

# ── Step 2: Node.js ──────────────────────────────────────────────────────────
print_step "Checking Node.js"
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.version.slice(1))))")
  if (( NODE_MAJOR < 18 )); then
    print_warn "Node.js v${NODE_MAJOR} too old (need ≥ 18). Upgrading..."
    brew upgrade node || brew install node
  fi
  print_ok "Node.js $(node --version)"
else
  print_warn "Node.js not found. Installing..."
  brew install node || fail "Node.js installation failed."
  print_ok "Node.js $(node --version) installed"
fi

# ── Step 3: npm install ──────────────────────────────────────────────────────
print_step "Installing dependencies"
npm install --silent && print_ok "npm packages installed" || fail "npm install failed."

# ── Step 4: Redis ────────────────────────────────────────────────────────────
echo ""
echo "  ${BOLD}${CYAN}◆ REDIS SETUP${RESET}"
echo ""
print_info "  Redis stores OAuth tokens. Without it, tokens are lost on restart."
echo ""

REDIS_URL=""
REDIS_DETECTED=false

if command -v redis-cli &>/dev/null && redis-cli -h localhost -p 6379 ping &>/dev/null 2>&1; then
  REDIS_DETECTED=true
fi

if $REDIS_DETECTED; then
  echo "  ${GREEN}${BOLD}⬡ Redis detected${RESET} ${DIM}at localhost:6379${RESET}"
  echo ""
  menu_select "Redis setup" \
    "Use detected Redis"   "localhost:6379" \
    "Use a different Redis" "enter custom connection" \
    "Set Later"            "tokens won't persist across restarts"
  REDIS_CHOICE=$MENU_RESULT

  case "$REDIS_CHOICE" in
    1)
      REDIS_URL="redis://localhost:6379"
      print_ok "Using detected Redis at localhost:6379"
      ;;
    2)
      prompt "Redis host" "localhost"; read REDIS_HOST; REDIS_HOST=${REDIS_HOST:-localhost}
      prompt "Redis port" "6379";     read REDIS_PORT; REDIS_PORT=${REDIS_PORT:-6379}
      prompt "Redis password (leave blank if none)"; read -s REDIS_PASS; echo ""
      if [[ -n "$REDIS_PASS" ]]; then
        REDIS_URL="redis://:${REDIS_PASS}@${REDIS_HOST}:${REDIS_PORT}"
      else
        REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"
      fi
      print_ok "Redis URL set to ${REDIS_URL}"
      ;;
    3)
      print_warn "Skipping Redis — tokens will reset on server restart."
      ;;
  esac

else
  echo "  ${YELLOW}⬡ No Redis detected${RESET}"
  echo ""
  menu_select "Redis setup" \
    "Install via Homebrew"   "recommended for local use" \
    "Start via Docker"       "requires Docker Desktop" \
    "Connect to existing"    "enter host/port manually" \
    "Set Later"              "tokens won't persist across restarts"
  REDIS_CHOICE=$MENU_RESULT

  case "$REDIS_CHOICE" in
    1)
      if command -v redis-server &>/dev/null; then
        print_ok "Redis already installed: $(redis-server --version | awk '{print $3}' | tr -d v)"
      else
        print_info "Installing Redis via Homebrew..."
        brew install redis || fail "Redis installation failed."
      fi
      brew services start redis || fail "Failed to start Redis service."
      REDIS_URL="redis://localhost:6379"
      print_ok "Redis started and set to launch at login"
      ;;
    2)
      if ! command -v docker &>/dev/null; then
        fail "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
      fi
      print_info "Starting Redis container..."
      docker run -d --name remote-control-mcp-redis \
        -p 6379:6379 \
        --restart unless-stopped \
        redis:7-alpine 2>/dev/null || {
          print_warn "Container exists — restarting..."
          docker start remote-control-mcp-redis || fail "Failed to start Redis container."
        }
      REDIS_URL="redis://localhost:6379"
      print_ok "Redis container running at localhost:6379"
      ;;
    3)
      prompt "Redis host" "localhost"; read REDIS_HOST; REDIS_HOST=${REDIS_HOST:-localhost}
      prompt "Redis port" "6379";     read REDIS_PORT; REDIS_PORT=${REDIS_PORT:-6379}
      prompt "Redis password (leave blank if none)"; read -s REDIS_PASS; echo ""
      if [[ -n "$REDIS_PASS" ]]; then
        REDIS_URL="redis://:${REDIS_PASS}@${REDIS_HOST}:${REDIS_PORT}"
      else
        REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"
      fi
      if command -v redis-cli &>/dev/null; then
        PING_ARGS=(-h "$REDIS_HOST" -p "$REDIS_PORT")
        [[ -n "$REDIS_PASS" ]] && PING_ARGS+=(-a "$REDIS_PASS")
        if redis-cli "${PING_ARGS[@]}" ping &>/dev/null 2>&1; then
          print_ok "Connection verified ✓"
        else
          print_warn "Could not verify connection — check host/port/password."
          print_warn "URL saved anyway: $REDIS_URL"
        fi
      fi
      ;;
    4)
      print_warn "Skipping Redis — tokens will reset on server restart."
      ;;
  esac
fi

# ── Step 5: .env ─────────────────────────────────────────────────────────────
print_step "Environment configuration"

if [[ -f .env ]]; then
  print_warn ".env already exists — skipping auto-config."
  print_info "Edit .env manually to update BASE_URI or REDIS_URL."
else
  cp .env.example .env
  if [[ -n "$REDIS_URL" ]]; then
    if grep -q "^# REDIS_URL=" .env 2>/dev/null; then
      sed -i '' "s|^# REDIS_URL=.*|REDIS_URL=${REDIS_URL}|" .env
    else
      echo "REDIS_URL=${REDIS_URL}" >> .env
    fi
    print_ok "REDIS_URL saved to .env"
  fi
  print_ok ".env created from .env.example"
fi

# ── Step 6: Build ────────────────────────────────────────────────────────────
print_step "Building TypeScript"
npm run build && print_ok "Build successful" || fail "Build failed. Check TypeScript errors above."


# ── Step 7: Tunnel setup ──────────────────────────────────────────────────────
print_step "Tunnel setup"
echo ""
print_info "  A tunnel exposes the MCP server to the internet without port forwarding."
echo ""
menu_select "Tunnel setup" \
  "Cloudflare Tunnel"  "free, permanent custom domain" \
  "ngrok"              "quick setup — free tier URL changes on restart" \
  "Skip"               "configure manually later"
TUNNEL_CHOICE=$MENU_RESULT

TUNNEL_LABEL="com.hexpy.remote-control-mcp-tunnel"
TUNNEL_PLIST="$HOME/Library/LaunchAgents/${TUNNEL_LABEL}.plist"
TUNNEL_LOG="$HOME/Library/Logs/remote-control-mcp-tunnel.log"
TUNNEL_DOMAIN=""

# ──────────────────────────────────────────────────
#  1: Cloudflare Tunnel
# ──────────────────────────────────────────────────
if [[ "$TUNNEL_CHOICE" == "1" ]]; then

  if command -v cloudflared &>/dev/null; then
    CF_BIN=$(command -v cloudflared)
    print_ok "cloudflared $(cloudflared --version 2>&1 | head -1 | awk '{print $3}')"
  else
    print_info "Installing cloudflared via Homebrew..."
    brew install cloudflared || fail "cloudflared installation failed."
    CF_BIN=$(command -v cloudflared)
    print_ok "cloudflared installed"
  fi

  echo ""
  if [[ -f "$HOME/.cloudflared/cert.pem" ]]; then
    print_ok "Already authenticated with Cloudflare"
  else
    echo "  ${BOLD}${WHITE}Cloudflare login required.${RESET}"
    print_info "  A browser will open — log in and select your domain."
    echo ""
    printf "  ${DIM}Press Enter to open the browser...${RESET}"; read -s; echo ""
    cloudflared tunnel login &
    CF_LOGIN_PID=$!
    WAITED=0
    printf "  ${YELLOW}⏳${RESET} Waiting for authentication"
    while [[ ! -f "$HOME/.cloudflared/cert.pem" && $WAITED -lt 180 ]]; do
      sleep 2; WAITED=$((WAITED+2)); printf "."
    done; echo ""
    kill $CF_LOGIN_PID 2>/dev/null; wait $CF_LOGIN_PID 2>/dev/null || true
    [[ ! -f "$HOME/.cloudflared/cert.pem" ]] && \
      fail "Timed out. Run 'cloudflared tunnel login' manually then re-run setup."
    print_ok "Authenticated with Cloudflare"
  fi

  echo ""
  prompt "Tunnel name" "remote-control-mcp"
  read CF_TUNNEL_NAME; CF_TUNNEL_NAME=${CF_TUNNEL_NAME:-remote-control-mcp}

  EXISTING=$(cloudflared tunnel list --output json 2>/dev/null | \
    node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const t=JSON.parse(d);const f=t.find(x=>x.name==='${CF_TUNNEL_NAME}');console.log(f?f.id:'');}catch(e){}})" 2>/dev/null || echo "")

  if [[ -n "$EXISTING" ]]; then
    print_ok "Tunnel '${CF_TUNNEL_NAME}' exists (${EXISTING:0:8}...)"
  else
    print_info "Creating tunnel '${CF_TUNNEL_NAME}'..."
    cloudflared tunnel create "$CF_TUNNEL_NAME" 2>&1 | grep -v "^$" | while read -r l; do print_info "  $l"; done
    print_ok "Tunnel '${CF_TUNNEL_NAME}' created"
  fi

  echo ""
  print_info "  Enter the public hostname for this tunnel."
  print_info "  Must belong to a domain on your Cloudflare account."
  print_info "  Example: mcp.yourdomain.com"
  echo ""
  prompt "Hostname"
  read TUNNEL_DOMAIN; TUNNEL_DOMAIN=$(echo "$TUNNEL_DOMAIN" | tr -d ' ')
  [[ -z "$TUNNEL_DOMAIN" ]] && fail "Hostname cannot be empty."

  print_info "Creating DNS CNAME for ${TUNNEL_DOMAIN}..."
  DNS_OUT=$(cloudflared tunnel route dns --overwrite-dns "$CF_TUNNEL_NAME" "$TUNNEL_DOMAIN" 2>&1)
  echo "$DNS_OUT" | grep -qi "error" \
    && print_warn "DNS: $DNS_OUT" \
    || print_ok "DNS CNAME → ${TUNNEL_DOMAIN}"

  [[ -f .env ]] && sed -i '' "s|^BASE_URI=.*|BASE_URI=https://${TUNNEL_DOMAIN}|" .env && \
    print_ok "BASE_URI → https://${TUNNEL_DOMAIN}"

  echo ""
  print_info "  Testing tunnel connectivity (up to 30s)..."
  cloudflared tunnel run --url "http://localhost:3232" "$CF_TUNNEL_NAME" &>/dev/null &
  CF_TEST_PID=$!
  WAITED=0; CONNECTED=false
  printf "  ${YELLOW}⏳${RESET} Connecting"
  while [[ $WAITED -lt 30 ]]; do
    sleep 2; WAITED=$((WAITED+2)); printf "."
    curl -sf --max-time 3 "https://${TUNNEL_DOMAIN}/ping" &>/dev/null && { CONNECTED=true; break; }
  done; echo ""
  kill $CF_TEST_PID 2>/dev/null; wait $CF_TEST_PID 2>/dev/null || true
  $CONNECTED \
    && print_ok "Tunnel verified → https://${TUNNEL_DOMAIN}" \
    || print_warn "DNS still propagating — will work within ~1 min."

  launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
  mkdir -p "$HOME/Library/Logs"
  cat > "$TUNNEL_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${TUNNEL_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${CF_BIN}</string><string>tunnel</string><string>run</string>
    <string>--url</string><string>http://localhost:3232</string>
    <string>${CF_TUNNEL_NAME}</string>
  </array>
  <key>StandardOutPath</key><string>${TUNNEL_LOG}</string>
  <key>StandardErrorPath</key><string>${TUNNEL_LOG}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict></plist>
PLIST
  if launchctl load "$TUNNEL_PLIST" 2>/dev/null; then
    launchctl start "$TUNNEL_LABEL" 2>/dev/null || true
    print_ok "Cloudflare Tunnel LaunchAgent registered"
    print_info "  Logs:    tail -f ${TUNNEL_LOG}"
    print_info "  Stop:    launchctl stop ${TUNNEL_LABEL}"
    print_info "  Disable: launchctl unload ${TUNNEL_PLIST}"
  else
    print_warn "Run manually: launchctl load ${TUNNEL_PLIST}"
  fi

# ──────────────────────────────────────────────────
#  2: ngrok
# ──────────────────────────────────────────────────
elif [[ "$TUNNEL_CHOICE" == "2" ]]; then

  if command -v ngrok &>/dev/null; then
    NGROK_BIN=$(command -v ngrok)
    print_ok "ngrok $(ngrok --version 2>&1 | awk '{print $3}')"
  else
    print_info "Installing ngrok via Homebrew..."
    brew install ngrok || fail "ngrok installation failed."
    NGROK_BIN=$(command -v ngrok)
    print_ok "ngrok installed"
  fi

  echo ""
  # Config path differs by ngrok version
  NGROK_CFG="$HOME/Library/Application Support/ngrok/ngrok.yml"
  [[ -f "$HOME/.ngrok2/ngrok.yml" ]] && NGROK_CFG="$HOME/.ngrok2/ngrok.yml"

  if [[ -f "$NGROK_CFG" ]] && grep -q "authtoken:" "$NGROK_CFG" 2>/dev/null; then
    print_ok "ngrok authtoken already configured"
  else
    echo "  ${BOLD}${WHITE}ngrok authentication required.${RESET}"
    echo ""
    print_info "  1. Sign up / log in: ${CYAN}https://dashboard.ngrok.com${RESET}"
    print_info "  2. Copy your token:  ${CYAN}https://dashboard.ngrok.com/get-started/your-authtoken${RESET}"
    echo ""
    prompt "Paste your ngrok authtoken"
    read -rs NGROK_TOKEN; echo ""
    [[ -z "$NGROK_TOKEN" ]] && fail "Authtoken cannot be empty."
    ngrok config add-authtoken "$NGROK_TOKEN" 2>&1 | grep -v "^$" | while read -r l; do print_info "  $l"; done
    print_ok "ngrok authtoken saved"
  fi

  echo ""
  echo "  ${YELLOW}⚠${RESET}  ${BOLD}ngrok free tier: URL changes on every restart.${RESET}"
  echo "     ${DIM}BASE_URI must be updated manually after each restart.${RESET}"
  echo "     ${DIM}Paid plans support a fixed static domain.${RESET}"
  echo ""

  yn_select "Do you have a paid ngrok plan with a static domain?"
  HAS_NGROK_DOMAIN=$?
  NGROK_DOMAIN_FLAG=""
  NGROK_PLIST_DOMAIN_ARG=""

  if [[ $HAS_NGROK_DOMAIN -eq 0 ]]; then
    prompt "Your ngrok static domain (e.g. mcp.ngrok.app)"
    read TUNNEL_DOMAIN; TUNNEL_DOMAIN=$(echo "$TUNNEL_DOMAIN" | tr -d ' ')
    if [[ -n "$TUNNEL_DOMAIN" ]]; then
      NGROK_DOMAIN_FLAG="--url=https://${TUNNEL_DOMAIN}"
      NGROK_PLIST_DOMAIN_ARG="<string>--url=https://${TUNNEL_DOMAIN}</string>"
      [[ -f .env ]] && sed -i '' "s|^BASE_URI=.*|BASE_URI=https://${TUNNEL_DOMAIN}|" .env && \
        print_ok "BASE_URI → https://${TUNNEL_DOMAIN}"
    fi
  else
    print_warn "Remember: update BASE_URI in .env manually after each restart."
  fi

  echo ""
  print_info "  Testing ngrok (up to 20s)..."
  ngrok http 3232 $NGROK_DOMAIN_FLAG --log=stdout &>/dev/null &
  NGROK_TEST_PID=$!
  WAITED=0; CONNECTED=false; NGROK_URL=""
  printf "  ${YELLOW}⏳${RESET} Connecting"
  while [[ $WAITED -lt 20 ]]; do
    sleep 2; WAITED=$((WAITED+2)); printf "."
    NGROK_URL=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null | \
      node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const t=JSON.parse(d);console.log(t.tunnels?.find(x=>x.proto==='https')?.public_url||'');}catch(e){}})" 2>/dev/null || echo "")
    [[ -n "$NGROK_URL" ]] && { CONNECTED=true; break; }
  done; echo ""
  kill $NGROK_TEST_PID 2>/dev/null; wait $NGROK_TEST_PID 2>/dev/null || true

  if $CONNECTED; then
    print_ok "ngrok working → ${NGROK_URL}"
    [[ -z "$NGROK_DOMAIN_FLAG" ]] && \
      print_warn "This URL is temporary — update BASE_URI in .env after each restart."
  else
    print_warn "Could not verify ngrok — it may still be starting."
  fi

  launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
  mkdir -p "$HOME/Library/Logs"
  cat > "$TUNNEL_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${TUNNEL_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${NGROK_BIN}</string><string>http</string><string>3232</string>
    ${NGROK_PLIST_DOMAIN_ARG}
    <string>--log=stdout</string>
  </array>
  <key>StandardOutPath</key><string>${TUNNEL_LOG}</string>
  <key>StandardErrorPath</key><string>${TUNNEL_LOG}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict></plist>
PLIST
  if launchctl load "$TUNNEL_PLIST" 2>/dev/null; then
    launchctl start "$TUNNEL_LABEL" 2>/dev/null || true
    print_ok "ngrok LaunchAgent registered"
    print_info "  Logs:    tail -f ${TUNNEL_LOG}"
    print_info "  Stop:    launchctl stop ${TUNNEL_LABEL}"
    [[ -z "$NGROK_DOMAIN_FLAG" ]] && \
      print_warn "Each restart gives a new URL — update BASE_URI in .env each time."
  else
    print_warn "Run manually: launchctl load ${TUNNEL_PLIST}"
  fi

# ──────────────────────────────────────────────────
#  3: Skip
# ──────────────────────────────────────────────────
else
  print_info "Skipped — see README.md for manual tunnel setup."
fi

# ── Step 7: LaunchAgent (auto-start on login) ─────────────────────────────────
print_step "Auto-start on login"
echo ""
print_info "  A LaunchAgent will start the MCP server automatically when you log in."
print_info "  Logs: ~/Library/Logs/remote-control-mcp.log"
echo ""

LAUNCHAGENT_LABEL="com.hexpy.remote-control-mcp"
LAUNCHAGENT_PATH="$HOME/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"
SERVER_DIR="$(pwd)"
LOG_PATH="$HOME/Library/Logs/remote-control-mcp.log"

yn_select "Set up auto-start on login?" "yes"
AUTOSTART=$?

if [[ $AUTOSTART -eq 0 ]]; then
  # Unload existing agent if present
  if launchctl list | grep -q "$LAUNCHAGENT_LABEL" 2>/dev/null; then
    launchctl unload "$LAUNCHAGENT_PATH" 2>/dev/null || true
    print_info "Removed existing LaunchAgent"
  fi

  # Create log dir
  mkdir -p "$HOME/Library/Logs"

  # Write plist
  cat > "$LAUNCHAGENT_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHAGENT_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>${SERVER_DIR}/dist/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${SERVER_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <!-- Load .env file by sourcing it via a wrapper if needed -->
  <!-- Environment variables from .env are loaded by dotenv in the app -->

  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <!-- Restart on crash, but not if manually stopped -->
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST

  # Fix node path — prefer homebrew node
  NODE_BIN=$(command -v node)
  sed -i '' "s|/usr/local/bin/node|${NODE_BIN}|g" "$LAUNCHAGENT_PATH"

  # Load the agent
  if launchctl load "$LAUNCHAGENT_PATH" 2>/dev/null; then
    print_ok "LaunchAgent registered — server will start on every login"
    print_ok "Starting server now..."
    launchctl start "$LAUNCHAGENT_LABEL" 2>/dev/null || true
    sleep 1
    if launchctl list | grep -q "$LAUNCHAGENT_LABEL"; then
      print_ok "Server is running"
      print_info "  Logs: tail -f ${LOG_PATH}"
      print_info "  Stop: launchctl stop ${LAUNCHAGENT_LABEL}"
      print_info "  Disable: launchctl unload ${LAUNCHAGENT_PATH}"
    else
      print_warn "LaunchAgent registered but server may not have started yet."
      print_warn "Check logs: tail -f ${LOG_PATH}"
    fi
  else
    print_warn "Could not load LaunchAgent automatically."
    print_info "  Run manually: launchctl load ${LAUNCHAGENT_PATH}"
  fi
else
  print_info "Skipped. Start manually with: npm start"
fi





# ── Step 8: File server (optional) ───────────────────────────────────────────
print_step "File server (optional)"
echo ""
print_info "  A lightweight file server (port 3835) serves files from ~/Public/mcp-files/"
print_info "  via tunnel URL — lets you share or view Mac files from any browser or AI service."
print_info "  Logs: ~/Library/Logs/remote-control-mcp-fileserver.log"
echo ""

FILESERVER_LABEL="com.hexpy.remote-control-mcp-fileserver"
FILESERVER_PLIST="$HOME/Library/LaunchAgents/${FILESERVER_LABEL}.plist"
FILESERVER_LOG="$HOME/Library/Logs/remote-control-mcp-fileserver.log"

yn_select "Set up file server?" "no"
SETUP_FILESERVER=$?

if [[ $SETUP_FILESERVER -eq 0 ]]; then
  mkdir -p "$HOME/Public/mcp-files"
    print_ok "Created ~/Public/mcp-files/"

    if launchctl list | grep -q "$FILESERVER_LABEL" 2>/dev/null; then
      launchctl unload "$FILESERVER_PLIST" 2>/dev/null || true
      print_info "Removed existing file server LaunchAgent"
    fi

    mkdir -p "$HOME/Library/Logs"

    cat > "$FILESERVER_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${FILESERVER_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>source ~/.zshrc 2>/dev/null; cd '${SERVER_DIR}'; exec npx tsx src/file-server.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${SERVER_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${FILESERVER_LOG}</string>

  <key>StandardErrorPath</key>
  <string>${FILESERVER_LOG}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST

    if launchctl load "$FILESERVER_PLIST" 2>/dev/null; then
      launchctl start "$FILESERVER_LABEL" 2>/dev/null || true
      sleep 1
      if launchctl list | grep -q "$FILESERVER_LABEL"; then
        print_ok "File server LaunchAgent registered and running (port 3835)"
        print_info "  Files dir: ~/Public/mcp-files/"
        print_info "  Logs:      tail -f ${FILESERVER_LOG}"
      else
        print_warn "File server registered but may not have started yet."
        print_warn "Check logs: tail -f ${FILESERVER_LOG}"
      fi
    else
      print_warn "Could not load file server LaunchAgent automatically."
      print_info "  Run manually: launchctl load ${FILESERVER_PLIST}"
    fi
else
  print_info "Skipped. Enable later with: rcmcp start fileserver"
  SETUP_FILESERVER=1
fi

# ── Step 9: Install rcmcp CLI ─────────────────────────────────────────────────
print_step "Install rcmcp CLI"
echo ""
print_info "  rcmcp is a management CLI for remote-control-mcp."
echo ""
echo "  ${DIM}  rcmcp status              server + tunnel status, endpoint URL${RESET}"
echo "  ${DIM}  rcmcp start/stop/restart  [server|tunnel|all]${RESET}"
echo "  ${DIM}  rcmcp logs [-f]           [server|tunnel|all]${RESET}"
echo "  ${DIM}  rcmcp update              git pull → rebuild → restart${RESET}"
echo "  ${DIM}  rcmcp uninstall           remove all services and CLI${RESET}"
echo ""

yn_select "Install rcmcp CLI?"
INSTALL_RCMCP=$?

if [[ $INSTALL_RCMCP -eq 0 ]]; then

  RCMCP_SRC="${SERVER_DIR}/rcmcp"

  if [[ ! -f "$RCMCP_SRC" ]]; then
    print_warn "rcmcp script not found in ${SERVER_DIR} — skipping."
  else

    # ── Choose install path ──────────────────────────────────────────
    # Prefer /usr/local/bin; fall back to ~/.local/bin
    RCMCP_DEST=""
    if cp "$RCMCP_SRC" "/usr/local/bin/rcmcp" 2>/dev/null && chmod +x "/usr/local/bin/rcmcp"; then
      RCMCP_DEST="/usr/local/bin/rcmcp"
    else
      mkdir -p "$HOME/.local/bin"
      if cp "$RCMCP_SRC" "$HOME/.local/bin/rcmcp" && chmod +x "$HOME/.local/bin/rcmcp"; then
        RCMCP_DEST="$HOME/.local/bin/rcmcp"
      else
        print_warn "Failed to install rcmcp — check permissions."
      fi
    fi

    if [[ -n "$RCMCP_DEST" ]]; then
      print_ok "rcmcp installed → ${RCMCP_DEST}"
      echo ""

      # ── PATH registration ──────────────────────────────────────────
      RCMCP_DIR=$(dirname "$RCMCP_DEST")
      ALREADY_IN_PATH=false
      echo "$PATH" | tr ':' '\n' | grep -qx "$RCMCP_DIR" && ALREADY_IN_PATH=true

      if $ALREADY_IN_PATH; then
        print_ok "${RCMCP_DIR} is already in PATH — ready to use"
      else
        echo "  ${YELLOW}⚠${RESET}  ${BOLD}${RCMCP_DIR} is not in your PATH.${RESET}"
        echo "     ${DIM}Without this you'd need to type the full path each time.${RESET}"
        echo ""
        yn_select "Add ${RCMCP_DIR} to PATH in your shell config?"
        ADD_PATH=$?

        if [[ $ADD_PATH -eq 0 ]]; then
          # Detect active shell rc
          if [[ -f "$HOME/.zshrc" ]]; then
            RC_FILE="$HOME/.zshrc"
          elif [[ -f "$HOME/.zprofile" ]]; then
            RC_FILE="$HOME/.zprofile"
          else
            RC_FILE="$HOME/.zshrc"
          fi

          if grep -qF "$RCMCP_DIR" "$RC_FILE" 2>/dev/null; then
            print_ok "PATH entry already present in ${RC_FILE}"
          else
            printf '\n# remote-control-mcp CLI\nexport PATH="%s:$PATH"\n' "$RCMCP_DIR" >> "$RC_FILE"
            print_ok "Added to ${RC_FILE}"
            print_info "  Run ${WHITE}source ${RC_FILE}${RESET} or restart terminal to apply."
          fi
        else
          print_info "Skipped. To add manually:"
          print_info "  echo 'export PATH=\"${RCMCP_DIR}:\$PATH\"' >> ~/.zshrc"
        fi
      fi
    fi
  fi

else
  print_info "Skipped. You can run setup.sh again to install rcmcp later."
fi
# ── Resolve live ngrok URL (free tier — URL not known at setup time) ─────────
if [[ "$TUNNEL_CHOICE" == "2" && -z "$TUNNEL_DOMAIN" ]]; then
  printf "  ${YELLOW}⏳${RESET} Waiting for ngrok to start"
  WAITED=0
  while [[ $WAITED -lt 20 ]]; do
    sleep 2; WAITED=$((WAITED+2)); printf "."
    NGROK_LIVE=$(curl -sf --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null | \
      node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const t=JSON.parse(d);console.log(t.tunnels?.find(x=>x.proto==='https')?.public_url||'');}catch(e){}})" 2>/dev/null || echo "")
    if [[ -n "$NGROK_LIVE" ]]; then
      TUNNEL_DOMAIN="${NGROK_LIVE#https://}"
      break
    fi
  done
  echo ""
  if [[ -n "$TUNNEL_DOMAIN" ]]; then
    print_ok "ngrok URL → https://${TUNNEL_DOMAIN}"
    [[ -f .env ]] && sed -i '' "s|^BASE_URI=.*|BASE_URI=https://${TUNNEL_DOMAIN}|" .env
    print_ok "BASE_URI updated in .env"
    print_warn "ngrok free tier: URL changes on every restart — run 'rcmcp status' to refresh"
  else
    print_warn "ngrok not responding yet — run 'rcmcp status' once it starts to auto-sync .env"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
divider
echo ""
echo "  ${BOLD}${GREEN}✓ Setup complete!${RESET}"
echo ""

NEXT_STEP=1

# Only show BASE_URI step if tunnel did not auto-set it
if [[ -z "$TUNNEL_DOMAIN" ]]; then
  echo "  ${CYAN}${NEXT_STEP}.${RESET} Edit ${WHITE}.env${RESET} → set ${YELLOW}BASE_URI${RESET} to your tunnel URL"
  echo ""
  (( NEXT_STEP++ ))
fi

# Server start / restart
if [[ $AUTOSTART -eq 0 ]]; then
  if [[ -z "$TUNNEL_DOMAIN" ]]; then
    # BASE_URI not auto-set — user must edit .env first, then restart
    echo "  ${CYAN}${NEXT_STEP}.${RESET} Restart the server after editing .env:"
    echo "     ${DIM}\$${RESET} ${WHITE}launchctl stop ${LAUNCHAGENT_LABEL}${RESET}"
    echo "     ${DIM}\$${RESET} ${WHITE}launchctl start ${LAUNCHAGENT_LABEL}${RESET}"
    echo ""
    (( NEXT_STEP++ ))
  fi
  # else: server + tunnel already running, BASE_URI already set — nothing to do
else
  echo "  ${CYAN}${NEXT_STEP}.${RESET} Start the server:"
  echo "     ${DIM}\$${RESET} ${WHITE}npm start${RESET}"
  echo ""
  (( NEXT_STEP++ ))
fi

# Tunnel start — only if user chose Skip
if [[ "$TUNNEL_CHOICE" == "3" ]]; then
  echo "  ${CYAN}${NEXT_STEP}.${RESET} Start a tunnel ${DIM}(separate terminal)${RESET}:"
  echo "     ${DIM}\$${RESET} ${WHITE}cloudflared tunnel --url http://localhost:3232${RESET}  ${DIM}# Cloudflare${RESET}"
  echo "     ${DIM}\$${RESET} ${WHITE}ngrok http 3232${RESET}                                ${DIM}# ngrok${RESET}"
  echo ""
  (( NEXT_STEP++ ))
fi

# Add to claude.ai — always shown last
echo "  ${CYAN}${NEXT_STEP}.${RESET} Add to ${WHITE}claude.ai${RESET} → Settings → Connectors:"
if [[ -n "$TUNNEL_DOMAIN" ]]; then
  echo "     ${BOLD}${WHITE}https://${TUNNEL_DOMAIN}/mcp${RESET}"
else
  echo "     ${WHITE}https://your-tunnel-url/mcp${RESET}"
fi
echo ""
divider
echo ""
echo "  ${DIM}See README.md for full documentation.${RESET}"
echo ""
