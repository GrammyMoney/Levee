# Contributing to Levee

Thanks for your interest in improving Levee! Contributions are welcome — bug fixes,
features, docs, all of it.

## Contributor License Agreement

Before any contribution can be merged, you must agree to the
[**Contributor License Agreement (CLA)**](CLA.md).

In short: you keep ownership of your work, but you grant the project owner the right
to license your contribution under the AGPL **and** under proprietary terms. This is
what keeps Levee dual-licensable and lets it offer Enterprise editions — without it,
contributions couldn't be included in those editions.

By opening a pull request, you confirm that you have read the [CLA](CLA.md) and agree
to its terms for your contributions.

> For stronger record-keeping, the project may use an automated CLA check (e.g.
> [CLA Assistant](https://cla-assistant.io/)) that asks you to sign off on your first
> pull request.

## How to contribute

1. Fork the repo and create a branch for your change.
2. Make your change. Keep the style consistent with the surrounding code.
3. Make sure it builds:
   - Frontend types: `npm run build` (or `npx tsc --noEmit`)
   - Rust: `cargo build` in `src-tauri/`
4. Open a pull request describing what you changed and why.

## Reporting bugs / ideas

Open an issue with as much detail as you can — what you did, what you expected, what
happened, and (for playback issues) the file's codec/container and any
`[mpv]` / `[dcomp]` lines from the terminal.
