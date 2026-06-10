export function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

export function getAssetType(filePath: string): 'video' | 'audio' | 'image' | 'unknown' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4','mov','mxf','mkv','avi','webm'].includes(ext)) return 'video';
  if (['mp3','wav','aiff','aac','flac','ogg'].includes(ext)) return 'audio';
  if (['jpg','jpeg','png','tiff','tif','webp'].includes(ext)) return 'image';
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
