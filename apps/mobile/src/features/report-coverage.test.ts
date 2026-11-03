import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every name on a leaderboard can be reported from where it is shown.
 *
 * Guideline 1.2 asks for a way to report user-generated content, and the only
 * such content here is a display name. For two builds the flag lived only on
 * the plain list rows, and only once a row was expanded: the podium cards, the
 * points rostrum and the points list had none, so a board with three or fewer
 * names — every board on a young leaderboard — offered no way to report anyone.
 * It was found while recording the walkthrough App Review asked for.
 *
 * Each component that renders a handle must render a ReportButton itself.
 */
const SOURCE = readFileSync(resolve(__dirname, '../../app/(tabs)/leaderboard.tsx'), 'utf8');

function body(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`leaderboard.tsx no longer defines ${name}; update this test`);
  const next = SOURCE.indexOf('\nfunction ', start + 1);
  return SOURCE.slice(start, next < 0 ? undefined : next);
}

describe('report coverage on the leaderboards', () => {
  for (const name of ['PodiumCard', 'Entry', 'RostrumStep', 'PointsBoard']) {
    it(`${name} renders a report control`, () => {
      expect(body(name)).toContain('<ReportButton');
    });
  }

  it('the flag on a list row is not hidden behind the roster disclosure', () => {
    const entry = body('Entry');
    const flag = entry.indexOf('<ReportButton');
    const disclosure = entry.indexOf('{open ? (');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(disclosure);
  });
});
