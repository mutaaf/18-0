import { describe, expect, it } from 'vitest';
import { remoteAction } from './remote-calls';

describe('Gut Check on the Siri Remote', () => {
  it('right is fair and left is off, by swipe or by click', () => {
    for (const right of ['right', 'swipeRight']) expect(remoteAction(right, undefined, 'judge')).toBe('fair');
    for (const left of ['left', 'swipeLeft']) expect(remoteAction(left, 1, 'judge')).toBe('off');
  });

  it('up and down mean nothing until the card asks which way', () => {
    expect(remoteAction('swipeUp', undefined, 'judge')).toBeNull();
    expect(remoteAction('down', 1, 'judge')).toBeNull();
  });

  it('then up deserves more and down deserves less', () => {
    // "Deserves more" is the rating being too low, as the swipe deck records it.
    expect(remoteAction('swipeUp', undefined, 'which')).toBe('too_low');
    expect(remoteAction('up', 1, 'which')).toBe('too_low');
    expect(remoteAction('swipeDown', undefined, 'which')).toBe('too_high');
    expect(remoteAction('down', 1, 'which')).toBe('too_high');
  });

  it('right is still "fair after all" once asked, and left is nothing', () => {
    expect(remoteAction('swipeRight', undefined, 'which')).toBe('fair');
    expect(remoteAction('left', 1, 'which')).toBeNull();
  });

  it('answers a click once, on release', () => {
    expect(remoteAction('right', 0, 'judge')).toBeNull();
    expect(remoteAction('right', 1, 'judge')).toBe('fair');
  });

  it('leaves select, menu and play/pause to the buttons and the navigator', () => {
    for (const other of ['select', 'menu', 'playPause', 'longSelect', 'focus', 'blur', 'pan']) {
      expect(remoteAction(other, undefined, 'judge')).toBeNull();
      expect(remoteAction(other, 1, 'which')).toBeNull();
    }
  });
});
