type IconProps = { className?: string; size?: number };

function base({ className, size = 18 }: IconProps) {
  return { className, width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
}

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconReview(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 7h11M8 12h11M8 17h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconAlerts(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function IconAutomation(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function IconSecurity(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 5 6.5v5.2c0 4.1 2.7 7.7 7 8.8 4.3-1.1 7-4.7 7-8.8V6.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.5 12.2 11.2 14l3.4-3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 5 6.5v5.2c0 4.1 2.7 7.7 7 8.8 4.3-1.1 7-4.7 7-8.8V6.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPolicy(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconPayment(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 14.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconFreeze(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v18M5.5 6.5 18.5 17.5M18.5 6.5 5.5 17.5M3 12h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 12.2 11 14.7l4.6-5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M17.2 5.2l1.6-1.6M5.2 18.8l1.6-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M19 13.5A7.2 7.2 0 0 1 10.5 5 7.5 7.5 0 1 0 19 13.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSpark(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5 13.6 9.2 19.5 11 13.6 12.8 12 18.5 10.4 12.8 4.5 11 10.4 9.2 12 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSoundOn(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l4 3V7L7 10H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconSoundOff(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l4 3V7L7 10H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M16 9l4 4M20 9l-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
