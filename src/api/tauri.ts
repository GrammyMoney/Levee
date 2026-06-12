import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { ProbeData } from '../domain/media';

export function pickFile(): Promise<string | null> {
  return invoke<string | null>('pick_file');
}

export function takeLaunchFile(): Promise<string | null> {
  return invoke<string | null>('take_launch_file');
}

export function getSiblingFiles(path: string): Promise<string[]> {
  return invoke<string[]>('get_sibling_files', { path });
}

export function getProbeData(path: string): Promise<ProbeData> {
  return invoke<ProbeData>('get_probe_data', { path });
}

export function getProxy(originalPath: string): Promise<string | null> {
  return invoke<string | null>('get_proxy', { originalPath });
}

export interface DirListing {
  path: string;
  parentPath: string | null;
  subdirs: string[];
  mediaFiles: string[];
}

export function listDirectory(path: string): Promise<DirListing> {
  return invoke<DirListing>('list_directory', { path });
}

export function getThumbnail(originalPath: string): Promise<string> {
  return invoke<string>('get_thumbnail', { originalPath });
}

export function getProxiesBatch(filePaths: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_proxies_batch', { filePaths });
}

export function deleteProxy(originalPath: string): Promise<void> {
  return invoke<void>('delete_proxy', { originalPath });
}

export function listDrives(): Promise<string[]> {
  return invoke<string[]>('list_drives');
}

export function setAsDefaultPlayer(): Promise<void> {
  return invoke<void>('set_as_default_player');
}

export function openUrl(url: string): Promise<void> {
  return invoke<void>('open_url', { url });
}

export function openFolder(path: string): Promise<void> {
  return invoke<void>('open_folder', { path });
}

export function setSuiteRoots(roots: string[]): Promise<void> {
  return invoke<void>('set_suite_roots', { roots });
}

export function suitePrecacheList(): Promise<string[]> {
  return invoke<string[]>('suite_precache_list');
}

export function suitePrecacheAdd(paths: string[]): Promise<string> {
  return invoke<string>('suite_precache_add', { paths });
}

export function suitePrecacheRemove(paths: string[]): Promise<string> {
  return invoke<string>('suite_precache_remove', { paths });
}

export function generateProxy(originalPath: string): Promise<string> {
  return invoke<string>('generate_proxy', { originalPath });
}

export function precacheProxiesFolder(originalPath: string): Promise<void> {
  return invoke<void>('precache_proxies_folder', { originalPath });
}

export function mpvLoad(path: string): Promise<void> {
  return invoke<void>('mpv_load', { path });
}

export function mpvSetPause(paused: boolean): Promise<void> {
  return invoke<void>('mpv_set_pause', { paused });
}

export function mpvSeek(time: number): Promise<void> {
  return invoke<void>('mpv_seek', { time });
}

export function mpvSeekBy(delta: number): Promise<void> {
  return invoke<void>('mpv_seek_by', { delta });
}

export function mpvFrameStep(direction: 1 | -1): Promise<void> {
  return invoke<void>('mpv_frame_step', { direction });
}

export function mpvSetVolume(volume: number): Promise<void> {
  return invoke<void>('mpv_set_volume', { volume });
}

export function mpvSetMute(muted: boolean): Promise<void> {
  return invoke<void>('mpv_set_mute', { muted });
}

export function mpvSetSpeed(speed: number): Promise<void> {
  return invoke<void>('mpv_set_speed', { speed });
}

export function mpvSetLoop(looping: boolean): Promise<void> {
  return invoke<void>('mpv_set_loop', { looping });
}

export function assetUrl(path: string): string {
  return convertFileSrc(path);
}
