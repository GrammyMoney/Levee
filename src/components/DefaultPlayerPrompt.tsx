import { useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { setAsDefaultPlayer } from '../api/tauri';

// One-time prompt offering to make Levee the default video player. Windows 10/11
// require the user to confirm in Settings, so this opens the Default Apps page.
export default function DefaultPlayerPrompt() {
  const { defaultPlayerPrompted, setDefaultPlayerPrompted } = useSettings();
  const [busy, setBusy] = useState(false);

  if (defaultPlayerPrompted) return null;

  const setDefault = async () => {
    setBusy(true);
    try {
      await setAsDefaultPlayer();
    } catch {}
    setDefaultPlayerPrompted(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass rounded-2xl p-6 max-w-sm w-[90%] flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-white text-base font-semibold">
            Make Levee your default video player?
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">
            Recommended — opens your footage in Levee when you double-click it. We'll take you to
            Windows settings to confirm the choice.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setDefaultPlayerPrompted(true)}
            className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Not now
          </button>
          <button
            onClick={setDefault}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm bg-violet-500/80 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-50"
          >
            Set as default
          </button>
        </div>
      </div>
    </div>
  );
}
