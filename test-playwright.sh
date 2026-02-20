#!/bin/bash
set -e

ARCH=$(uname -m)
URL="https://cokacdir.cokac.com/"
GLOBAL_MODULES=$(npm root -g)
PW_MODULES="$GLOBAL_MODULES/@playwright/cli/node_modules"

echo "=== Playwright Test: Get Page Title ==="
echo "URL: $URL"
echo "ARCH: $ARCH"

# Determine browser launch options based on architecture
if [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    LAUNCH_OPTS="{ channel: 'chrome' }"
else
    CHROMIUM_BIN=$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -path "*/chromium-*/chrome-linux/chrome" -type f | sort -V | tail -1)
    if [[ -z "$CHROMIUM_BIN" || ! -f "$CHROMIUM_BIN" ]]; then
        echo "[FAIL] Chromium binary not found."
        exit 1
    fi
    echo "Browser: $CHROMIUM_BIN"
    LAUNCH_OPTS="{ executablePath: '$CHROMIUM_BIN', args: ['--no-sandbox'] }"
fi

echo ""

TITLE=$(NODE_PATH="$PW_MODULES" node -e "
const { chromium } = require('playwright-core');
(async () => {
    const browser = await chromium.launch($LAUNCH_OPTS);
    const page = await browser.newPage();
    await page.goto('$URL');
    const title = await page.title();
    console.log(title);
    await browser.close();
})();
")

if [[ -n "$TITLE" ]]; then
    echo "[OK] Page title: $TITLE"
else
    echo "[FAIL] Could not retrieve page title."
    exit 1
fi
