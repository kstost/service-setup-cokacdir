#!/bin/bash
set -e

ARCH=$(uname -m)
OS=$(uname -s)

echo "=== Playwright Auto Install Script ==="
echo "OS: $OS | ARCH: $ARCH"
echo ""

# 1. Install system dependencies (Linux)
if [[ "$OS" == "Linux" ]] && command -v apt-get &>/dev/null; then
    echo "[1/5] Installing system dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq libgbm1 libasound2t64 2>/dev/null \
        || sudo apt-get install -y -qq libgbm1 libasound2 2>/dev/null \
        || echo "  [WARN] Some packages failed to install — manual check required"
    echo "  [OK] System dependencies installed"
else
    echo "[1/5] Skipping system dependencies (not Linux/apt)"
fi

# 2. Check Node.js
echo ""
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js is not installed."
    exit 1
fi
echo "[OK] Node.js $(node -v)"

# 3. Install playwright-cli globally
echo ""
echo "[2/5] Installing playwright-cli globally..."
sudo npm install -g @playwright/cli@latest

GLOBAL_MODULES=$(npm root -g)
PW_CLI="$GLOBAL_MODULES/@playwright/cli/node_modules/playwright-core/cli.js"

# 4. Install browser based on architecture
echo ""
echo "[3/5] Installing browser (ARCH: $ARCH)..."

if [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    echo "  x86_64 detected -> installing chrome channel"
    node "$PW_CLI" install chrome
else
    echo "  $ARCH detected -> installing chromium (chrome channel not supported)"
    node "$PW_CLI" install chromium

    # Find installed chromium path
    CHROMIUM_DIR=$(find "$HOME/.cache/ms-playwright" -maxdepth 1 -name "chromium-*" -type d | sort -V | tail -1)
    CHROMIUM_BIN="$CHROMIUM_DIR/chrome-linux/chrome"

    if [[ ! -f "$CHROMIUM_BIN" ]]; then
        echo "[ERROR] Could not find installed Chromium binary."
        echo "  Searched: $CHROMIUM_BIN"
        exit 1
    fi

    echo ""
    echo "[3/5] Creating symlink..."
    echo "  $CHROMIUM_BIN -> /opt/google/chrome/chrome"
    sudo mkdir -p /opt/google/chrome
    sudo ln -sf "$CHROMIUM_BIN" /opt/google/chrome/chrome
    echo "  [OK] Symlink created"
fi

# 5. Disable AppArmor restriction (Ubuntu 23.10+)
echo ""
if [[ "$OS" == "Linux" ]]; then
    CURRENT=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo "N/A")
    if [[ "$CURRENT" == "1" ]]; then
        echo "[4/5] Disabling AppArmor unprivileged userns restriction..."
        sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
        # Persist across reboots
        echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo tee /etc/sysctl.d/99-playwright.conf >/dev/null
        echo "  [OK] Persisted to /etc/sysctl.d/99-playwright.conf"
    else
        echo "[4/5] AppArmor restriction not active (current: $CURRENT) — skipping"
    fi
fi

# 6. Initialize workspace
echo ""
echo "[5/5] Initializing workspace..."
playwright-cli install 2>/dev/null || true

echo ""
echo "=== Installation complete ==="
echo "Usage: playwright-cli open <URL>"
