# service-setup-cokacdir

[cokacdir](https://cokacdir.cokac.com) 텔레그램 봇 서버를 **명령어 한 줄**로 시스템 서비스에 등록합니다.

- Linux, macOS 자동 감지
- `sudo` 불필요
- 서버 재부팅 시 자동 시작
- 죽어도 자동 재시작
- 토큰 변경 시 같은 명령어로 업데이트

## 설치 & 실행

```bash
npx -y service-setup-cokacdir <봇토큰>
```

토큰 여러 개도 가능합니다.

```bash
npx -y service-setup-cokacdir <봇토큰1> <봇토큰2> <봇토큰3>
```

이게 끝입니다. OS를 자동 감지하여 서비스가 바로 시작됩니다.

## 토큰 변경

같은 명령어를 다시 실행하면 됩니다. 기존 서비스를 자동으로 멈추고 새 설정으로 재시작합니다.

```bash
npx -y service-setup-cokacdir <새로운토큰1> <새로운토큰2>
```

## 서비스 관리

### Linux

```bash
# 상태 확인
systemctl --user status cokacdir

# 로그 보기
tail -f ~/.local/log/cokacdir.log

# 중지
systemctl --user stop cokacdir

# 완전 삭제
systemctl --user disable cokacdir && rm ~/.config/systemd/user/cokacdir.service
```

### macOS

```bash
# 상태 확인
launchctl list | grep com.cokacdir.server

# 로그 보기
tail -f ~/.local/log/cokacdir.log

# 중지
launchctl unload ~/Library/LaunchAgents/com.cokacdir.server.plist

# 완전 삭제
launchctl unload ~/Library/LaunchAgents/com.cokacdir.server.plist && rm ~/Library/LaunchAgents/com.cokacdir.server.plist
```

## 동작 원리

이 명령어를 실행하면 OS를 자동 감지하여 아래 과정이 수행됩니다.

| | Linux | macOS |
|--|--|--|
| 서비스 파일 | `~/.config/systemd/user/cokacdir.service` | `~/Library/LaunchAgents/com.cokacdir.server.plist` |
| 등록 명령 | `systemctl --user enable & start` | `launchctl load` |
| 자동 재시작 | `Restart=always` | `KeepAlive=true` |
| 부팅 시 시작 | `loginctl enable-linger` | `RunAtLoad=true` |

## 요구사항

- Linux (systemd) 또는 macOS
- [cokacdir](https://cokacdir.cokac.com) 설치 완료
- Node.js >= 14

## License

MIT
