import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `modules/fold` calls iOS 27.1 API (reservedRegions, UIHingeInteraction).
 * `#available` guards the call at run time but cannot conjure a declaration the
 * SDK lacks, so an older Xcode fails the build outright. EAS picks Xcode 26.6
 * for Expo SDK 57 when no image is named -- which is what built 1.0 (6) -- so
 * every iOS profile names an Xcode 27.1+ image, and this keeps it that way.
 */
const MIN: [number, number] = [27, 1];

describe('EAS builds iOS with an SDK that has the fold', () => {
  const eas = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'eas.json'), 'utf8')) as {
    build: Record<string, { ios?: { image?: string } }>;
  };

  it.each(Object.keys(eas.build))('%s names an Xcode 27.1+ image', (profile) => {
    const image = eas.build[profile]?.ios?.image ?? '';
    const match = /xcode-(\d+)\.(\d+)/.exec(image);
    expect(match, `eas.json build.${profile}.ios.image is "${image}"`).not.toBeNull();
    const [major, minor] = [Number(match![1]), Number(match![2])];
    expect(major > MIN[0] || (major === MIN[0] && minor >= MIN[1])).toBe(true);
  });
});
