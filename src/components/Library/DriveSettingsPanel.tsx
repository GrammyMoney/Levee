import { openUrl, setAsDefaultPlayer } from '../../api/tauri';
import { normalizeDriveRoot } from '../../domain/path';

export default function DriveSettingsPanel({
  allDrives,
  suiteRoots,
  onboarding,
  onOnboardingDone,
  onToggle,
}: {
  allDrives: string[];
  suiteRoots: string[];
  onboarding?: boolean;
  onOnboardingDone?: () => void;
  onToggle: (drive: string) => void;
}) {
  const isActive = (drive: string) =>
    suiteRoots.some((r) => normalizeDriveRoot(r) === normalizeDriveRoot(drive));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {onboarding && (
        <div className="mx-3 mt-3 rounded-xl bg-amber-400/15 ring-1 ring-amber-400/40 px-4 py-3 flex items-start gap-3">
          <div className="text-amber-300 shrink-0 mt-0.5">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-amber-100 text-xs font-semibold mb-0.5">Set your Suite drive</p>
            <p className="text-amber-100/70 text-[11px] leading-relaxed">
              Levee needs to know which drives hold your Suite footage. Toggle the
              <span className="font-semibold text-amber-200"> Suite </span>
              badge on for your Suite drive below — pre-cache controls only appear for those drives.
            </p>
          </div>
          <button
            onClick={onOnboardingDone}
            className="shrink-0 text-amber-200/60 hover:text-amber-100 transition-colors"
            title="Got it"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M2 2l8 8M10 2L2 10" />
            </svg>
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-white/8 shrink-0">
        <p className="text-xs text-white/40 leading-relaxed">
          Select which drives are Suite drives. Pre-cache badges and controls only appear for files
          on Suite drives.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
        {allDrives.length === 0 ? (
          <p className="text-xs text-white/25 px-1 py-2">Detecting drives…</p>
        ) : (
          allDrives.map((drive) => {
            const label = drive.replace(/[/\\]$/, '');
            const active = isActive(drive);
            return (
              <button
                key={drive}
                onClick={() => onToggle(drive)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left w-full group ${
                  active ? 'bg-sky-500/12 hover:bg-sky-500/18' : 'hover:bg-white/6'
                }`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={active ? 'text-sky-400' : 'text-white/25'}
                >
                  <rect x="2" y="6" width="20" height="13" rx="2" />
                  <path d="M6 11h.01M10 11h.01" />
                </svg>
                <span
                  className={`text-sm font-medium flex-1 ${active ? 'text-white/90' : 'text-white/50'}`}
                >
                  {label}
                </span>
                <span
                  className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                    active
                      ? 'bg-sky-500/25 text-sky-300'
                      : 'bg-white/8 text-white/25 group-hover:bg-white/12 group-hover:text-white/40'
                  } ${onboarding && !active ? 'ring-2 ring-amber-400/60 animate-pulse' : ''}`}
                >
                  {active ? (
                    <>
                      <span className="w-1 h-1 rounded-full bg-sky-400 shrink-0" />
                      Suite
                    </>
                  ) : (
                    'Not Suite'
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-white/8 px-4 py-3">
        <button
          onClick={() => setAsDefaultPlayer().catch(() => {})}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-sm text-white/70 hover:text-white transition-colors"
        >
          Set Levee as default video player
        </button>
        <p className="text-[10px] text-white/30 mt-1.5 text-center">
          Opens Windows Default apps settings
        </p>
      </div>

      <div className="shrink-0 border-t border-white/8 px-4 py-2.5 flex items-center justify-center">
        <button
          onClick={() => openUrl('https://github.com/GrammyMoney/levee').catch(() => {})}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
          title="View Levee on GitHub"
        >
          Made with <span className="text-red-400/80">♥</span> in Dallas, TX by Alex Bagheri
        </button>
      </div>
    </div>
  );
}
