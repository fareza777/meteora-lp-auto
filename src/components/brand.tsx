export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size + 0 }}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 14.5c2.4-3.3 4.8-3.3 7.2 0s4.8 3.3 7.2 0"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M3 9c2.4-3.3 4.8-3.3 7.2 0s4.8 3.3 7.2 0"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path d="M20 5v14" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" opacity="0.8" />
      </svg>
    </span>
  );
}

export function Brand({ subtitle = "Liquidity terminal" }: { subtitle?: string }) {
  return (
    <span className="brand">
      <BrandMark />
      <span>
        <span className="brand-word">Tide</span>
        <span className="brand-sub">{subtitle}</span>
      </span>
    </span>
  );
}
