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

  it('the screen applies the reserve inside its backdrop', () => {
    const screen = read('./Screen.tsx');
    expect(screen).toMatch(/paddingBottom:\s*chrome\.bottom/);
    expect(screen).toMatch(/paddingRight:\s*chrome\.right/);
    expect(screen.indexOf('<StadiumBackdrop')).toBeLessThan(screen.indexOf('chrome.bottom'));
  });

  it('the closed phone bar keeps its tabs out of the side status strip', () => {
    const bar = read('./NavBar.tsx');
    expect(bar).toMatch(/paddingLeft:\s*insets\.left/);
    expect(bar).toMatch(/paddingRight:\s*insets\.right/);
  });
});
