import { openUrl, setAsDefaultPlayer } from '../../api/tauri';
import { normalizeDriveRoot } from '../../domain/path';
import { accentFor } from '../../accent';
import type { Provider } from '../../contexts/SuiteContext';
import Dropdown from '../Dropdown';

export default function DriveSettingsPanel({
  allDrives,
  driveProviders,
  onboarding,
  onOnboardingDone,
  onSetProvider,
}: {
  allDrives: string[];
  driveProviders: Record<string, Provider>;
  onboarding?: boolean;
  onOnboardingDone?: () => void;
  onSetProvider: (drive: string, provider: Provider) => void;
}) {
  const providerOf = (drive: string): Provider =>
    driveProviders[normalizeDriveRoot(drive)] ?? 'local';

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
            <p className="text-amber-100 text-xs font-semibold mb-0.5">Set your cloud drive</p>
            <p className="text-amber-100/70 text-[11px] leading-relaxed">
              Levee needs to know which drives are cloud-streamed. Set the dropdown to
              <span className="font-semibold text-amber-200"> Suite </span>or
              <span className="font-semibold text-amber-200"> LucidLink </span>
              for your footage drive below — proxy &amp; pre-cache controls only appear for those.
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
          Set each drive's streaming provider. Proxy, thumbnail, and pre-cache features only apply
          to drives marked Suite or LucidLink.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
        {allDrives.length === 0 ? (
          <p className="text-xs text-white/25 px-1 py-2">Detecting drives…</p>
        ) : (
          allDrives.map((drive) => {
            const label = drive.replace(/[/\\]$/, '');
            const provider = providerOf(drive);
            const managed = provider !== 'local';
            const ra = accentFor(provider);
            return (
              <div
                key={drive}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors w-full ${
                  managed ? ra.bgSoft : 'hover:bg-white/6'
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
                  className={managed ? ra.textStrong : 'text-white/25'}
                >
                  <rect x="2" y="6" width="20" height="13" rx="2" />
                  <path d="M6 11h.01M10 11h.01" />
                </svg>
                <span
                  className={`text-sm font-medium flex-1 ${managed ? 'text-white/90' : 'text-white/50'}`}
                >
                  {label}
                </span>
                <Dropdown
                  value={provider}
                  align="right"
                  minWidth="9rem"
                  options={[
                    { value: 'local', label: 'Local' },
                    { value: 'suite', label: 'Suite' },
                    { value: 'lucidlink', label: 'LucidLink' },
                  ]}
                  onChange={(v) => onSetProvider(drive, v as Provider)}
                  triggerClassName={`text-xs font-medium rounded-md px-2.5 py-1 border ${
                    managed
                      ? `${ra.bg} ${ra.text} ${ra.border}`
                      : 'bg-white/8 text-white/50 border-white/10 hover:text-white/80'
                  } ${onboarding && !managed ? 'ring-2 ring-amber-400/60 animate-pulse' : ''}`}
                />
              </div>
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
          onClick={() => openUrl('https://github.com/GrammyMoney/Levee').catch(() => {})}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
          title="View Levee on GitHub"
        >
          Made with <span className="text-red-400/80">♥</span> in Dallas, TX by Alex Bagheri
        </button>
      </div>
    </div>
  );
}
