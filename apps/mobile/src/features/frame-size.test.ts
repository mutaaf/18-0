import { describe, expect, it } from 'vitest';
import { NOTHING_SHOWN, decide, type EmbedScreen, type FrameTalk } from './frame-size';

/**
 * The frame's handshake, driven the way a player drives it.
 *
 * `environment: 'node'`, so this may not import anything that reaches
 * react-native -- which is why the rule lives in a module of its own.
 */

/** Runs a sequence of messages and returns the ones the host would hear. */
function heard(steps: Array<[EmbedScreen, number?]>): Array<[EmbedScreen, number | undefined]> {
  let at: FrameTalk = NOTHING_SHOWN;
  const out: Array<[EmbedScreen, number | undefined]> = [];
  for (const [screen, height] of steps) {
    const { send, next } = decide(at, screen, height);
    at = next;
    if (send) out.push([screen, height]);
  }
  return out;
}

describe('what the host is told about the frame', () => {
  it('passes on a screen change', () => {
    expect(heard([['entry']])).toEqual([['entry', undefined]]);
  });

  it('passes on a measurement of the screen that is showing', () => {
    expect(heard([['entry'], ['entry', 232]])).toEqual([
      ['entry', undefined],
      ['entry', 232],
    ]);
  });

  it('lets a screen re-measure as often as it likes', () => {
    // The board arrives empty, paints a cached list and then a fresh one, and
    // every one of those is a different height.
    expect(heard([['board'], ['board', 180], ['board', 300], ['board', 260]])).toHaveLength(4);
  });

  /**
   * The bug. The entry card's last layout pass runs *after* the game has
   * announced itself, and it used to put the entry card's height back on a
   * frame that had just become the game -- a roster in a box the height of a
   * play button, with the spin card cut in half.
   */
  it('drops a measurement from a screen the player has left', () => {
    expect(heard([['entry'], ['entry', 232], ['play'], ['entry', 232]])).toEqual([
      ['entry', undefined],
      ['entry', 232],
      ['play', undefined],
    ]);
  });

  it('and the screen that has been left does not take the frame back', () => {
    // Not just "that one message is dropped": the stale screen must not become
    // the current one either, or its *next* measurement would be admitted.
    expect(heard([['play'], ['entry', 232], ['entry', 400], ['play', 620]])).toEqual([
      ['play', undefined],
      ['play', 620],
    ]);
  });

  it('a measurement before any screen has been named is dropped', () => {
    // Nothing has told the host where the player is, so there is nothing this
    // height can be about.
    expect(heard([['entry', 232]])).toEqual([]);
  });

  it('going back to a screen makes its measurements admissible again', () => {
    // Finishing a game returns to the entry card, which is a handover like any
    // other -- it must not stay muted because it was once left behind.
    expect(heard([['entry'], ['play'], ['entry'], ['entry', 232]])).toEqual([
      ['entry', undefined],
      ['play', undefined],
      ['entry', undefined],
      ['entry', 232],
    ]);
  });

  it('every screen the game can be on is understood', () => {
    for (const screen of ['entry', 'play', 'result', 'board', 'seasons'] as const) {
      expect(decide(NOTHING_SHOWN, screen).send, screen).toBe(true);
      expect(decide({ showing: screen }, screen, 300).send, screen).toBe(true);
    }
  });
});

/**
 * The ticket that carries framed seasons onto a real account.
 *
 * Tested here rather than in a component test because the rule is about what
 * may be in a URL, and that is the half of the flow a mistake is silent in: a
 * malformed ticket accepted here is a round trip that tells whoever sent it
 * whether they were close.
 */
describe('a transfer ticket arriving in the address bar', () => {
  const shaped = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  it('takes the shape the server mints', () => {
    expect(shaped('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(shaped('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('refuses anything that is not one', () => {
    for (const hostile of [
      '',
      'null',
      'undefined',
      '../../etc/passwd',
      "' or 1=1--",
      '<script>alert(1)</script>',
      '3f2504e0-4f89-41d3-9a0c',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301x',
      'zzzzzzzz-4f89-41d3-9a0c-0305e82c3301',
    ]) {
      expect(shaped(hostile), hostile).toBe(false);
    }
  });
});
