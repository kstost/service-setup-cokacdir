# service-setup-cokacdir

Registers the [cokacdir](https://cokacdir.cokac.com) Telegram bot server as a system service with a single command.

- Automatically detects Linux and macOS
- No `sudo` required
- Starts automatically on boot
- Restarts automatically on crash
- Re-run the same command to update tokens

## Install & Run

```bash
npx -y service-setup-cokacdir <BOT_TOKEN>
```

Multiple tokens are supported.

```bash
npx -y service-setup-cokacdir <BOT_TOKEN1> <BOT_TOKEN2> <BOT_TOKEN3>
```

That's it. The OS is detected automatically and the service starts immediately.

## Updating Tokens

Just re-run the same command. The existing service is stopped automatically and restarted with the new configuration.

```bash
npx -y service-setup-cokacdir <NEW_TOKEN1> <NEW_TOKEN2>
```

## Service Management

### Linux

```bash
# Check status
systemctl --user status cokacdir

# View logs
tail -f ~/.local/log/cokacdir.log

# Stop
systemctl --user stop cokacdir

# Remove completely
systemctl --user disable cokacdir && rm ~/.config/systemd/user/cokacdir.service
```

### macOS

```bash
# Check status
launchctl list | grep com.cokacdir.server

# View logs
tail -f ~/Library/Logs/cokacdir/cokacdir.log

# Stop
launchctl bootout gui/$(id -u)/com.cokacdir.server

# Remove completely
launchctl bootout gui/$(id -u)/com.cokacdir.server && rm ~/Library/LaunchAgents/com.cokacdir.server.plist
```

## How It Works

The command detects the OS and performs the following steps.

| | Linux | macOS |
|--|--|--|
| Service file | `~/.config/systemd/user/cokacdir.service` | `~/Library/LaunchAgents/com.cokacdir.server.plist` |
| Registration | `systemctl --user enable & start` | `launchctl enable` + `launchctl bootstrap` |
| Auto-restart | `Restart=always` | `KeepAlive=true` |
| Start on boot | `loginctl enable-linger` | `RunAtLoad=true` |
| Log directory | `~/.local/log/` | `~/Library/Logs/cokacdir/` |

## Requirements

- Linux (systemd) or macOS
- [cokacdir](https://cokacdir.cokac.com) installed
- Node.js >= 14

## License

MIT
