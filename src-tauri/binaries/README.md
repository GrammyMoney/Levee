# Native binaries

This directory is intentionally ignored except for this README. Levee uses this folder for Windows native binaries needed by development and Tauri bundling.

Run:

```sh
pnpm run prepare:binaries
```

The script downloads and installs the required Windows x86_64 files automatically:

- `ffmpeg-x86_64-pc-windows-msvc.exe` from the latest gyan.dev FFmpeg essentials build
- `ffprobe-x86_64-pc-windows-msvc.exe` from the latest gyan.dev FFmpeg essentials build
- `libmpv-2.dll` plus its adjacent DLL dependencies from the latest `zhongfly/mpv-winbuild` `mpv-dev-x86_64` release

Use this to replace existing local binaries even if they already look valid:

```sh
pnpm run prepare:binaries -- --force
```

Tauri `externalBin` entries in `tauri.conf.json` are `binaries/ffmpeg` and `binaries/ffprobe`, so Windows MSVC builds require the target-triple suffix on those executable filenames. mpv DLLs are bundled as resources from `binaries/*.dll`.
