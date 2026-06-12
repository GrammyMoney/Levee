import { useEffect, useState } from 'react';
import { CloseIcon, SpinnerIcon } from '../icons';
import type { ProbeData } from '../../domain/media';
import { getProbeData } from '../../api/tauri';

interface Props {
  isOpen: boolean;
  filePath: string;
  onClose: () => void;
}

function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MetadataPanel({ isOpen, filePath, onClose }: Props) {
  const [probe, setProbe] = useState<ProbeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    setProbe(null);
    setError(null);
    setLoading(true);
    getProbeData(filePath)
      .then((data) => {
        setProbe(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [isOpen, filePath]);

  const rows: { label: string; value: string }[] = probe
    ? [
        { label: 'Codec', value: probe.codec || '—' },
        {
          label: 'Resolution',
          value: probe.width && probe.height ? `${probe.width} × ${probe.height}` : '—',
        },
        { label: 'Frame Rate', value: probe.frameRate || '—' },
        { label: 'Bit Rate', value: probe.bitRate || '—' },
        { label: 'Duration', value: formatDuration(probe.durationSecs) },
        { label: 'Timecode', value: probe.timecode || '—' },
        { label: 'Container', value: probe.container || '—' },
        { label: 'Color Space', value: probe.colorSpace || '—' },
        {
          label: 'Audio',
          value: probe.audioCodec
            ? `${probe.audioCodec}${probe.audioChannels ? ` · ${probe.audioChannels}ch` : ''}`
            : '—',
        },
        { label: 'File Size', value: probe.fileSize || '—' },
        { label: 'File Path', value: filePath },
      ]
    : [];

  return (
    <div
      className={`absolute top-0 right-0 bottom-0 z-30 w-72 flex flex-col glass border-l border-white/8 transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
        <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
          File Info
        </span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-6 text-white/40">
            <SpinnerIcon className="animate-spin shrink-0" />
            <span className="text-xs">Reading file…</span>
          </div>
        )}

        {error && !loading && (
          <div className="px-4 py-4">
            <p className="text-xs text-red-400/80">{error}</p>
          </div>
        )}

        {!loading &&
          !error &&
          rows.map(({ label, value }) => (
            <div
              key={label}
              className="px-4 py-2.5 flex flex-col gap-0.5 border-b border-white/5 last:border-0"
            >
              <span className="text-[10px] uppercase tracking-wider text-white/35 font-medium">
                {label}
              </span>
              <span
                className={`text-xs text-white/80 break-all leading-snug ${
                  label === 'File Path' ? 'font-mono text-[10px] text-white/40' : ''
                }`}
              >
                {value}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
