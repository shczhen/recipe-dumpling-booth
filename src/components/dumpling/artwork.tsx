import { useState } from "react";
import { defaultAppearance, type Appearance } from "./appearance";

export function Artwork({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback?: string;
}) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const source = !failedSources.includes(src) ? src : fallback;
  return !source || failedSources.includes(source) ? (
    <span
      className="art-fallback"
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      {alt}
    </span>
  ) : (
    <img
      className={className}
      src={source}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={() =>
        setFailedSources((previous) =>
          previous.includes(source) ? previous : [...previous, source],
        )
      }
    />
  );
}

export function GiftArtwork({
  rank,
  appearance,
  giftCount,
}: {
  rank: number;
  appearance: Appearance;
  giftCount: number;
}) {
  const requested =
    appearance.giftImages.length === giftCount
      ? appearance.giftImages[rank - 1]
      : null;
  return (
    <Artwork
      src={requested ?? defaultAppearance.giftImages[rank - 1] ?? ""}
      fallback={defaultAppearance.giftImages[rank - 1] ?? undefined}
      alt=""
      className="gift-art"
    />
  );
}
