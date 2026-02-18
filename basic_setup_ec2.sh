#!/bin/bash
set -e
sudo fallocate -l 16G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab && swapon --show
/bin/bash -c "$(curl -fsSL https://cokacdir.cokac.com/install.sh)"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source /home/ubuntu/.bashrc && nvm install 24
npm install -g @playwright/cli@latest
npx -y playwright install-deps chromium
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
playwright-cli install --skills
