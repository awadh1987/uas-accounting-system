"use client";

import { useState } from "react";

export function SvgAvatar({
  char,
  avatarUrl,
  color = "#059669",
  size = 32,
  alt,
  className = "",
}: {
  char: string;
  avatarUrl?: string | null;
  color?: string | null;
  size?: number;
  alt?: string;
  className?: string;
}) {
  const letter = (char || "U").charAt(0);
  const cleanUrl = (avatarUrl || "").trim();
  const fillColor = (color || "").trim() || "#059669";
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(cleanUrl) && failedUrl !== cleanUrl;

  if (showImage) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={cleanUrl}
        alt={alt || letter}
        width={size}
        height={size}
        onError={() => setFailedUrl(cleanUrl)}
        className={`rounded-full shrink-0 object-cover border ${className}`}
        style={{ width: size, height: size, borderColor: fillColor }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`rounded-full shrink-0 border ${className}`}
      style={{ borderColor: fillColor }}
      aria-label={alt || letter}
    >
      <rect width="40" height="40" rx="20" fill={fillColor} />
      <text
        x="50%"
        y="55%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontFamily="Arial, Cairo, sans-serif"
        fontSize="16"
        fontWeight="bold"
      >
        {letter}
      </text>
    </svg>
  );
}
