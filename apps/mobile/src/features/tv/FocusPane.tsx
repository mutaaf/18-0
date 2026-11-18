import type { ReactNode } from 'react';
import { StyleSheet, TVFocusGuideView } from 'react-native';
import { themed } from '@/theme';
import { isTV } from './platform';

/**
 * One page of a two-page spread, as a focus guide on a TV; nothing at all
 * anywhere else (the children are returned as they are, so a phone or the web
 * lays out exactly what it did before).
 *
 * The focus engine moves sideways only to something level with the focused
 * control. The result screen's two pages are not level: from "Not now" at the
 * foot of the record there is nothing on the roster page beside it, and right
 * went nowhere. A guide the size of the page
 * is always beside it, and `autoFocus` hands focus on to whatever was focused
 * in that page last, or the first thing in it -- so right and left cross
 * between the pages from anywhere, and come back to where they left.
 */
export function FocusPane({ children }: { children: ReactNode }) {
  if (!isTV) return <>{children}</>;
  return (
    <TVFocusGuideView autoFocus style={styles.fill}>
      {children}
    </TVFocusGuideView>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
}));
