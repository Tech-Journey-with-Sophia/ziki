import { avatarLook, type AgentLook } from "@/lib/agents/avatars";

/**
 * A little robot face for an agent: the one its owner picked, or else one whose
 * colors, antenna, eyes and mouth come from the agent's id, so an agent always
 * looks the same and two agents rarely look alike. Decorative: the agent's name
 * is always shown beside it.
 */

const PALETTES = [
  { bg: "#DCE8FF", head: "#2E6FEF" },
  { bg: "#D7F5EA", head: "#0F8A6A" },
  { bg: "#EDE4FF", head: "#7C3AED" },
  { bg: "#FFE8D6", head: "#E8590C" },
  { bg: "#FFE3EC", head: "#D6336C" },
  { bg: "#DFF3FF", head: "#1C7ED6" },
];

const SCREEN = "#0B1733";
const GLOW = "#5EEAD4";

/** A stable number from the id; each feature reads its own slice of it. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Which features an agent gets when its owner hasn't picked one. Exported so tests can check it is stable. */
export function agentLook(id: string): AgentLook {
  const seed = seedOf(id);
  return {
    palette: seed % PALETTES.length,
    antenna: (seed >>> 3) % 4,
    eyes: (seed >>> 6) % 5,
    mouth: (seed >>> 9) % 4,
    cheeks: ((seed >>> 12) & 1) === 1,
  };
}

function Antenna({ kind, color, sleeping = false }: { kind: number; color: string; sleeping?: boolean }) {
  if (kind === 0) {
    return (
      <>
        <line x1="24" y1="11" x2="24" y2="6" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="5" r="2.6" fill={GLOW} opacity={sleeping ? 0.45 : 1} className={sleeping ? "" : "motion-safe:animate-pulse"} />
      </>
    );
  }
  if (kind === 1) {
    return (
      <>
        <line x1="19" y1="11" x2="16.5" y2="6.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="29" y1="11" x2="31.5" y2="6.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="5.6" r="2.1" fill={GLOW} opacity={sleeping ? 0.45 : 1} className={sleeping ? "" : "motion-safe:animate-pulse"} />
        <circle cx="32" cy="5.6" r="2.1" fill={GLOW} opacity={sleeping ? 0.45 : 1} className={sleeping ? "" : "motion-safe:animate-pulse"} />
      </>
    );
  }
  if (kind === 2) {
    return (
      <polyline
        points="24,11 22,8 26,6.5 23.5,3.5"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  return <rect x="20" y="7" width="8" height="4.5" rx="2.2" fill={color} />;
}

function Eyes({ kind, sleeping = false }: { kind: number; sleeping?: boolean }) {
  if (sleeping) {
    return (
      <path
        d="M16.8 22q2.7 2.2 5.4 0M25.8 22q2.7 2.2 5.4 0"
        fill="none"
        stroke={GLOW}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
    );
  }
  if (kind === 0) {
    return (
      <>
        <circle cx="19.5" cy="21" r="2.6" fill={GLOW} />
        <circle cx="28.5" cy="21" r="2.6" fill={GLOW} />
      </>
    );
  }
  if (kind === 1) {
    return (
      <>
        <rect x="17.5" y="18" width="4" height="6" rx="2" fill={GLOW} />
        <rect x="26.5" y="18" width="4" height="6" rx="2" fill={GLOW} />
      </>
    );
  }
  if (kind === 2) {
    // Happy, squinting arcs.
    return (
      <path
        d="M16.8 22.2q2.7-3.4 5.4 0M25.8 22.2q2.7-3.4 5.4 0"
        fill="none"
        stroke={GLOW}
        strokeWidth="2"
        strokeLinecap="round"
      />
    );
  }
  if (kind === 3) {
    // One big friendly eye.
    return (
      <>
        <circle cx="24" cy="21" r="4.2" fill={GLOW} />
        <circle cx="25.3" cy="19.8" r="1.3" fill={SCREEN} />
      </>
    );
  }
  // A wink.
  return (
    <>
      <circle cx="19.5" cy="21" r="2.6" fill={GLOW} />
      <path d="M26 21.2h5" stroke={GLOW} strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function Mouth({ kind }: { kind: number }) {
  if (kind === 0) {
    return <path d="M20.5 26.5q3.5 3 7 0" fill="none" stroke={GLOW} strokeWidth="1.8" strokeLinecap="round" />;
  }
  if (kind === 1) {
    return (
      <>
        <rect x="19.5" y="25.5" width="9" height="3.6" rx="1.8" fill={GLOW} />
        <path d="M22.5 25.5v3.6M25.5 25.5v3.6" stroke={SCREEN} strokeWidth="0.9" />
      </>
    );
  }
  if (kind === 2) {
    return <circle cx="24" cy="27.3" r="1.7" fill={GLOW} />;
  }
  return <path d="M20.5 27.2q1.75-1.4 3.5 0t3.5 0" fill="none" stroke={GLOW} strokeWidth="1.6" strokeLinecap="round" />;
}

export function AgentAvatar({
  agentId,
  avatar = null,
  size = 48,
  className = "",
  sleeping = false,
}: {
  agentId: string;
  /** The owner's pick (`Agent.avatar`); null or unknown falls back to the automatic robot. */
  avatar?: string | null;
  size?: number;
  className?: string;
  sleeping?: boolean;
}) {
  const look = avatarLook(avatar) ?? agentLook(agentId);
  const { bg, head } = PALETTES[look.palette]!;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      data-testid="agent-avatar"
      data-sleeping={sleeping ? "true" : "false"}
      className={`shrink-0 rounded-full ${className}`}
    >
      <circle cx="24" cy="24" r="24" fill={bg} />
      {/* The head tilts gently when hovered, or rests slightly when sleeping */}
      <g
        className={`origin-center transition-transform duration-300 ${
          sleeping
            ? "rotate-3 group-hover:rotate-0 motion-reduce:rotate-0"
            : "group-hover:-rotate-6 motion-reduce:group-hover:rotate-0"
        }`}
      >
        <Antenna kind={look.antenna} color={head} sleeping={sleeping} />
        <rect x="9" y="17" width="4" height="9" rx="2" fill={head} />
        <rect x="35" y="17" width="4" height="9" rx="2" fill={head} />
        <rect x="11" y="11" width="26" height="23" rx="8" fill={head} />
        <rect x="14" y="14.5" width="20" height="16.5" rx="5.5" fill={SCREEN} />
        <Eyes kind={look.eyes} sleeping={sleeping} />
        <Mouth kind={look.mouth} />
        {look.cheeks ? (
          <>
            <circle cx="16.6" cy="27" r="1.4" fill="#F9A8C0" opacity={sleeping ? 0.4 : 0.8} />
            <circle cx="31.4" cy="27" r="1.4" fill="#F9A8C0" opacity={sleeping ? 0.4 : 0.8} />
          </>
        ) : null}
        <rect x="18" y="36" width="12" height="8" rx="3" fill={head} opacity="0.9" />
      </g>
      {sleeping ? (
        <g
          className="pointer-events-none select-none animate-pulse motion-reduce:animate-none"
          style={{ animationDuration: "2.5s" }}
        >
          <text x="32" y="12" fill="#818CF8" fontSize="7" fontWeight="bold" fontFamily="sans-serif">z</text>
          <text x="38" y="7" fill="#818CF8" fontSize="9" fontWeight="bold" fontFamily="sans-serif">z</text>
        </g>
      ) : null}
    </svg>
  );
}
