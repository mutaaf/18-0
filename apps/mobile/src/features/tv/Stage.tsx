import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { TV_SAFE, TV_SCALE, color, themed, useWindowSize } from '@/theme';

/**
 * The 1280 x 720 stage a television draws the app on, scaled to the glass.
 *
 * See `TV_SCALE` for why. A pass-through everywhere else, so the phone, the
 * web and the extension's frame render exactly the tree they always did.
 *
 * Scaled from the top-left corner, because the stage is sized to the window
 * divided by the scale and a centred scale would push half the overflow off
 * each edge. The focus engine follows transforms, so focus moves between the
 * views where they are drawn rather than where they were laid out.
 *
 * Anything presented in a native modal escapes this view's transform -- it is
 * another view controller -- so a modal's content is wrapped in its own stage.
 */
export function TVStage({ children }: { children: ReactNode }) {
  const stage = useWindowSize();
  if (TV_SCALE === 1) return <>{children}</>;
  return (
    <View style={styles.glass}>
      <View
        style={{
          width: stage.width,
          height: stage.height,
          transformOrigin: 'top left',
          transform: [{ scale: TV_SCALE }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

const TV_INSETS = { top: TV_SAFE.y, bottom: TV_SAFE.y, left: TV_SAFE.x, right: TV_SAFE.x };

/**
 * The TV-safe margins, given to everything that asks for safe-area insets.
 *
 * Inside the safe-area provider, so it wins. On a phone the insets are the
 * notch and the home indicator and the native provider measures them; on a TV
 * they are the overscan margins, which are a fixed rule rather than anything
 * to measure -- and a native measurement would be in screen points, not the
 * stage's. The screens, the dock, the rail and the account button already keep
 * clear of the insets, so backgrounds run to the edge of the glass and nothing
 * that matters does.
 */
export function TVSafeArea({ children }: { children: ReactNode }) {
  if (TV_SCALE === 1) return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={TV_INSETS}>{children}</SafeAreaInsetsContext.Provider>;
}

const styles = themed(() => StyleSheet.create({ glass: { flex: 1, overflow: 'hidden', backgroundColor: color.void } }));
