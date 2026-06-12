import { describe, expect, it } from 'vitest';
import { getDirName, getFileName, getParentDir, normalizeDriveRoot, normalizePath, toPosixPath } from './path';

describe('path helpers', () => {
  it('gets file and folder names from Windows or POSIX paths', () => {
    expect(getFileName('C:\\Media\\clip.mov')).toBe('clip.mov');
    expect(getFileName('/mnt/media/clip.mov')).toBe('clip.mov');
    expect(getDirName('C:\\Media\\Day 01')).toBe('Day 01');
  });

  it('normalizes and derives paths consistently', () => {
    expect(toPosixPath('C:\\Media\\clip.mov')).toBe('C:/Media/clip.mov');
    expect(getParentDir('C:\\Media\\clip.mov')).toBe('C:\\Media');
    expect(getParentDir('C:\\clip.mov')).toBe('C:\\');
    expect(normalizePath('C:\\Media\\')).toBe('c:/media');
    expect(normalizeDriveRoot('D:')).toBe('d:');
    expect(normalizeDriveRoot('D:\\')).toBe('d:');
  });
});
