import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Navigation reserves its space inside the screen's backdrop, never around it.
 *
 * The tab layout padded `sceneStyle` for the floating dock and the wide-window
 * rail. The scene sits outside `StadiumBackdrop`, so that padding painted bare
 * ground: a dead band under the glass dock and a dead strip beside the rail.
 * `useChrome` carries the reserve to `Screen`, which pads inside the backdrop.
 */
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('navigation chrome', () => {
  it('the tab scene carries no padding', () => {
    const layout = read('../../app/(tabs)/_layout.tsx');
    const scene = layout.match(/sceneStyle:\s*\{([^}]*)\}/);
    expect(scene, 'sceneStyle not found').not.toBeNull();
    expect(scene![1]).not.toMatch(/padding|margin/);
    expect(layout).toMatch(/ChromeProvider/);
  });

  it('the screen applies the rail reserve inside its backdrop', () => {
    const screen = read('./Screen.tsx');
    expect(screen).toMatch(/paddingRight:\s*chrome\.right/);
    expect(screen.indexOf('<StadiumBackdrop')).toBeLessThan(screen.indexOf('chrome.right'));
  });

  /**
   * The dock's reserve is not padding. Padding the screen by it cut every
   * scroll off in a hard line a dock's height above the bottom of a wide
   * window, with the glass dock floating over bare ground beside the cut.
   * The scroll runs to the edge and ends with a `DockSpacer` instead.
   */
  it('content scrolls under the dock and every tab scroll ends clear of it', () => {
    expect(read('./Screen.tsx')).not.toMatch(/paddingBottom:\s*chrome\.bottom/);
    for (const tab of ['index', 'account', 'challenges', 'leaderboard', 'stats', 'games']) {
      const source = read(`../../app/(tabs)/${tab}.tsx`);
      const closes = [...source.matchAll(/^(\s*)<\/ScrollView>/gm)];
      for (const close of closes) {
        const before = source.slice(0, close.index).trimEnd();
        // The front page's outer scroll holds a window-tall stage for the
        // lobby, whose own scrolls carry the spacer.
        if (tab === 'index' && /<Showcase[\s\S]{0,1200}$/.test(before)) continue;
        expect(before.endsWith('<DockSpacer />'), `${tab}.tsx: a ScrollView that does not end with <DockSpacer />`).toBe(true);
      }
      const lists = source.match(/<(FlatList|FlashList)\b[\s\S]*?\/>\s*\n/g) ?? [];
      for (const list of lists) expect(list, `${tab}.tsx: a list with no DockSpacer footer`).toMatch(/ListFooterComponent=\{<DockSpacer \/>\}/);
    }
  });

  it('the closed phone bar keeps its tabs out of the side status strip', () => {
    const bar = read('./NavBar.tsx');
    expect(bar).toMatch(/paddingLeft:\s*insets\.left/);
    expect(bar).toMatch(/paddingRight:\s*insets\.right/);
  });
});
