# Licensing

Levee is free and open source, licensed under the **GNU Affero General Public
License, version 3 or later (AGPL-3.0-or-later)**. See [`LICENSE`](LICENSE) for the
full text.

Copyright © 2026 Alex Bagheri.

## What you can do

- Use Levee for free, for anything — personal or commercial.
- Read, modify, and build on the source code.
- Distribute it, and even sell products built on it.

The one rule (this is what "copyleft" means): if you distribute Levee, or something
built on it — including running a modified version as a network or hosted service —
you must make your **complete corresponding source** available to your users under
the same AGPL terms. In short: keep it open.

## Third-party components

Levee bundles third-party media libraries that carry their own licenses, which apply
on top of the AGPL:

- **FFmpeg / FFprobe** — the bundled builds are **GPL** (they include GPL-licensed
  encoders such as **x264** and **x265**; proxy generation uses GPL `libx264`).
- **libmpv / mpv** — **LGPL-2.1-or-later** (and possibly GPL depending on build).

These are compatible with the AGPL for this open-source release, but they remain
under their own terms. If you ever distribute a **closed-source** build, you are
responsible for satisfying these components' licenses yourself — for example by
swapping GPL encoders for non-GPL ones (OpenH264 or hardware encoders) and using
LGPL builds of FFmpeg/mpv. Get legal advice first.

## Copyright & Enterprise editions

Levee is solely owned by **Alex Bagheri**, who reserves the right to develop and sell
proprietary or **Enterprise** editions based on this codebase. The AGPL governs this
public version; it does not restrict the copyright holder.

If you contribute to this repository, you agree to the
[Contributor License Agreement](CLA.md) — you keep ownership of your work but grant
the right to license it under the AGPL and proprietary terms, which is what keeps
Enterprise editions possible. See [CONTRIBUTING.md](CONTRIBUTING.md).
