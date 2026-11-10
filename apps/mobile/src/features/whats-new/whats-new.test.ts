import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIM_FRANCHISES } from '@17-0/domain/sim';
import { storeText, whatsNewFor } from '../../../../../scripts/store/whats-new.mjs';
import { compareVersions, decideWhatsNew, isSuppressed, type WhatsNewInput } from './decide';
import { CALLOUT_ART, RELEASE_NOTES, notesFor } from './notes';

const MOBILE = join(__dirname, '..', '..', '..');
const ROOT = join(MOBILE, '..', '..');

/** The marketing version app.config.js ships, read the way release.mjs reads it. */
const CURRENT = /version:\s*'([^']+)'/.exec(readFileSync(join(MOBILE, 'app.config.js'), 'utf8'))?.[1] ?? '';

const base: WhatsNewInput = { current: '1.1.0', seen: null, hasHistory: false, hasNotes: true, suppressed: false };

describe('once per version', () => {
  it('a fresh install shows nothing and records the version', () => {
    expect(decideWhatsNew(base)).toEqual({ show: false, record: '1.1.0' });
  });

  it('an update shows once and records the version', () => {
    expect(decideWhatsNew({ ...base, seen: '1.0.0' })).toEqual({ show: true, record: '1.1.0' });
  });

  it('the same version again shows nothing and writes nothing', () => {
    expect(decideWhatsNew({ ...base, seen: '1.1.0' })).toEqual({ show: false, record: null });
  });

  it('shown, recorded, then relaunched: the second launch shows nothing', () => {
    const first = decideWhatsNew({ ...base, seen: '1.0.0' });
    expect(first.show).toBe(true);
    expect(decideWhatsNew({ ...base, seen: first.record }).show).toBe(false);
  });

  it('a player from before the sheet existed (history, no record) counts as an update', () => {
    expect(decideWhatsNew({ ...base, hasHistory: true })).toEqual({ show: true, record: '1.1.0' });
  });

  it('a downgrade shows nothing and keeps the newer record', () => {
    expect(decideWhatsNew({ ...base, current: '1.0.0', seen: '1.1.0' })).toEqual({ show: false, record: null });
  });

  it('a version with no notes shows nothing but is still recorded', () => {
    expect(decideWhatsNew({ ...base, seen: '1.0.0', hasNotes: false })).toEqual({ show: false, record: '1.1.0' });
  });

  it('compares versions numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});

describe('suppressed', () => {
  it('shows nothing and records nothing, even on an update', () => {
    expect(decideWhatsNew({ ...base, seen: '1.0.0', suppressed: true })).toEqual({ show: false, record: null });
    expect(decideWhatsNew({ ...base, suppressed: true })).toEqual({ show: false, record: null });
  });

  it('under a test runner', () => {
    expect(isSuppressed({ vitest: 'true' })).toBe(true);
    expect(isSuppressed({ nodeEnv: 'test' })).toBe(true);
    // This file is itself running under one.
    expect(isSuppressed({ nodeEnv: process.env.NODE_ENV, vitest: process.env.VITEST })).toBe(true);
  });

  it('in a browser driven by automation (store capture, verify:fold)', () => {
    expect(isSuppressed({ webdriver: true })).toBe(true);
  });

  it.each(['?capture', '?demo=1', '?nowhatsnew', '?c=abc&capture=1'])('with %s on the address', (search) => {
    expect(isSuppressed({ search })).toBe(true);
  });

  it('not for a person opening the app', () => {
    expect(isSuppressed({ nodeEnv: 'production', webdriver: false, search: '?c=abc' })).toBe(false);
    expect(isSuppressed({})).toBe(false);
  });
});

describe('the notes', () => {
  it('exist for the version app.config.js ships', () => {
    expect(CURRENT).toMatch(/^\d+\.\d+\.\d+$/);
    expect(notesFor(CURRENT)).not.toBeNull();
  });

  it('are one entry per version, newest first', () => {
    const versions = RELEASE_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
    expect(versions).toEqual(sorted);
    expect(RELEASE_NOTES[0]?.version).toBe(CURRENT);
  });

  it.each(RELEASE_NOTES.map((n) => [n.version, n] as const))('%s has the shape the sheet lays out', (_v, notes) => {
    expect(notes.headline.length).toBeGreaterThan(0);
    expect(notes.headline.length).toBeLessThanOrEqual(40);
    expect(notes.subhead.length).toBeLessThanOrEqual(160);
    expect(notes.callouts.length).toBeGreaterThanOrEqual(2);
    expect(notes.callouts.length).toBeLessThanOrEqual(4);
    for (const callout of notes.callouts) {
      expect(CALLOUT_ART).toContain(callout.art);
      // "A few words" and "one short line": the 2x2 grid is two columns on a phone.
      expect(callout.title.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(callout.title.length).toBeLessThanOrEqual(22);
      expect(callout.line.length).toBeLessThanOrEqual(70);
    }
    expect(notes.notes.length).toBeGreaterThan(0);
  });

  it.each(RELEASE_NOTES.map((n) => [n.version, n] as const))('%s fits the App Store field', (version, notes) => {
    // Apple allows 4000 characters, counted as code points.
    expect([...storeText(notes)].length).toBeLessThanOrEqual(4000);
    // And the store scripts see the same entry the app does.
    expect(whatsNewFor(version)?.headline).toBe(notes.headline);
  });

  it('name no club, league, brand or real event', () => {
    // Club nicknames come from the franchise table itself, so a new franchise
    // is covered without anybody remembering to add it here. The rest is the
    // store art's own avoid-list plus the marks most likely to slip into a
    // seasonal joke.
    const lobby = JSON.parse(readFileSync(join(ROOT, 'store', 'lobby.json'), 'utf8')) as { avoid: string[] };
    const nicknames = SIM_FRANCHISES.map((f) => f.displayName.split(' ').pop() ?? '');
    const marks = [
      ...lobby.avoid,
      ...nicknames,
      'National Football League', 'AFC', 'NFC', 'Pro Bowl', 'Monday Night', 'Thursday Night',
      'Sunday Night', 'Red Zone', 'RedZone', 'Hail Mary', 'Lombardi', 'Heisman', 'Combine',
    ];
    const text = JSON.stringify(RELEASE_NOTES);
    const found = marks.filter((mark) => new RegExp(`\\b${mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    expect(found).toEqual([]);
  });
});
