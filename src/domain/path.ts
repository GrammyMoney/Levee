export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function getFileName(filePath: string): string {
  return toPosixPath(filePath).split('/').pop() ?? filePath;
}

export function getDirName(path: string): string {
  return getFileName(path);
}

export function getParentDir(filePath: string): string {
  const parts = toPosixPath(filePath).split('/');
  parts.pop();
  const dir = filePath.includes('\\') ? parts.join('\\') : parts.join('/') || '/';
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}

export function normalizePath(path: string): string {
  return toPosixPath(path).toLowerCase().replace(/\/+$/, '');
}

export function normalizeDriveRoot(path: string): string {
  const withSlash = path.endsWith('\\') || path.endsWith('/') ? path : `${path}\\`;
  return normalizePath(withSlash);
}
