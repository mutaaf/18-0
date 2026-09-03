import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { color } from '@/theme';

/**
 * Dock icons, drawn as icons rather than as line drawings.
 *
 * A dock is a shelf of app icons, and an app icon is an object: it has a
 * ground, a light source, and one symbol that says what the thing is without a
 * label. The thin monoline glyphs the tab bar uses are right for a tab bar and
 * wrong here — at 48 to 78 pixels they read as wireframes.
 *
 * But a rainbow of saturated grounds is wrong too. This app is a broadcast: a
 * navy-black bowl, silver type, red for anything live, gold for the chase. So
 * the tiles are graphite with a single light source, the symbols are silver,
 * and colour is spent only where it means something — gold on the things you
 * are chasing, and one red tile for the game itself, which is the only thing on
 * this shelf you can actually do.
 *
 * Depth comes from the build, not the palette: a two-stop ground, a gloss over
 * the top third, a hairline rim, and every symbol drawn twice so it casts a
 * shadow onto its own tile.
 */

export type DockIconName = 'games' | 'leaderboard' | 'index' | 'challenges' | 'stats' | 'account';

export function DockIcon({ name, size }: { name: DockIconName; size: number }) {
  const Icon = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Icon />
    </Svg>
  );
}

/** Silver, in three weights. The symbols are built out of these and nothing else. */
const METAL = '#E8ECF3';
const METAL_DIM = '#A8B2C4';

/**
 * The ground every icon sits on: graphite, lit from above, with a hairline rim
 * so the tile still has an edge against a dark dock.
 */
function Ground({ id, from = '#232C3E', to = '#080B12' }: { id: string; from?: string; to?: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}-g`} x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        <LinearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="64" height="64" rx="16" fill={`url(#${id}-g)`} />
      <Rect x="1" y="1" width="62" height="28" rx="15" fill={`url(#${id}-gloss)`} />
      <Rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="15.25"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.16"
        strokeWidth="1.5"
      />
    </>
  );
}

/** The symbol, drawn twice: once dark and a pixel low, once in its own metal. */
function Raised({ children }: { children: React.ReactNode }) {
  return (
    <>
      <G transform="translate(0 1.5)" opacity={0.4}>
        {children}
      </G>
      {children}
    </>
  );
}

/** Games — the seasons you have already finished, as a stack of cards. */
function GamesIcon() {
  return (
    <>
      <Ground id="ic-games" />
      <Raised>
        <G>
          {/* Two cards fanned behind, so it reads as a collection rather than
              a single sheet of paper. */}
          <Rect x="20" y="17" width="24" height="31" rx="3.5" fill={METAL_DIM} opacity="0.45" transform="rotate(-13 32 32)" />
          <Rect x="20" y="17" width="24" height="31" rx="3.5" fill={METAL_DIM} opacity="0.75" transform="rotate(-6.5 32 32)" />
          <Rect x="20" y="17" width="24" height="31" rx="3.5" fill={METAL} />
          {/* The front one reads as a roster card: a portrait, a name rule and
              the rating strip along the bottom. */}
          <Rect x="23" y="20" width="18" height="13" rx="2.5" fill="#1B2436" />
          <Circle cx="32" cy="25.5" r="3.2" fill={METAL_DIM} />
          <Path d="M26.4 33a5.9 5.9 0 0 1 11.2 0z" fill={METAL_DIM} />
          <Rect x="23" y="36" width="12" height="2.4" rx="1.2" fill="#1B2436" opacity="0.55" />
          <Rect x="23" y="41" width="18" height="3.6" rx="1.8" fill={color.red} />
        </G>
      </Raised>
    </>
  );
}

/** Leaderboards — a podium, because that is literally what a ranking is. */
function LeaderboardIcon() {
  return (
    <>
      <Ground id="ic-lead" />
      <Raised>
        <G>
          {/* Second, first, third — the arrangement a real podium has. */}
          <Rect x="11" y="35" width="13" height="19" rx="2.5" fill={METAL_DIM} opacity="0.7" />
          <Rect x="25.5" y="26" width="13" height="28" rx="2.5" fill={METAL} />
          <Rect x="40" y="40" width="13" height="14" rx="2.5" fill={METAL_DIM} opacity="0.5" />
          {/* Gold belongs to the top step and nothing else. */}
          <Path
            d="M32 8.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L32 23.35l-5.8 3.05 1.1-6.45-4.7-4.6 6.5-.95z"
            fill={color.gold}
          />
        </G>
      </Raised>
    </>
  );
}

