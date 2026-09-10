import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { track } from '@/features/telemetry';
import { fetchMultiplier } from '@/services/supabase';

/**
 * Local reminders, and only the one that has something true to say.
 *
 * A streak is the only thing in this game that can be lost by not playing, and
 * it is the only thing worth interrupting somebody for. "Come back and play"
 * is a notification about the app's needs; "your six-day streak ends tonight"
 * is a notification about theirs, and the difference is whether the message is
 * still worth reading when it turns out to be true.
 *
 * Everything here is local. There is no push token, no server that knows when
 * somebody last played, and nothing leaves the device -- the schedule is
 * computed from a number the app already asked for.
 *
 * Permission is never requested at launch. A prompt before the first season
 * asks somebody to protect a streak they do not have, which is how an app
 * teaches people to say no. It is requested after a season that started one.
 */

const CHANNEL = 'streaks';

/** iOS shows nothing in the foreground unless it is told to. It should not. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const supported = () => Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * The player's own switch, separate from the operating system's.
 *
 * The OS permission answers "may this app notify me at all" and it is granted
 * once, in the moment after a season that started a streak. Turning reminders
 * off afterwards has to be possible without revoking that in Settings -- and
 * it has to *stick*, which is the part that needs storing: `result.tsx` calls
 * `scheduleStreakReminder` after every scored season, so a switch that only
 * cancelled what was pending would put the reminder straight back the next
 * time somebody played.
 *
 * Absent means on. Somebody who has granted permission and never touched this
 * has already said yes to the only question being asked.
 */
const PREFERENCE_KEY = '18-0:reminders';

export type ReminderState =
  /** Not iOS or Android; nothing can be scheduled. */
  | 'unsupported'
  /** Permission refused for good. Only Settings can undo it. */
  | 'blocked'
  | 'on'
  | 'off';

async function wanted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREFERENCE_KEY)) !== 'off';
  } catch {
    return true;
  }
}

/** What the switch should be showing, without asking for anything. */
export async function reminderState(): Promise<ReminderState> {
  if (!supported()) return 'unsupported';
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return permission.canAskAgain ? 'off' : 'blocked';
    return (await wanted()) ? 'on' : 'off';
  } catch {
    return 'unsupported';
  }
}

/**
 * Flips it, asking for permission only on the way on.
 *
 * Returns the state that actually resulted, which is not always the one that
 * was asked for: somebody who turns the switch on and then declines the system
 * prompt gets `off` back, and the switch has to follow rather than lie.
 */
export async function setReminders(on: boolean): Promise<ReminderState> {
  if (!supported()) return 'unsupported';

  if (!on) {
    await AsyncStorage.setItem(PREFERENCE_KEY, 'off').catch(() => undefined);
    await clearReminders();
    track('reminders_toggled', { on: false });
    return 'off';
  }

  const granted = await askForReminders();
  if (!granted) return reminderState();
  await AsyncStorage.setItem(PREFERENCE_KEY, 'on').catch(() => undefined);
  track('reminders_toggled', { on: true });
  // Straight away rather than at the end of the next season: turning it on and
  // then hearing nothing for a day is indistinguishable from it not working.
  await scheduleStreakReminder();
  return 'on';
}

/**
 * Asks, once, at a moment when the answer means something.
 *
 * Returns whether reminders may be shown. Never throws: a simulator without a
 * push entitlement and a player who said no are the same outcome here.
 */
export async function askForReminders(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    // `canAskAgain` false means they said no once. Asking again is what makes
    // an app feel like it is negotiating.
    if (!existing.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    track('reminders_prompted', { granted: asked.granted });
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Re-schedules the streak reminder from the streak the server actually has.
 *
 * Called after a season is scored. Every pending reminder is cleared first:
 * yesterday's warning is wrong the moment a new season lands, and a stale one
 * firing after somebody has already played is the fastest way to teach them
 * that these are noise.
 *
 * The time is chosen to be useful rather than urgent. A day counts in UTC on
 * the server, so the honest deadline is the next UTC midnight, and the reminder
 * lands three hours before it -- late enough to mean something, early enough
 * that a season can still be played.
 */
export async function scheduleStreakReminder(): Promise<void> {
  if (!supported()) return;
  try {
    const granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) return;
    // Checked here rather than at the call sites: this runs after every scored
    // season, and it is the one place every path to a scheduled reminder goes
    // through.
    if (!(await wanted())) return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    const bonus = await fetchMultiplier();
    // Nothing to protect: no streak, no reminder. An app that notifies about
    // nothing is an app whose notifications get turned off.
    if (!bonus || bonus.dayStreak < 1) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Streaks',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const nextMidnightUtc = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
    );
    const fireAt = new Date(nextMidnightUtc - 3 * 60 * 60 * 1000);
    const seconds = Math.round((fireAt.getTime() - Date.now()) / 1000);
    // Already inside the last three hours: the next deadline is the one after.
    if (seconds < 60) return;

    const days = bonus.dayStreak;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: days === 1 ? 'Keep it going' : `${days} days in a row`,
        body:
          days === 1
            ? 'Play a season today and your streak starts paying.'
            : `One season keeps it alive. It is worth ×${bonus.multiplier.toFixed(2)} right now.`,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    track('reminder_scheduled', { day_streak: days, in_seconds: seconds });
  } catch {
    // A reminder that cannot be scheduled is not worth a broken result screen.
  }
}

/** For a sign-out or a deletion: nothing should fire for an account that left. */
export async function clearReminders(): Promise<void> {
  if (!supported()) return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
}
