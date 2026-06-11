// Branded loading screen shown on launch until we know whether a file was
// passed (file association / CLI). Prevents the "click to open" flash when
// Levee is opened as the default player.
export default function Splash() {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-black gap-8">
      <img
        src="/levee-logo.png"
        alt="Levee"
        className="w-44 select-none pointer-events-none"
        draggable={false}
      />
      <div className="w-6 h-6 rounded-full border-2 border-white/15 border-t-white/70 animate-spin" />
    </div>
  );
}
