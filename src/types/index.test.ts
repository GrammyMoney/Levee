import { describe, expect, it } from 'vitest';
import { getAssetType, getFileName } from './index';

describe('getFileName', () => {
  it('returns the final segment from a Windows path', () => {
    expect(getFileName('S:\\Project\\Cuts\\scene01.mov')).toBe('scene01.mov');
  });

  it('returns the final segment from a POSIX path', () => {
    expect(getFileName('/Volumes/Suite/Project/Cuts/scene01.mov')).toBe('scene01.mov');
  });

  it('returns the original path when there is no separator', () => {
    expect(getFileName('scene01.mov')).toBe('scene01.mov');
  });
});

describe('getAssetType', () => {
  it('detects supported video extensions case-insensitively', () => {
    expect(getAssetType('clip.MOV')).toBe('video');
    expect(getAssetType('clip.mxf')).toBe('video');
  });

  it('detects supported audio extensions case-insensitively', () => {
    expect(getAssetType('mix.WAV')).toBe('audio');
    expect(getAssetType('mix.flac')).toBe('audio');
  });

  it('detects supported image extensions case-insensitively', () => {
    expect(getAssetType('thumb.PNG')).toBe('image');
    expect(getAssetType('thumb.tiff')).toBe('image');
  });

  it('returns unknown for unsupported or extensionless paths', () => {
    expect(getAssetType('notes.txt')).toBe('unknown');
    expect(getAssetType('README')).toBe('unknown');
  });
});
