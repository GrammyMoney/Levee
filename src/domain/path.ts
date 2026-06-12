export function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

export function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}
