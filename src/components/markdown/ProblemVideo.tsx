import * as React from 'react';

type ProblemVideoProps = {
  mediaId: string;
  src: string;
  mimeType: 'video/webm';
  caption: string;
  originalUrl: string;
  originalFilename: string;
  width: number;
  height: number;
};

/** A source-owned movie; the original remains downloadable beside the player. */
export default function ProblemVideo({
  mediaId,
  src,
  mimeType,
  caption,
  originalUrl,
  originalFilename,
  width,
  height,
}: ProblemVideoProps): JSX.Element {
  const captionId = `${mediaId}-caption`;
  return (
    <figure className="problem-video" style={{ margin: '1.5rem 0' }}>
      <video
        controls
        preload="metadata"
        playsInline
        width={width}
        height={height}
        aria-label={caption}
        aria-describedby={captionId}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: '48rem',
          height: 'auto',
          background: '#000',
        }}
      >
        <source src={src} type={mimeType} />
        Браузърът не поддържа този видеоматериал.{' '}
        <a href={src}>Отворете видеото</a>.
      </video>
      <figcaption id={captionId}>
        {caption}{' '}
        <a href={originalUrl} download={originalFilename}>
          Изтеглете оригиналния WMV
        </a>
        .
      </figcaption>
    </figure>
  );
}
