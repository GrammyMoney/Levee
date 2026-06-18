import { describe, expect, it } from 'vitest';
import { getAssetType } from './media';

describe('media domain helpers', () => {
  it('detects supported media extensions case-insensitively', () => {
    expect(getAssetType('clip.MOV')).toBe('video');
    expect(getAssetType('mix.WAV')).toBe('audio');
    expect(getAssetType('thumb.PNG')).toBe('image');
  });

  it('returns unknown for unsupported or extensionless paths', () => {
    expect(getAssetType('notes.txt')).toBe('unknown');
    expect(getAssetType('README')).toBe('unknown');
  });
});
