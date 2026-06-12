export type AssetType = 'video' | 'audio' | 'image' | 'unknown';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm'] as const;
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aiff', 'aac', 'flac', 'ogg'] as const;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'] as const;

export function getAssetType(filePath: string): AssetType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  return 'unknown';
}

export interface ProbeData {
  codec: string;
  width: number;
  height: number;
  frameRate: string;
  bitRate: string;
  durationSecs: number;
  timecode: string;
  container: string;
  audioCodec: string;
  audioChannels: number;
  fileSize: string;
  colorSpace: string;
}
