# Levee — Project Handoff (for the macOS client effort)

> **Audience:** a fresh Claude instance (or engineer) on a Mac, starting a macOS client for Levee.
> **Source of truth:** this doc was generated from the actual Windows codebase at repo root.
> When in doubt, read the file referenced — paths are relative to the repo root.
> **Generated:** 2026-06-27, against `main` @ `d9f09ef` (v0.2.0 + post-merge fixes).

---

## 1. What Levee is

Levee is a **Windows desktop professional video player** built for editors/DITs who work off
**cloud file-streaming drives**. The two things that make it special:

1. **Proxy workflow** — generate a lightweight H.264 proxy for a heavy source (ProRes/DNxHR/MXF),
   and toggle between proxy and original **in place** with the `P` key (resumes at the same
   timestamp). Proxies live in a shared folder on the drive so a whole team reuses them.
2. **Provider-aware caching** — "pin"/"pre-cache" files for offline/fast local access through the
   drive's streaming client. Two providers are supported: **Suite** and **LucidLink** (plus
   plain **Local**). The player surfaces pin/pre-cache controls inline.

It also does: directory/library browsing, thumbnails, technical metadata (ffprobe), frame
stepping, speed control, "set as default player", and file-association launch.

**Current state:** v0.2.0 shipped (LucidLink support + provider-modular caching). A large
community refactor (PR #1 by **bvoo**) was just merged, splitting the monolith into clean
modules. Everything builds green on Windows.

**Tech stack:** Tauri v2 (Rust backend + WebView2) · React 19 + TypeScript 5.8 · Vite 6 ·
Tailwind v4 · pnpm 10.26.1. Rust talks to **libmpv** over raw FFI for playback.

---

## 2. Repo, tooling, how to run (Windows today)

- Package manager: **pnpm** (`packageManager: pnpm@10.26.1`). Not npm.
- Install: `pnpm install` (note: pnpm 10 blocks postinstall scripts; if vitest/esbuild
  misbehave, `pnpm rebuild esbuild`).
- Dev: `pnpm tauri dev`. Frontend-only: `pnpm dev` (Vite on `127.0.0.1:1420`).
- Tests: `pnpm test` (vitest — `src/domain/*.test.ts`).
- Typecheck: `pnpm exec tsc --noEmit`. Format: `pnpm run format` (Prettier + `cargo fmt`).
- A `.githooks/pre-commit` runs `pnpm run format`. `scripts/prepare-binaries.js` stages sidecars.

### Native binaries are **gitignored** (never commit them)
`src-tauri/binaries/` holds large binaries kept OUT of git:
- `libmpv-2.dll` (Windows libmpv) — loaded at runtime via `libloading`.
- `ffmpeg` / `ffprobe` sidecars (Tauri `externalBin`).
See `src-tauri/binaries/README.md` for how they're obtained. **Do not commit binaries.**

---

## 3. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  WebView (transparent)  —  React UI (chrome floats on top)   │
│  ─ Player controls, Library, MetadataPanel, DriveSettings    │
└───────────────▲───────────────────────┬─────────────────────┘
                │ Tauri invoke()         │ Tauri events ("mpv-state","open-file")
                │ (commands)             ▼
┌───────────────┴─────────────────────────────────────────────┐
│  Rust backend (src-tauri/src)                                │
│  ─ mpv.rs        FFI to libmpv (client + render API)         │
│  ─ dcomp.rs      Windows compositor: mpv→D3D11→DirectComp.   │  ◄── the platform-specific core
│  ─ cache.rs      provider dispatch (suite / lucid CLIs)      │
│  ─ *_commands.rs Tauri command handlers                      │
│  ─ proxy_paths   deterministic proxy/thumb/db locations      │
└──────────────────────────────────────────────────────────────┘
        │ libmpv FFI                       │ child processes
        ▼                                  ▼
   libmpv-2.dll                      ffmpeg / ffprobe / suite / lucid
```

**The key idea for video rendering (and the heart of the macOS port):** the WebView window is
**transparent** with **no decorations**. mpv does **not** draw into the WebView. Instead mpv
renders frames in **software mode** into a CPU buffer; the Rust side uploads that to a D3D11
texture and presents it on a **DirectComposition swapchain composited *behind* the WebView**.
So the React UI literally floats over the video. See `src-tauri/src/dcomp.rs:1` (the module
doc explains it).

---

## 4. The video pipeline — Windows impl & macOS porting strategy ⭐

This is the only genuinely hard part of the port. Everything else is plumbing.

### 4.1 How it works on Windows
- `src-tauri/src/mpv.rs` — hand-written FFI to libmpv. It loads `libmpv-2.dll` at runtime
  (`libloading`), resolves a subset of symbols (client API + **software render API**), and wraps
  them. `Handle::create()` sets pre-init options: `vo=libmpv`, `idle=yes`, `keep-open=yes`,
  `hwdec=no` (software decode), etc. `RenderCtx::create_sw()` opens an `MPV_RENDER_API_TYPE` =
  `"sw"` context; `render_sw()` renders the current frame into a CPU buffer as **`bgr0`** with a
  64-byte-aligned stride.
- `src-tauri/src/dcomp.rs` — Windows-only (`#[cfg(windows)]`). Spawns a thread that: creates a
  D3D11 device + a DXGI **composition** swapchain, a `IDCompositionTarget` via
  `CreateTargetForHwnd(hwnd, topmost=false)` so it sits **behind** the WebView, then loops:
  wait for mpv's render-update callback → `render_sw()` into the CPU buffer → `UpdateSubresource`
  to a texture → `CopyResource` to the backbuffer → `Present`. Handles live window resizes via a
  shared `AtomicU64` packed size.
- `src-tauri/src/lib.rs` wires it up in `setup()` (`#[cfg(windows)]` block ~`lib.rs:450`): load
  libmpv, create the handle, grab the window `hwnd`, `dcomp::start(...)`, and start
  `start_mpv_event_thread()` which `observe`s `time-pos/duration/pause/eof-reached/speed/volume`
  and `emit`s a `"mpv-state"` event to the frontend on every change.
- All `mpv_*` Tauri commands (`mpv_load`, `mpv_seek`, etc.) are `#[cfg(windows)]`; the non-Windows
  arms already exist as **stubs that return Ok/err** — so the crate compiles on macOS today, it
  just won't play anything.

### 4.2 macOS porting options (pick one — recommend evaluating in this order)

**Option A — Embed an NSView and let mpv render itself (recommended first attempt).**
On macOS, libmpv can render directly into a native view: set `wid` to an `NSView*` (or use
`vo=libmpv` + the Metal/OpenGL render API into a `CAMetalLayer`/`CAOpenGLLayer`). The simplest
variant: create a child `NSView` in the Tauri window's content view, ordered **below** the
transparent `WKWebView`, hand its pointer to mpv as `wid`, and let mpv's `vo=gpu` +
`hwdec=videotoolbox` do hardware decode and drawing. This deletes almost all of `dcomp.rs` — no
manual render loop, no CPU readback. The catch to validate: getting the `WKWebView` to stay
transparent and z-ordered above the mpv view inside one Tauri window (you have the `NSWindow`
via `raw-window-handle`/`tauri::Window::ns_window()`).

**Option B — Reuse the software render path, blit to a Metal/IOSurface layer (most faithful).**
Keep `mpv.rs` as-is (the `sw` render API is platform-neutral) and write a `coreanim.rs` that
replaces `dcomp.rs`: render into the same `bgr0` CPU buffer, upload to a Metal texture or an
`IOSurface`-backed `CALayer`, and place that layer beneath the transparent webview. More code
than A, but it mirrors the proven Windows design exactly and keeps behavior identical. Note
`bgr0` byte order maps to Metal `bgra8Unorm` (ignore alpha).

**Option C — mpv OpenGL/Metal render API into a `CA*Layer`.** Hardware render path without
embedding mpv's own VO. Most performant but most FFI work: you'd add the
`MPV_RENDER_API_TYPE_OPENGL` (or Metal) params and a GL/Metal context to `mpv.rs`. Probably
overkill for v1.

**Recommendation:** prototype **Option A** (least code, HW decode for free). If the
webview/native-view layering fights you, fall back to **Option B** (known-good architecture).
Either way `mpv.rs`'s client-API half (commands, property observation, the event thread) ports
**unchanged** — only the rendering half differs.

### 4.3 mpv settings to change for macOS
- `hwdec`: `no` → **`videotoolbox`**.
- `vo`: stays `libmpv` for render-API (B/C) or `gpu` for embedded (A).
- libmpv filename: Windows `libmpv-2.dll` → macOS **`libmpv.2.dylib`** (or `.dylib`). Update
  `find_libmpv()` in `mpv.rs:110` and the `SetDllDirectoryW` block (Windows-only — skip on mac).

---

## 5. Backend module map

| File | Responsibility |
|---|---|
| `lib.rs` | App setup, state (`DbPool`, `AppState`, `MpvState`, `PendingOpen`), `mpv_*` commands, `invoke_handler` registry, mpv event thread. |
| `mpv.rs` | libmpv FFI: `Handle` (client API), `RenderCtx` (sw render API). **Reusable on mac (client half).** |
| `dcomp.rs` | **Windows-only** DirectComposition/D3D11 compositor. **Replace for mac.** |
| `cache.rs` | `Provider {Local,Suite,LucidLink}`; `pin/unpin/suite_list/lucid_list` → `suite`/`lucid` CLIs. |
| `file_commands.rs` | `pick_file`, `list_directory`, `list_drives`, `get_sibling_files`, `open_folder`, `open_url`, `set_as_default_player`, `get_file_size`. **Several are Windows-specific (see §9).** |
| `media_probe.rs` / `media_format.rs` | ffprobe wrapper → `ProbeData`; human-readable formatting. |
| `proxy_commands.rs` | `generate_proxy` (ffmpeg), `get_proxy`, `get_proxies_batch`, `delete_proxy`, `get_proxies_root`. |
| `proxy_paths.rs` | Deterministic `{driveRoot}\Levee\{Proxies,Thumbnails}` + FNV-1a hashed filenames + `levee.db` location. |
| `thumbnail_commands.rs` | `get_thumbnail` (ffmpeg frame grab). |
| `process_tools.rs` | `quiet_command` (spawns child procs; hides console window on Windows). |
| `suite_commands.rs` | Provider-routed Tauri commands: `set_drive_providers`, `precache_add/remove/list`, `precache_proxies_folder`. |

### IPC surface — commands (Rust `#[tauri::command]` ↔ `src/api/tauri.ts`)
`pick_file`, `take_launch_file`, `set_as_default_player`, `open_url`, `open_folder`,
`get_sibling_files`, `get_file_size`, `get_probe_data`, `get_proxy`, `generate_proxy`,
`get_proxies_root`, `get_proxies_batch`, `delete_proxy`, `list_directory`, `list_drives`,
`get_thumbnail`, `set_drive_providers`, `precache_add`, `precache_remove`, `precache_list`,
`precache_proxies_folder`, and the player: `mpv_load`, `mpv_set_pause`, `mpv_seek`,
`mpv_seek_by`, `mpv_frame_step`, `mpv_set_volume`, `mpv_set_mute`, `mpv_set_speed`,
`mpv_set_loop`.

### IPC surface — events (Rust `emit` ↔ `src/api/events.ts`)
- `"mpv-state"` → `{ timePos, duration, paused, volume, speed, eof }` (camelCase). The single
  source of truth for the player UI; emitted on every observed property change.
- `"open-file"` → `string[]` of file paths (from the single-instance plugin when a second launch
  forwards a file).

---

## 6. Provider / caching model

A "drive" is mapped to a **provider**: `local | suite | lucidlink`. The mapping is set in the UI
(Drive Settings), persisted to `localStorage` (`levee_drive_providers`, migrates from legacy
`levee_suite_roots`), and synced to Rust via `set_drive_providers`. Only **managed** (non-local)
drives get proxy/thumbnail/pre-cache features and a **shared** `levee.db`.

CLI dispatch (`cache.rs`):
- **Suite:** `suite pre-cache add|remove --path <ABS>`; `suite pre-cache list` → JSON
  (`PreCacheEntries[].Path`).
- **LucidLink:** `lucid pin "<path relative to filespace root>"`, `lucid pin --unset "<rel>"`,
  `lucid pin` (lists a fixed-width table; first column is the path, gap to STATE is 2+ spaces).
- **Local:** no-op.

Both `suite` and `lucid` ship macOS CLIs; the **subcommands/syntax are the same**. The argument
*paths* differ because macOS has no drive letters (see §9).

---

## 7. Data conventions (DB + proxy/thumbnail layout) — ⚠️ cross-platform interop note

For each **managed drive root**:
- DB: `{driveRoot}\Levee\levee.db` (SQLite). Schema (`lib.rs:34`): tables `proxies(original_path
  PK, proxy_path, created_at)` and `thumbnails(original_path PK, thumbnail_path, created_at)`.
  Local/unmanaged drives use an app-data-dir local `levee.db` instead.
- Proxies: `{driveRoot}\Levee\Proxies\{xx}\{yy}\{hash16}.mp4`
- Thumbnails: `{driveRoot}\Levee\Thumbnails\{xx}\{yy}\{hash16}.jpg`
- `hash16` = 16-hex FNV-1a of the **normalized original path** (`proxy_paths.rs:3`), where
  normalize = lowercase + backslashes→forward-slashes.

**⚠️ Interop decision for the Mac client:** the hash is currently computed over the **absolute**
path. On Windows that's `Y:\A\B.mp4` → `y:/a/b.mp4`; on macOS the *same* file on the same
filespace is `/Volumes/Filespace/A/B.mp4` → a different string → a **different hash**. As written,
proxies/thumbnails generated on Windows will NOT be found by the Mac client and vice-versa. To
make a team's proxy cache shared across OSes, change the hash input to the path **relative to the
filespace/drive root** (e.g. `a/b.mp4`) on both clients. **Flag this to Alex before deciding** —
it's a deliberate format choice and affects the Windows app too. The `Levee/Proxies` etc. folder
conventions themselves are fine to keep identical.

### Proxy ffmpeg recipe (`proxy_commands.rs::generate_proxy`)
H.264 MP4, includes a ProRes color fix: `-hide_banner -loglevel error`,
`-map 0:v:0 -map 0:a:0?`, `-vf "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,
scale=trunc(iw/4)*2:trunc(ih/4)*2,format=yuv420p"`, `-ac 2`. Same ffmpeg invocation works on mac.

---

## 8. Frontend structure (largely portable as-is)

- `src/api/` — typed wrappers: `tauri.ts` (invoke), `events.ts` (listen), `window.ts`.
- `src/domain/` — pure logic + vitest tests: `path.ts`, `media.ts`, `player.ts`
  (`PLAYBACK_RATES`, player state/control types).
- `src/hooks/` — `useMpvPlayer.ts` (owns playback state from `mpv-state`, exposes `controls` +
  `openFile(path, seekTo?)`), `useAutoHide.ts`, `useKeyboardShortcuts.ts`.
- `src/contexts/` — `SuiteContext` (providers + pre-cache state; the type is exported as
  `Provider`), `SettingsContext` (`preferProxies`, onboarding flags), `ProxyContext` (proxy
  generation queue).
- `src/components/` — `Player/` (`index.tsx`, `TopBar`, `Controls`, `ChevronNav`,
  `VideoElement` = a transparent click-catcher, since real video is behind the webview),
  `Library/` (browser + `DriveSettingsPanel`), `MetadataPanel/`, `Dropdown`, `icons.tsx`,
  `DefaultPlayerPrompt`.
- `src/accent.ts` — provider accent colors (sky = Suite, lime = LucidLink) + `pinVerb`.

**Proxy toggle resume** (recently fixed, `useMpvPlayer.ts`): pressing `P` captures `currentTime`,
swaps the active file, and re-issues a seek until `time-pos` lands near the target (a single
post-`loadfile` seek gets dropped while mpv inits the demuxer → it would restart at 0). Keep this
behavior on mac.

Frontend touch points that assume Windows: `domain/path.ts` (`normalizeDriveRoot`,
`normalizePath` assume `C:\` + backslashes) and `SuiteContext`'s drive-root keys. These need
POSIX-aware variants (volume mount points instead of drive letters).

---

## 9. Platform-specific inventory — what must change for macOS

| Area | Windows today | macOS needs |
|---|---|---|
| **Video compositor** | `dcomp.rs` (D3D11 + DirectComposition) | New module (see §4.2). Biggest task. |
| **libmpv load** | `libmpv-2.dll` + `SetDllDirectoryW` | `libmpv.2.dylib`; update `find_libmpv()`; drop the Win DLL-dir call. Code-signing/notarization may require signing the dylib and/or the "disable library validation" entitlement. |
| **hwdec** | `no` | `videotoolbox`. |
| **"Drives"** | `drive_root_of` parses `C:\`; `list_drives` enumerates A–Z | No drive letters. Map to **volume mount points** (`/Volumes/<Name>`, or the filespace's mount path). Rework `drive_root_of`, `norm_path`, `list_drives`, and the provider keys. |
| **Path normalization** | backslashes, lowercase, drive letters | POSIX (`/`), case rules per filesystem. Affects `proxy_paths.rs` hashing (+ see §7 interop). |
| **Launch file** | argv + single-instance plugin | macOS delivers files via Apple Events; use Tauri v2's macOS open-URL/`Opened` event instead of argv. `take_launch_file`/`PendingOpen` need a mac path. |
| **set_as_default_player** | Windows registry | `LSSetDefaultRoleHandlerForContentType` / UTIs declared in Info.plist (`CFBundleDocumentTypes`). |
| **Transparent window** | `transparent:true, decorations:false` works | Tauri requires **`"macOSPrivateApi": true`** in `tauri.conf.json` for transparent windows; also decide on native traffic-lights vs custom chrome (`titleBarStyle`). |
| **AppUserModelID / taskbar** | `SetCurrentProcessExplicitAppUserModelID` | N/A on mac (Dock handles it). |
| **Bundle target** | `nsis` | `dmg` / `app`; add `binaries/*` as mac `externalBin` with `-aarch64-apple-darwin` suffixes; ship `libmpv.2.dylib` as a resource. |
| **process_tools::quiet_command** | hides console window (Win flag) | No-op on mac; just don't apply the Windows creation flag. |

Most `mpv_*` commands and the whole client-API/event-thread half of `mpv.rs` already have
`#[cfg(not(windows))]` stubs, so the crate **compiles on macOS now** — you're filling in the
real implementations, not fighting the build.

---

## 10. Suggested macOS port plan (phased)

1. **Boot the shell.** `pnpm tauri dev` on mac with the existing UI (no video yet). Add
   `macOSPrivateApi: true`; confirm the transparent, undecorated window renders the React chrome.
   Get mac `ffmpeg`/`ffprobe`/`libmpv` binaries into `src-tauri/binaries/` (gitignored).
2. **Metadata/library/proxy-gen first (no playback).** These are mostly cross-platform: get
   `list_directory`, `get_probe_data`, `generate_proxy`, thumbnails working. Rework
   drive/volume + path normalization here (§9) — it unblocks everything else.
3. **Playback.** Implement the video pipeline (§4.2 Option A first). Reuse `mpv.rs` client half;
   wire `mpv_*` commands and the event thread (the thread is `#[cfg(windows)]` today — generalize
   it). Validate the `P` proxy-toggle resume.
4. **Caching providers.** Confirm `suite`/`lucid` CLIs on mac; fix path args for mount points.
5. **OS integration.** Default-player, file-association launch via Apple Events, DMG bundle,
   signing/notarization.
6. **Cross-platform proxy interop.** Decide the §7 hashing question with Alex.

Consider keeping the macOS work on a branch and reusing the existing repo (shared frontend +
shared Rust command layer) rather than a fork — `#[cfg(target_os = ...)]` already gates the
platform code.

---

## 11. Conventions & hard constraints (carry these over)

- **Never commit large binaries** (`src-tauri/binaries/` is gitignored: libmpv, ffmpeg, ffprobe).
- **Preserve contributor authorship** in any merge — use real merges, not squashes (this is how
  PR #1's author **bvoo** stays credited).
- Keep `main` releasable; do feature work on branches.
- Match existing code style; `pnpm run format` (Prettier + `cargo fmt`) is enforced by a
  pre-commit hook.
- Owner/author: **Alex Bagheri** (GitHub repo `GrammyMoney/Levee`). "Made with ♥ in Dallas, TX."

## 12. Open questions to raise with Alex before/while porting

1. **Shared proxy cache across Windows ↔ Mac?** (the §7 hashing decision). Yes → switch to
   filespace-relative path hashing on both clients.
2. **Native macOS title bar / traffic-lights, or keep the custom Windows-style chrome?**
3. **Which providers matter on mac first** — LucidLink, Suite, or both? (drives the CLI testing).
4. **One repo with `cfg`-gated platform code, or a separate macOS app?** (recommend one repo.)
</content>
</invoke>
