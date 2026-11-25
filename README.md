# <img align="center" src="https://github.com/drlight17/ribbons-tauri/raw/main/ribbons%20publish.jpg">
Famous Windows-like Ribbons Screensaver rewritten for multi-platform support with **Tauri 2 (Rust)**.

<table>
  <thead>
    <tr>
      <th>Style</th>
      <th>Example</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>New modern</strong></td>
      <td><img src="https://github.com/drlight17/ribbons-tauri/raw/main/ribbons_modern-example.gif" width="100%"></td>
    </tr>
    <tr>
      <td><strong>Classic polygon</strong></td>
      <td><img src="https://github.com/drlight17/ribbons-tauri/raw/main/ribbons-example.gif" width="100%"></td>
    </tr>
  </tbody>
</table>

## Minimum OS requirements

- macOS 14.6+
- Windows 10+
- Linux with a modern kernel (>= 6.x) and PipeWire/PulseAudio

## Download and install

Go to the landing page https://ribbons.drlight.fun, download the latest build for your platform and follow the installer.

## Settings

Settings are stored in `config.json` in the same per-user locations as before:

- Windows: `%AppData%\Ribbons Screensaver`
- Linux: `~/.config/Ribbons Screensaver`
- macOS: `~/Library/Application Support/Ribbons Screensaver`

Development builds use a `-dev` suffix.

## Linux notes

- Fullscreen detection uses **wctx** on Wayland and **xprop** on X11. On Wayland, install `wctx` and enable its user daemon. On X11, install `xprop`.
- Idle/user activity is read from `/dev/input/event*` (evdev), which is reliable on KWin/Wayland where `ScreenSaver.GetActiveTime` often returns 0. Add the user to the `input` group and log in again:
  `sudo usermod -aG input $USER`.
- Screen lock/suspend events use freedesktop DBus services (`org.freedesktop.ScreenSaver`, `org.freedesktop.login1`). If evdev is unavailable the app falls back to DBus idle time and simply skips activity-based auto-stop until input becomes readable.
- System audio detection uses `parec` against the default monitor source (`@DEFAULT_MONITOR@`).
- On Wayland, support depends on the compositor. KDE Plasma and GNOME are the tested environments.

### <ins>So for all the platforms make sure to disable "native" screensaver to prevent conflicts!</ins>

After app startup check it's settings in tray menu:
<img align="center" width="200" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/refs/heads/main/3.png">

## Building from source

Install the platform build dependencies. On Arch/CachyOS, Debian/Ubuntu the helper script covers the common packages:

```bash
chmod +x ./prepare.sh
./prepare.sh
```

Then:

```bash
npm run dev        # development
npm run build      # platform bundles
npm run help       # all build commands and paths
```

On Linux the build helpers run Tauri through `fakeroot` when available. This
makes `.deb` archives use root-owned entries; without it, users with UID/GID
values longer than six digits can produce a corrupt package header.

Build helpers from the original project are still available:

```bash
npm run build-json
npm run build-deb
npm run build-rpm
npm run build-AppImage
npm run build-targz
npm run build-exe
npm run build-msi
npm run build-zip
npm run build-dmg
npm run build-zip-mac
npm run build-linux   # rpm + deb + tar.gz + AppImage
npm run build-win     # zip + msi + nsis
npm run build-mac     # dmg + zip for x86_64 and arm64
npm run build-mac -- --universal   # one universal dmg + zip
```

`build-mac` runs on either Intel or Apple Silicon macOS, installs the required Rust targets, and produces signed x86_64 and arm64 artifacts in `src-tauri/target/<target>/release/{bundle,}`. `latest.json` and `latest-mac.json` then contain both `darwin-x86_64` and `darwin-aarch64`. Use `--universal` for a single universal build instead.

`npm run block` creates `UPDATE_BLOCK` before a build; `npm run unblock` removes it. The deb and rpm helpers block self-updates because Tauri’s updater only supports AppImage on Linux; deb/rpm installations should update through the OS package manager. As an extra safeguard, packaged Linux builds only enable self-update when running as an AppImage (`APPIMAGE` is set). The dmg helper does not block self-updates.

### Updater signing

Tauri verifies update artifacts. The repository ships a placeholder key so development builds work without signing. For production self-updates:

1. Generate a key pair with `npx @tauri-apps/cli signer generate`.
2. Replace `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
3. Set `TAURI_SIGNING_PRIVATE_KEY` (or `TAURI_SIGNING_PRIVATE_KEY_PATH`) (and its password `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) when building.
4. Build on each OS. Each build writes a per-platform manifest that contains both its updater `platforms` entries and the full list of signed bundles:
   - `latest-linux.json` — AppImage, deb and rpm
   - `latest-win.json` — MSI and NSIS installer
   - `latest-mac.json` — app updater archive and signed DMG
5. Copy those three files into one checkout (the repository root) and merge them into a single updater manifest:
   ```bash
   npm run merge-latest
   # or: node scripts/merge-latest.mjs latest-linux.json latest-win.json latest-mac.json -o latest.json
   ```
6. Upload the merged `latest.json` together with every signed artifact it references. The per-platform `latest-*.json` files are optional release assets; the updater only reads `latest.json`.

The merged `latest.json` keeps the updater `platforms` map (one preferred artifact per OS/arch, e.g. AppImage on Linux) and also contains a `bundles` array with every signed bundle, including deb and rpm. Tauri’s updater ignores `bundles`; use it for release tooling or manual downloads.

Until then, the version-check dialog still works and the **Yes** button opens the release page.

## Architecture

```
ui/                 # HTML/CSS/JS renderer (ribbon engines, settings, update dialog)
src-tauri/src/      # Rust backend
  config.rs         # JSON store + defaults (same config.json keys)
  windows.rs        # screensaver/settings windows, fullscreen, options IPC
  tray.rs           # tray icon and dynamic menu
  monitor.rs        # idle/fullscreen/activity loop
  media.rs          # system audio RMS detection
  active_window.rs  # cross-platform active-window/fullscreen detection
  system_events.rs  # lock/suspend listeners and resume watchdog
  autostart.rs      # startup integrations and app restart
  updates.rs        # GitHub version checks and updater dialog
legacy-electron/    # original Electron main process, kept for reference
```

The renderer talks to Rust through `ui/tauri-ipc.js`:

- `send(event, payload)` → `renderer_message` command.
- `on(event, handler)` → Tauri event listener.
- Backend → window events: `send-options`, `send-stop`, `send-pause`, `show-close-btn`, `ribbons-settings-load`.

## Special thanks to

- [madve2](https://github.com/madve2) for the [electron-screensaver-seed repo](https://github.com/madve2/electron-screensaver-seed) that was partly used to create the initial Electron app.
- [fadyehabamer](https://github.com/fadyehabamer) for the [Ribbons-Screensaver repo](https://github.com/fadyehabamer/Ribbons-Screensaver) that is the basis for the graphics.
- [CilginSinek](https://github.com/CilginSinek) for [electron-native-screenshare](https://github.com/CilginSinek/electron-native-screenshare), which inspired the system-audio detection approach.

All rights belong to their authors.
