interface Props {
  visible: boolean;
  metaPanelOpen: boolean;
  libraryOpen?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function ChevronNav({ visible, metaPanelOpen, libraryOpen, onPrev, onNext }: Props) {
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        style={{ left: libraryOpen ? 'calc(1rem + 480px)' : '1rem' }}
        className={`chrome absolute top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-12 h-12 rounded-full glass text-white/80 hover:text-white hover:bg-white/20 transition-[opacity,left] duration-300 ${
          visible ? 'chrome-visible' : 'chrome-hidden'
        }`}
        aria-label="Previous file"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z" />
        </svg>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        style={{ right: metaPanelOpen ? 'calc(1rem + 18rem)' : '1rem' }}
        className={`chrome absolute top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-12 h-12 rounded-full glass text-white/80 hover:text-white hover:bg-white/20 transition-[opacity,right] duration-300 ${
          visible ? 'chrome-visible' : 'chrome-hidden'
        }`}
        aria-label="Next file"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 0 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>
    </>
  );
}
