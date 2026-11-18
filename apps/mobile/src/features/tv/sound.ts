import { isTV } from './platform';
import { useTVPrefs } from './prefs';

/**
 * Sound effects, on the Apple TV only.
 *
 * A phone plays this game in a pocket, on a train, under a desk; a TV plays it
 * in a room, often with an audience, and a silent TV game reads as broken. So
 * the cues exist on tvOS and nowhere else: `cue()` is a no-op on a phone and
 * on the web, and `expo-audio` is only required once a TV asks for a sound.
 *
 * The sounds are synthesised by `scripts/make-tv-sounds.mjs` -- nothing is
 * sampled, so there is no licence to keep -- and their loudness is balanced
 * there. `MASTER` is the one knob left here.
 *
 * Display only, like every other effect: nothing here can reach a score.
 */
export type Cue =
  | 'focus'
  | 'tick'
  | 'whoosh'
  | 'land'
  | 'lock'
  | 'build'
  | 'stamp'
  | 'perfect'
  | 'denied'
  | 'fair'
  | 'off'
  | 'skip'
  | 'round'
  | 'wipe';

/* eslint-disable @typescript-eslint/no-require-imports */
// A function rather than a table so a test that imports this module (through
// `Pressable`) never asks node to require a .wav; Metro bundles them all the same.
const sources = (): Record<Cue, number> => ({
  focus: require('../../../assets/sounds/tv/focus.wav'),
  tick: require('../../../assets/sounds/tv/tick.wav'),
  whoosh: require('../../../assets/sounds/tv/whoosh.wav'),
  land: require('../../../assets/sounds/tv/land.wav'),
  lock: require('../../../assets/sounds/tv/lock.wav'),
  build: require('../../../assets/sounds/tv/build.wav'),
  stamp: require('../../../assets/sounds/tv/stamp.wav'),
  perfect: require('../../../assets/sounds/tv/perfect.wav'),
  denied: require('../../../assets/sounds/tv/denied.wav'),
  fair: require('../../../assets/sounds/tv/fair.wav'),
  off: require('../../../assets/sounds/tv/off.wav'),
  skip: require('../../../assets/sounds/tv/skip.wav'),
  round: require('../../../assets/sounds/tv/round.wav'),
  wipe: require('../../../assets/sounds/tv/wipe.wav'),
});
/* eslint-enable @typescript-eslint/no-require-imports */

const MASTER = 0.8;

/** Focus moves come in bursts when a direction is held; one tick per 45 ms is plenty. */
const MIN_GAP: Partial<Record<Cue, number>> = { focus: 45, tick: 30 };

interface Player {
  volume: number;
  play(): void;
  seekTo(seconds: number): Promise<void> | void;
}

let audio: { createAudioPlayer(source: number): Player; setAudioModeAsync(mode: object): Promise<void> } | null | undefined;
const players = new Map<Cue, Player>();
const last = new Map<Cue, number>();

function load() {
  if (audio !== undefined) return audio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    audio = require('expo-audio');
    // Mixes with whatever else the TV is playing, and respects the mute of
    // nothing: a TV has no silent switch.
    void audio?.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
  } catch {
    audio = null;
  }
  return audio;
}

function player(name: Cue): Player | null {
  const lib = load();
  if (!lib) return null;
  let p = players.get(name);
  if (!p) {
    p = lib.createAudioPlayer(sources()[name]);
    p.volume = MASTER;
    players.set(name, p);
  }
  return p;
}

/** Plays a cue, if this is a TV and sound is on. Never throws. */
export function cue(name: Cue): void {
  if (!isTV || !useTVPrefs.getState().sound) return;
  const now = Date.now();
  const gap = MIN_GAP[name];
  if (gap && now - (last.get(name) ?? 0) < gap) return;
  last.set(name, now);
  try {
    const p = player(name);
    if (!p) return;
    void Promise.resolve(p.seekTo(0)).catch(() => {});
    p.play();
  } catch {
    // A sound effect is never worth an error.
  }
}

/** Loads every cue up front, so the first spin's whoosh is not late. TV only. */
export function warmSounds(): void {
  if (!isTV) return;
  for (const name of Object.keys(sources()) as Cue[]) {
    try {
      player(name);
    } catch {
      return;
    }
  }
}
