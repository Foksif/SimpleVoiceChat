const paths: Record<string, string> = {
  mic: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0M12 16v4M9 20h6',
  micOff: 'M4 4l16 16M9 9v2a3 3 0 0 0 4.5 2.6M15 10V6a3 3 0 0 0-5.7-1.3M17 11a5 5 0 0 1-.6 2.4M12 16v4M9 20h6M7 11a5 5 0 0 0 5 5',
  leave: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  volume: 'M4 10v4h3l4 3V7L7 10H4Zm12-1.5a4.5 4.5 0 0 1 0 7',
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
