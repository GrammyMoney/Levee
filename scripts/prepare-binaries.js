import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BINARIES_DIR = resolve(__dirname, '..', 'src-tauri', 'binaries');

const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z';
const MPV_RELEASE_API = 'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest';
const MIN_BINARY_BYTES = 1024 * 1024;

export const REQUIRED_BINARIES = [
  'ffmpeg-x86_64-pc-windows-msvc.exe',
  'ffprobe-x86_64-pc-windows-msvc.exe',
  'libmpv-2.dll',
];

function isValidBinary(path) {
  return existsSync(path) && statSync(path).size >= MIN_BINARY_BYTES;
}

export function getMissingBinaries(binariesDir = DEFAULT_BINARIES_DIR) {
  return REQUIRED_BINARIES.filter(name => !isValidBinary(resolve(binariesDir, name)));
}

function ensureWindows() {
  if (process.platform !== 'win32') {
    throw new Error('prepare:binaries currently downloads Windows x86_64 binaries only.');
  }
}

function request(url, { asJson = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Levee prepare-binaries',
        'Accept': asJson ? 'application/vnd.github+json' : '*/*',
      },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.resume();
        resolvePromise(request(new URL(res.headers.location, url).toString(), { asJson }));
        return;
      }

      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
        res.resume();
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolvePromise(asJson ? JSON.parse(buffer.toString('utf8')) : buffer);
      });
    });

    req.on('error', reject);
  });
}

async function download(url, dest) {
  console.log(`Downloading ${basename(dest)}...`);
  writeFileSync(dest, await request(url));
}

function extractArchive(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error([
      `Failed to extract ${archivePath}.`,
      'This script expects Windows bsdtar, which ships with current Windows 10/11 installs.',
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function findRequiredFile(root, fileName) {
  const match = walkFiles(root).find(path => basename(path).toLowerCase() === fileName.toLowerCase());
  if (!match) throw new Error(`Could not find ${fileName} inside extracted archive.`);
  return match;
}

async function getLatestMpvDevAssetUrl() {
  const release = await request(MPV_RELEASE_API, { asJson: true });
  const asset = release.assets.find(({ name }) => /^mpv-dev-x86_64-\d{8}-git-[a-f0-9]+\.7z$/i.test(name));
  if (!asset) {
    throw new Error('Could not find mpv-dev-x86_64 asset in latest zhongfly/mpv-winbuild release.');
  }
  return asset.browser_download_url;
}

async function installFfmpegTools(workDir, binariesDir) {
  const archive = join(workDir, 'ffmpeg-git-essentials.7z');
  const extractDir = join(workDir, 'ffmpeg');
  await download(FFMPEG_URL, archive);
  extractArchive(archive, extractDir);
  copyFileSync(findRequiredFile(extractDir, 'ffmpeg.exe'), resolve(binariesDir, 'ffmpeg-x86_64-pc-windows-msvc.exe'));
  copyFileSync(findRequiredFile(extractDir, 'ffprobe.exe'), resolve(binariesDir, 'ffprobe-x86_64-pc-windows-msvc.exe'));
}

async function installMpvDlls(workDir, binariesDir) {
  const mpvUrl = await getLatestMpvDevAssetUrl();
  const archive = join(workDir, basename(new URL(mpvUrl).pathname));
  const extractDir = join(workDir, 'mpv');
  await download(mpvUrl, archive);
  extractArchive(archive, extractDir);

  const dlls = walkFiles(extractDir).filter(path => path.toLowerCase().endsWith('.dll'));
  if (!dlls.some(path => basename(path).toLowerCase() === 'libmpv-2.dll')) {
    throw new Error('Downloaded mpv archive did not contain libmpv-2.dll.');
  }

  for (const dll of dlls) {
    copyFileSync(dll, resolve(binariesDir, basename(dll)));
  }
}

export async function prepareBinaries({ binariesDir = DEFAULT_BINARIES_DIR, force = false } = {}) {
  ensureWindows();
  mkdirSync(binariesDir, { recursive: true });

  const missingBefore = force ? REQUIRED_BINARIES : getMissingBinaries(binariesDir);
  if (missingBefore.length === 0) {
    return { ok: true, binariesDir, missing: [], message: `All Levee native binaries are present in ${binariesDir}` };
  }

  const workDir = mkdtempSync(join(tmpdir(), 'levee-binaries-'));
  try {
    const needsFfmpeg = force || missingBefore.some(name => name.startsWith('ffmpeg') || name.startsWith('ffprobe'));
    const needsMpv = force || missingBefore.includes('libmpv-2.dll');

    if (needsFfmpeg) await installFfmpegTools(workDir, binariesDir);
    if (needsMpv) await installMpvDlls(workDir, binariesDir);

    const missingAfter = getMissingBinaries(binariesDir);
    if (missingAfter.length > 0) {
      return {
        ok: false,
        binariesDir,
        missing: missingAfter,
        message: `Downloaded native binaries, but these required files are still missing or invalid:\n${missingAfter.map(name => `  - ${name}`).join('\n')}`,
      };
    }

    return {
      ok: true,
      binariesDir,
      missing: [],
      message: `Prepared Levee native binaries in ${binariesDir}`,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  prepareBinaries({ force })
    .then(result => {
      console.log(result.message);
      if (!result.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
