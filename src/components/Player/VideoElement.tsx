interface Props {
  onClick: () => void;
}

// Transparent click-catcher over the video region. mpv renders the actual video
// into a DirectComposition surface *behind* the transparent WebView (Rust side),
// so there's no <video> element here — just a surface to catch play/pause clicks.
export default function VideoElement({ onClick }: Props) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: 'transparent' }}
      onClick={onClick}
    />
  );
}
