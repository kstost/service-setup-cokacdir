#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// --- 인자 파싱 ---
const tokens = process.argv.slice(2);

if (tokens.length === 0) {
  console.error("Usage: npx service-setup-cokacdir <BOT_TOKEN> [BOT_TOKEN2] ...");
  process.exit(1);
}

// --- cokacdir 바이너리 찾기 ---
let binaryPath;
try {
  binaryPath = execSync("which cokacdir", { encoding: "utf-8" }).trim();
} catch {
  console.error("Error: cokacdir not found in PATH.");
  console.error("Install cokacdir first, then retry.");
  process.exit(1);
}

const platform = os.platform();
const serviceName = "cokacdir";
const homeDir = os.homedir();
const tokensArg = tokens.join(" ");

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

if (platform === "linux") {
  setupLinux();
} else if (platform === "darwin") {
  setupMacOS();
} else {
  console.error(`Unsupported platform: ${platform}`);
  console.error("This tool supports Linux and macOS only.");
  process.exit(1);
}

// ============================================================
//  Linux — systemd user service
// ============================================================
function setupLinux() {
  const serviceDir = path.join(homeDir, ".config", "systemd", "user");
  const serviceFile = path.join(serviceDir, `${serviceName}.service`);
  const logDir = path.join(homeDir, ".local", "log");

  const serviceContent = `[Unit]
Description=Cokacdir Server Service
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath} --ccserver ${tokensArg}
Restart=always
RestartSec=5
StandardOutput=append:${logDir}/cokacdir.log
StandardError=append:${logDir}/cokacdir.error.log

[Install]
WantedBy=default.target
`;

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  // 기존 서비스 확인 및 중지
  const isUpdate = fs.existsSync(serviceFile);
  if (isUpdate) {
    console.log("Existing service found. Stopping for update...");
    try {
      execSync(`systemctl --user stop ${serviceName}`, { stdio: "inherit" });
    } catch {
      // 이미 멈춰있을 수 있음
    }
  }

  fs.writeFileSync(serviceFile, serviceContent, { mode: 0o644 });
  console.log(
    isUpdate
      ? `Service file updated: ${serviceFile}`
      : `Service file created: ${serviceFile}`
  );

  try {
    execSync("systemctl --user daemon-reload", { stdio: "inherit" });
    execSync(`systemctl --user enable ${serviceName}`, { stdio: "inherit" });
    execSync(`systemctl --user restart ${serviceName}`, { stdio: "inherit" });
  } catch (err) {
    console.error("Failed to register systemd user service:", err.message);
    process.exit(1);
  }

  try {
    execSync(`loginctl enable-linger ${os.userInfo().username}`, {
      stdio: "inherit",
    });
    console.log("Linger enabled: service will start on boot.");
  } catch {
    console.log(
      "Warning: could not enable linger. Service may not auto-start on boot."
    );
    console.log(
      `Run manually: loginctl enable-linger ${os.userInfo().username}`
    );
  }

  console.log("\n------------------------------------------------");
  console.log("Setup complete!");
  console.log(`Status : systemctl --user status ${serviceName}`);
  console.log(`Logs   : tail -f ${logDir}/cokacdir.log`);
  console.log(`Stop   : systemctl --user stop ${serviceName}`);
  console.log(`Remove : systemctl --user disable ${serviceName} && rm ${serviceFile}`);
  console.log("------------------------------------------------");
}

// ============================================================
//  macOS — launchd LaunchAgents
// ============================================================
function setupMacOS() {
  const agentDir = path.join(homeDir, "Library", "LaunchAgents");
  const label = `com.cokacdir.server`;
  const plistFile = path.join(agentDir, `${label}.plist`);
  const logDir = path.join(homeDir, ".local", "log");

  const programArgs = [binaryPath, "--ccserver", ...tokens];
  const argsXml = programArgs
    .map((arg) => `        <string>${escapeXml(arg)}</string>`)
    .join("\n");

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/cokacdir.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/cokacdir.error.log</string>
</dict>
</plist>
`;

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const uid = process.getuid();
  const domain = `gui/${uid}`;

  // 기존 서비스 확인 및 중지
  const isUpdate = fs.existsSync(plistFile);
  if (isUpdate) {
    console.log("Existing service found. Stopping for update...");
    try {
      execSync(`launchctl bootout ${domain}/${label}`, { stdio: "inherit" });
    } catch {
      try {
        execSync(`launchctl unload ${plistFile}`, { stdio: "inherit" });
      } catch {
        // 이미 멈춰있을 수 있음
      }
    }
  }

  fs.writeFileSync(plistFile, plistContent, { mode: 0o644 });
  console.log(
    isUpdate
      ? `Plist file updated: ${plistFile}`
      : `Plist file created: ${plistFile}`
  );

  try {
    execSync(`launchctl bootstrap ${domain} ${plistFile}`, { stdio: "inherit" });
  } catch {
    try {
      execSync(`launchctl load ${plistFile}`, { stdio: "inherit" });
    } catch (err) {
      console.error("Failed to register launchd service:", err.message);
      process.exit(1);
    }
  }

  console.log("\n------------------------------------------------");
  console.log("Setup complete!");
  console.log(`Status : launchctl list | grep ${label}`);
  console.log(`Logs   : tail -f ${logDir}/cokacdir.log`);
  console.log(`Stop   : launchctl unload ${plistFile}`);
  console.log(`Remove : launchctl unload ${plistFile} && rm ${plistFile}`);
  console.log("------------------------------------------------");
}
