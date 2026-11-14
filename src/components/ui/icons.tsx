/** Ícones simples em SVG. São decorativos (aria-hidden); o nome acessível fica no botão/link. */
type P = { className?: string };
const base = (path: React.ReactNode, className = "h-5 w-5") => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {path}
  </svg>
);

export const IconHome = ({ className }: P) =>
  base(
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>,
    className,
  );
export const IconUsers = ({ className }: P) =>
  base(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </>,
    className,
  );
export const IconColumns = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>,
    className,
  );
export const IconCheck = ({ className }: P) => base(<path d="M5 12.5l4.5 4.5L19 7.5" />, className);
export const IconCheckCircle = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </>,
    className,
  );
export const IconWallet = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14.5h2" />
    </>,
    className,
  );
export const IconPlus = ({ className }: P) => base(<path d="M12 5v14M5 12h14" />, className);
export const IconX = ({ className }: P) => base(<path d="M6 6l12 12M18 6L6 18" />, className);
export const IconSearch = ({ className }: P) =>
  base(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>,
    className,
  );
export const IconArrowRight = ({ className }: P) => base(<path d="M5 12h14M13 6l6 6-6 6" />, className);
export const IconChevronRight = ({ className }: P) => base(<path d="M9 6l6 6-6 6" />, className);
export const IconArrowLeft = ({ className }: P) => base(<path d="M19 12H5M11 6l-6 6 6 6" />, className);
export const IconAlert = ({ className }: P) =>
  base(
    <>
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>,
    className,
  );
export const IconClock = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    className,
  );
export const IconDoc = ({ className }: P) =>
  base(
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </>,
    className,
  );
export const IconPrinter = ({ className }: P) =>
  base(
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>,
    className,
  );
export const IconPhone = ({ className }: P) =>
  base(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />, className);
export const IconMail = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>,
    className,
  );
export const IconEdit = ({ className }: P) =>
  base(
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </>,
    className,
  );
export const IconUndo = ({ className }: P) =>
  base(
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>,
    className,
  );
export const IconBuilding = ({ className }: P) =>
  base(
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </>,
    className,
  );
export const IconCalendar = ({ className }: P) =>
  base(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
    className,
  );
export const IconRepeat = ({ className }: P) =>
  base(
    <>
      <path d="M17 2.5l3 3-3 3" />
      <path d="M4 11.5v-1a5 5 0 0 1 5-5h11" />
      <path d="M7 21.5l-3-3 3-3" />
      <path d="M20 12.5v1a5 5 0 0 1-5 5H4" />
    </>,
    className,
  );
export const IconMenu = ({ className }: P) => base(<path d="M4 7h16M4 12h16M4 17h16" />, className);
export const IconMoneyIn = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8.5 13.5L12 17l3.5-3.5" />
    </>,
    className,
  );
export const IconMoneyOut = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 17V7M8.5 10.5L12 7l3.5 3.5" />
    </>,
    className,
  );
export const IconRegister = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <path d="M7 10V5h10v5M7 15h2M11 15h2M15 15h2" />
    </>,
    className,
  );
export const IconPercent = ({ className }: P) =>
  base(
    <>
      <path d="M19 5L5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>,
    className,
  );
export const IconGroup = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8" />
    </>,
    className,
  );
export const IconWrench = ({ className }: P) =>
  base(
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.5-.5-.5-2.5z" />,
    className,
  );
export const IconSpinner = ({ className = "h-4 w-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${className} animate-spin`} aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" fill="none" />
    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);
