#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// --- 인자 파싱 ---
const tokens = process.argv.slice(2);

if (tokens.length === 0) {
  console.error("Usage: npx service-setup-cokacdir <BOT_TOKEN> [BOT_TOKEN2] ...");
  process.exit(1);
}

const emptyIdx = tokens.findIndex((t) => t.trim() === "");
if (emptyIdx !== -1) {
  console.error(`Error: token at position ${emptyIdx + 1} is empty.`);
  process.exit(1);
}

// --- PATH를 직접 순회하여 실행 파일 탐색 (which 의존성 제거) ---
function findInPath(name) {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 이 디렉토리에는 없음
    }
  }
  return null;
}

// --- cokacdir 바이너리 찾기 ---
const binaryPath = findInPath("cokacdir");
if (!binaryPath) {
  console.error("Error: cokacdir not found in PATH.");
  console.error("Install cokacdir first, then retry.");
  process.exit(1);
}

const platform = os.platform();
const serviceName = "cokacdir";
const homeDir = os.homedir();

// 셸 스크립트에 삽입할 인자를 싱글-쿼트로 이스케이프
function escapeShellArg(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// XML 1.0에서 허용되지 않는 제어 문자(U+0000-U+0008, U+000B, U+000C, U+000E-U+001F)를
// 제거한 뒤 XML 특수 문자를 이스케이프
function escapeXml(str) {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// systemd ExecStart 인자 이스케이프:
//   \        → \\   (백슬래시)
//   "        → \"   (큰따옴표)
//   $        → $$   (systemd 환경변수 확장 방지)
//   %        → %%   (systemd specifier 확장 방지: %h, %u 등)
//   \n \r \t → C-스타일 이스케이프
//   그 외 제어 문자 → 제거
// 결과를 큰따옴표로 감싸 공백 포함 인자도 단일 토큰으로 처리
function escapeSystemdArg(str) {
  return (
    '"' +
    str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, () => "$$")
      .replace(/%/g, "%%")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") +
    '"'
  );
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
  // systemctl 사용 가능 여부 확인
  if (!findInPath("systemctl")) {
    console.error("Error: systemctl not found. This tool requires systemd.");
    process.exit(1);
  }

  const serviceDir = path.join(homeDir, ".config", "systemd", "user");
  const serviceFile = path.join(serviceDir, `${serviceName}.service`);

  // XDG_STATE_HOME 기반 로그 디렉터리 (XDG Base Directory Specification 준수)
  const xdgStateHome =
    process.env.XDG_STATE_HOME || path.join(homeDir, ".local", "state");
  const logDir = path.join(xdgStateHome, "cokacdir");

  // systemd는 경로 내 $ 및 % 를 특수 문자로 해석하므로 이스케이프
  const systemdLogDir = logDir
    .replace(/\$/g, () => "$$")
    .replace(/%/g, "%%");

  // 래퍼 스크립트: bash -i 로 사용자 셸 환경(PATH 포함)을 매 시작마다 로드
  const wrapperFile = path.join(logDir, "run.sh");
  const shellArgs = tokens.map(escapeShellArg).join(" ");
  const wrapperContent = `#!/bin/bash -i
exec ${escapeShellArg(binaryPath)} --ccserver -- ${shellArgs}
`;

  const execStart = escapeSystemdArg(wrapperFile);

  // StandardOutput=append: 는 systemd v240 이상에서 지원
  // file: 은 v236 이상, 그 미만은 journal로 폴백
  const systemdVersion = (() => {
    const r = spawnSync("systemctl", ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) return 0;
    const m = r.stdout.match(/systemd (\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  })();

  const stdoutDirective =
    systemdVersion >= 240
      ? `append:${systemdLogDir}/cokacdir.log`
      : systemdVersion >= 236
        ? `file:${systemdLogDir}/cokacdir.log`
        : "journal";

  const stderrDirective =
    systemdVersion >= 240
      ? `append:${systemdLogDir}/cokacdir.error.log`
      : systemdVersion >= 236
        ? `file:${systemdLogDir}/cokacdir.error.log`
        : "journal";

  const serviceContent = `[Unit]
Description=Cokacdir Server Service
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=5
StandardOutput=${stdoutDirective}
StandardError=${stderrDirective}

[Install]
WantedBy=default.target
`;

  try {
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    console.error(`Error: failed to create directories: ${err.message}`);
    process.exit(1);
  }

  // 래퍼 스크립트 작성 (토큰 포함이므로 0o700)
  try {
    fs.writeFileSync(wrapperFile, wrapperContent, { mode: 0o700 });
  } catch (err) {
    console.error(`Error: failed to write wrapper script: ${err.message}`);
    process.exit(1);
  }

  // 기존 서비스 확인 및 중지
  const isUpdate = fs.existsSync(serviceFile);
  if (isUpdate) {
    console.log("Existing service found. Stopping for update...");
    // 이미 멈춰있을 수 있으므로 실패 무시
    spawnSync("systemctl", ["--user", "stop", serviceName], { stdio: "inherit" });
  }

  // 토큰이 포함된 파일이므로 소유자만 읽을 수 있도록 0o600
  try {
    fs.writeFileSync(serviceFile, serviceContent, { mode: 0o600 });
  } catch (err) {
    console.error(`Error: failed to write service file: ${err.message}`);
    process.exit(1);
  }
  console.log(
    isUpdate
      ? `Service file updated: ${serviceFile}`
      : `Service file created: ${serviceFile}`
  );

  const reloadResult = spawnSync("systemctl", ["--user", "daemon-reload"], {
    stdio: "inherit",
  });
  if (reloadResult.error || reloadResult.status !== 0) {
    if (reloadResult.error) console.error(`Error: ${reloadResult.error.message}`);
    console.error("Failed to reload systemd daemon.");
    console.error(
      "Make sure the systemd user session is running (loginctl session-status)."
    );
    process.exit(1);
  }

  const enableResult = spawnSync("systemctl", ["--user", "enable", serviceName], {
    stdio: "inherit",
  });
  if (enableResult.error || enableResult.status !== 0) {
    if (enableResult.error) console.error(`Error: ${enableResult.error.message}`);
    console.error("Failed to enable service.");
    process.exit(1);
  }

  const restartResult = spawnSync("systemctl", ["--user", "restart", serviceName], {
    stdio: "inherit",
  });
  if (restartResult.error || restartResult.status !== 0) {
    if (restartResult.error) console.error(`Error: ${restartResult.error.message}`);
    console.error("Failed to start service.");
    process.exit(1);
  }

  const username = os.userInfo().username;
  const lingerResult = spawnSync("loginctl", ["enable-linger", username], {
    stdio: "inherit",
  });
  if (!lingerResult.error && lingerResult.status === 0) {
    console.log("Linger enabled: service will start on boot.");
  } else {
    console.log(
      "Warning: could not enable linger. Service may not auto-start on boot."
    );
    console.log(`Run manually: loginctl enable-linger "${username}"`);
  }

  const logHint =
    systemdVersion >= 236
      ? `tail -f ${logDir}/cokacdir.log`
      : `journalctl --user -u ${serviceName} -f`;

  console.log("\n------------------------------------------------");
  console.log("Setup complete!");
  // 참고: 토큰은 서비스 파일 및 프로세스 목록(ps)에 노출될 수 있습니다.
  console.log(`Status : systemctl --user status ${serviceName}`);
  console.log(`Logs   : ${logHint}`);
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
  const logDir = path.join(homeDir, "Library", "Logs", "cokacdir");

  // 래퍼 스크립트: 토큰을 별도 파일에 분리 (0o700)
  // launchd가 /bin/zsh -li 로 직접 호출하여 ~/.zprofile + ~/.zshrc 소싱
  const wrapperFile = path.join(logDir, "run.sh");
  const shellArgs = tokens.map(escapeShellArg).join(" ");
  const wrapperContent = `#!/bin/zsh
exec ${escapeShellArg(binaryPath)} --ccserver -- ${shellArgs}
`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-li</string>
        <string>${escapeXml(wrapperFile)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logDir)}/cokacdir.log</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logDir)}/cokacdir.error.log</string>
</dict>
</plist>
`;

  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    console.error(`Error: failed to create directories: ${err.message}`);
    process.exit(1);
  }

  // 래퍼 스크립트 작성 (토큰 포함이므로 0o700)
  try {
    fs.writeFileSync(wrapperFile, wrapperContent, { mode: 0o700 });
  } catch (err) {
    console.error(`Error: failed to write wrapper script: ${err.message}`);
    process.exit(1);
  }

  const uid = process.getuid();
  const domain = `gui/${uid}`;

  // 기존 서비스 확인 및 중지
  const isUpdate = fs.existsSync(plistFile);
  if (isUpdate) {
    console.log("Existing service found. Stopping for update...");
    // 이미 멈춰있을 수 있으므로 실패 무시
    spawnSync("launchctl", ["bootout", `${domain}/${label}`], { stdio: "inherit" });
  }

  // 토큰이 포함된 파일이므로 소유자만 읽을 수 있도록 0o600
  try {
    fs.writeFileSync(plistFile, plistContent, { mode: 0o600 });
  } catch (err) {
    console.error(`Error: failed to write plist file: ${err.message}`);
    process.exit(1);
  }
  console.log(
    isUpdate
      ? `Plist file updated: ${plistFile}`
      : `Plist file created: ${plistFile}`
  );

  // enable 실패는 치명적이지 않음 — bootstrap 계속 시도
  const enableResult = spawnSync("launchctl", ["enable", `${domain}/${label}`], {
    stdio: "inherit",
  });
  if (enableResult.error || enableResult.status !== 0) {
    console.warn("Warning: launchctl enable failed. Service may not persist after reboot.");
    console.warn(`Run manually to fix: launchctl enable ${domain}/${label}`);
  }

  const bootstrapResult = spawnSync("launchctl", ["bootstrap", domain, plistFile], {
    stdio: "inherit",
  });
  if (bootstrapResult.error || bootstrapResult.status !== 0) {
    if (bootstrapResult.error) console.error(`Error: ${bootstrapResult.error.message}`);
    console.error("Failed to register launchd service.");
    process.exit(1);
  }

  console.log("\n------------------------------------------------");
  console.log("Setup complete!");
  // 참고: 토큰은 서비스 파일 및 프로세스 목록(ps)에 노출될 수 있습니다.
  console.log(`Status : launchctl list | grep ${label}`);
  console.log(`Logs   : tail -f ${logDir}/cokacdir.log`);
  console.log(`Stop   : launchctl bootout gui/$(id -u)/${label}`);
  console.log(`Remove : launchctl bootout gui/$(id -u)/${label} && rm "${plistFile}"`);
  console.log("------------------------------------------------");
}
