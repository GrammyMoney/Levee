import { describe, expect, it } from 'vitest';
import { getFileName, normalizePath } from './path';

describe('path domain helpers', () => {
  it('returns the final segment from Windows and POSIX paths', () => {
    expect(getFileName('S:\\Project\\Cuts\\scene01.mov')).toBe('scene01.mov');
    expect(getFileName('/Volumes/Suite/Project/Cuts/scene01.mov')).toBe('scene01.mov');
  });

  it('normalizes Windows separators to POSIX-style lowercase paths', () => {
    expect(normalizePath('S:\\Project\\Cuts')).toBe('s:/project/cuts');
  });
});
