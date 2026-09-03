import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Installing the game, and taking your seasons with you.
 *
 * Two problems, and only one of them is a button.
 *
 * The first is that the site was not installable at all: Chrome refuses to
 * offer installation without a manifest *and* a service worker that handles
 * fetch, and there was neither. Both now ship, so `beforeinstallprompt` fires
 * and there is a real prompt to trigger.
 *
 * The second is the one that actually loses people's work. On Android and on
 * the desktop an installed app shares storage with the browser it was
 * installed from, so a season played in a tab is there when it opens as an
 * app. On iOS a home-screen web app gets its own storage container, and
 * everything played in Safari is simply not there. Somebody who has built
 * fifteen rosters and then follows a prompt to install would open the app to
 * an empty history, which is a worse outcome than never having installed it.
 *
 * So there is an explicit handoff: the browser copies a transfer code, the
 * installed app pastes it. It is two taps and it works on every platform,
 * including the one where nothing automatic would have.
 *
 * The seasons that were played ranked are on the server regardless and come
 * back with a sign-in. This is for the ones that were not.
 */

/** Where zustand keeps the local history. Both ends of the transfer read it. */
const HISTORY_KEY = '18-0.history';
const DISMISSED_KEY = '18-0.install.dismissed';
const TRANSFER_PREFIX = '18-0:';

export type InstallKind = 'prompt' | 'ios' | 'installed' | 'unsupported';

/** Whether this is already running as an installed app rather than a tab. */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches === true;
  // iOS never matched display-mode until recently and still reports itself
  // through this non-standard flag, which is the only reliable signal there.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

/** iOS Safari, where installing is a menu item rather than a prompt. */
export function isIosBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Every browser on iOS is WebKit underneath and every one of them installs
  // through the same share menu, so the engine is what matters rather than the
  // brand -- Chrome on iOS gets the same instructions as Safari, correctly.
  // iPadOS reports itself as Macintosh, which the touch-point count catches.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * The deferred install prompt, held from the moment the browser offers it.
 *
 * `beforeinstallprompt` fires once and early -- usually before any of the app
 * has mounted -- and the event is only usable if it was captured and its
 * default prevented. So it is caught here, at module load, rather than in a
 * component that may not exist yet.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const announce = () => listeners.forEach((fn) => fn());

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });
}

/** Subscribe to changes in whether an install is offerable. */
export function onInstallAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installKind(): InstallKind {
  if (Platform.OS !== 'web') return 'installed';
  if (isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIosBrowser()) return 'ios';
  return 'unsupported';
}

/** Fires the browser's own install prompt. Returns whether they accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  // The event is single-use. Clearing first means a second tap cannot fire a
  // spent prompt, which throws.
  deferred = null;
  announce();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

export async function dismissInstall(): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, String(Date.now())).catch(() => undefined);
}

/** Whether they have already said no. Asking twice is how a prompt becomes nagging. */
export async function installDismissed(): Promise<boolean> {
  const at = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
  return Boolean(at);
}

// --- the handoff ------------------------------------------------------------

/**
 * Everything this device holds, as a code that can be pasted somewhere else.
 *
 * The raw persisted history, prefixed and base64'd. Not encrypted and not
 * meant to be: it is the player's own seasons, it never leaves their clipboard,
 * and a code they can read is a code they can see is not something else.
 */
export async function exportSeasons(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY).catch(() => null);
  if (!raw) return null;
  try {
    // btoa is byte-oriented; a handle with an accent in it would throw without
    // this round trip through UTF-8.
    const bytes = new TextEncoder().encode(raw);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return TRANSFER_PREFIX + btoa(binary);
  } catch {
    return null;
  }
}

export interface ImportResult {
  ok: boolean;
  seasons?: number;
  error?: string;
}

/**
 * Takes a code from the other side and writes it in, if it is worth writing.
 *
 * Refuses to overwrite a history that already has more in it than the code
 * does. Pasting an old code over seasons played since is the one way this
 * could destroy something, and there is no undo for it.
 */
export async function importSeasons(code: string): Promise<ImportResult> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(TRANSFER_PREFIX)) {
    return { ok: false, error: 'That does not look like a transfer code.' };
  }

  let parsed: { state?: { games?: unknown[] } };
  let raw: string;
  try {
    const binary = atob(trimmed.slice(TRANSFER_PREFIX.length));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    raw = new TextDecoder().decode(bytes);
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That code is damaged or incomplete.' };
  }

  const incoming = Array.isArray(parsed?.state?.games) ? parsed.state!.games!.length : -1;
  if (incoming < 0) return { ok: false, error: 'That code holds no seasons.' };

  const existingRaw = await AsyncStorage.getItem(HISTORY_KEY).catch(() => null);
  let existing = 0;
  if (existingRaw) {
    try {
      const current = JSON.parse(existingRaw) as { state?: { games?: unknown[] } };
      existing = Array.isArray(current?.state?.games) ? current.state!.games!.length : 0;
    } catch {
      existing = 0;
    }
  }
  if (existing > incoming) {
    return {
      ok: false,
      error: `This device already has ${existing} seasons; that code holds ${incoming}.`,
    };
  }

  await AsyncStorage.setItem(HISTORY_KEY, raw);
  return { ok: true, seasons: incoming };
}
