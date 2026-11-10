"use client";

export function SvgAvatar({ char, size = 32 }: { char: string; size?: number }) {
  const letter = (char || "U").charAt(0);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className="rounded-full shrink-0 border border-emerald-500"
      aria-label={letter}
    >
      <rect width="40" height="40" rx="20" fill="#059669" />
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