/** Play — the ball, on the one red tile. This is the thing you can do. */
function PlayIcon() {
  return (
    <>
      <Ground id="ic-play" from="#E2201F" to="#6B0202" />
      <Raised>
        <G transform="rotate(-28 32 32)">
          <Ellipse cx="32" cy="32" rx="19.5" ry="12" fill="#F1E4D2" />
          <Ellipse cx="32" cy="32" rx="19.5" ry="12" fill="none" stroke="#4A2109" strokeWidth="2" />
          <Path d="M23.5 32h17" stroke="#4A2109" strokeWidth="2.4" strokeLinecap="round" />
          <Path d="M27.5 29.2v5.6 M31.5 28.8v6.4 M35.5 29.2v5.6" stroke="#4A2109" strokeWidth="2.1" strokeLinecap="round" />
          <Path d="M16.5 27.8a19 19 0 0 0 0 8.4" stroke="#4A2109" strokeWidth="2.1" strokeLinecap="round" fill="none" />
          <Path d="M47.5 27.8a19 19 0 0 1 0 8.4" stroke="#4A2109" strokeWidth="2.1" strokeLinecap="round" fill="none" />
        </G>
      </Raised>
    </>
  );
}

/** Challenges — one crest, split in two, with the bolt on the seam. */
function ChallengesIcon() {
  return (
    <>
      <Ground id="ic-vs" />
      <Raised>
        <G>
          {/* A shield is the sports symbol for a side. Two tones down the
              middle of one is the symbol for two sides meeting. */}
          <Path d="M32 10l19.5 6.8v13.7c0 11.7-9.8 18.5-19.5 22.5-9.7-4-19.5-10.8-19.5-22.5V16.8z" fill={METAL} />
          <Path d="M32 10l19.5 6.8v13.7c0 11.7-9.8 18.5-19.5 22.5V10z" fill={METAL_DIM} opacity="0.55" />
          <Path
            d="M32 10l19.5 6.8v13.7c0 11.7-9.8 18.5-19.5 22.5-9.7-4-19.5-10.8-19.5-22.5V16.8z"
            fill="none"
            stroke="#1B2436"
            strokeWidth="1.5"
          />
          {/* The bolt is the collision, and it is what splits the crest. */}
          <Path d="M34.6 14.5l-10.4 20.4h6.6l-3.3 16.3 12.9-21.3h-6.6z" fill={color.gold} />
        </G>
      </Raised>
    </>
  );
}

/** Stats — bars that climb, with the line that says which way. */
function StatsIcon() {
  return (
    <>
      <Ground id="ic-stats" />
      <Raised>
        <G>
          <Rect x="12" y="36" width="10" height="18" rx="2.5" fill={METAL_DIM} opacity="0.55" />
          <Rect x="27" y="28" width="10" height="26" rx="2.5" fill={METAL_DIM} opacity="0.8" />
          <Rect x="42" y="19" width="10" height="35" rx="2.5" fill={METAL} />
          <Path
            d="M14 31l12-8 12 6 11-13"
            stroke={color.gold}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Circle cx="49" cy="16" r="3.8" fill={color.gold} />
        </G>
      </Raised>
    </>
  );
}

/** Account — you, with the badge a manager wears. */
function AccountIcon() {
  return (
    <>
      <Ground id="ic-acct" />
      <Raised>
        <G>
          <Circle cx="32" cy="24" r="9.5" fill={METAL} />
          <Path d="M15 54a17 17 0 0 1 34 0z" fill={METAL} />
          {/* The badge: this is the one tile that is about you, not the game. */}
          <Circle cx="46" cy="44.5" r="8.5" fill={color.gold} stroke="#0A0E17" strokeWidth="2.5" />
          <Path
            d="M42.2 44.8l2.7 2.7 5.2-5.4"
            stroke="#0A0E17"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      </Raised>
    </>
  );
}

const ICONS: Record<DockIconName, () => React.JSX.Element> = {
  games: GamesIcon,
  leaderboard: LeaderboardIcon,
  index: PlayIcon,
  challenges: ChallengesIcon,
  stats: StatsIcon,
  account: AccountIcon,
};
