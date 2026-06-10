import { forwardRef } from 'react';
import { VideoEventHandlers } from '../../hooks/useVideoPlayer';

interface Props extends VideoEventHandlers {
  src: string;
  onClick: () => void;
}

const VideoElement = forwardRef<HTMLVideoElement, Props>(
  ({ src, onClick, onPlay, onPause, onTimeUpdate, onDurationChange, onVolumeChange, onEnded }, ref) => {
    return (
      <video
        ref={ref}
        src={src}
        className="w-full h-full object-contain"
        onClick={onClick}
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={onDurationChange}
        onVolumeChange={onVolumeChange}
        onEnded={onEnded}
        controls={false}
        autoPlay
      />
    );
  }
);

VideoElement.displayName = 'VideoElement';
export default VideoElement;
