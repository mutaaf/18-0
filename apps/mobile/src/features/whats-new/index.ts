import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { decideWhatsNew, isSuppressed } from './decide';
import { notesFor, type ReleaseNotes } from './notes';

export { notesFor, type ReleaseNotes, type Callout, type CalloutArt } from './notes';

/**
 * The runtime half of the What's New sheet: which version is running, what was
 * last seen, and whether this device has played before. The rules are in
 * `decide.ts`; the text is in `apps/mobile/store/whats-new.json`.
 */

const SEEN_KEY = '18-0.whatsnew.seen';
// The history store's key (state/history.ts). Read, never written: its
// presence is what tells a player from before this sheet existed apart from a
// fresh install, since neither has a SEEN_KEY.
const HISTORY_KEY = '18-0.history';

/**
 * The marketing version of what is running. The binary's own version first on
 * native, because that is what the store installed; the config's on the web,
 * where there is no binary and the export carries app.config.js's version.
 */
export function runningVersion(): string | null {
  return (
    (Platform.OS !== 'web' ? Constants.nativeApplicationVersion : null) ??
    Constants.expoConfig?.version ??
    null
  );
}

function webSearch(): string | undefined {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.search : undefined;
}

/**
 * `?whatsnew=<version>` on the web shows that version's sheet and records
 * nothing -- for reading new copy on the real screen before it ships, and for
 * the screenshot in the pull request that writes it.
 */
function previewVersion(): string | null {
  const search = webSearch();
  if (!search) return null;
  return new URLSearchParams(search).get('whatsnew');
}

/** The notes to show this launch, or null. Resolves once, at mount. */
export function useWhatsNew(): [ReleaseNotes | null, () => void] {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);

  useEffect(() => {
    let live = true;
    const preview = previewVersion();
    if (preview) {
      setNotes(notesFor(preview));
      return;
    }

    void (async () => {
      const suppressed = isSuppressed({
        nodeEnv: process.env.NODE_ENV,
        vitest: process.env.VITEST,
        webdriver: typeof navigator !== 'undefined' ? navigator.webdriver === true : false,
        search: webSearch(),
      });
      if (suppressed) return;

      const current = runningVersion();
      let seen: string | null = null;
      let hasHistory = false;
      try {
        [seen, hasHistory] = await Promise.all([
          AsyncStorage.getItem(SEEN_KEY),
          AsyncStorage.getItem(HISTORY_KEY).then((raw) => raw !== null),
        ]);
      } catch {
        // No storage means no way to remember having shown it; showing it on
        // every launch would be worse than never showing it.
        return;
      }

      const release = notesFor(current);
      const decision = decideWhatsNew({ current, seen, hasHistory, hasNotes: release !== null, suppressed });
      if (decision.record) await AsyncStorage.setItem(SEEN_KEY, decision.record).catch(() => undefined);
      if (live && decision.show) setNotes(release);
    })();

    return () => {
      live = false;
    };
  }, []);

  return [notes, () => setNotes(null)];
}
