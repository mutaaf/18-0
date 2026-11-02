/**
 * Take `aps-environment` back out of the iOS entitlements.
 *
 * expo-notifications adds it unconditionally, because most apps that schedule
 * a notification also receive pushes. This one does not: reminders are local
 * notifications scheduled on the device (see `src/features/reminders.ts`), and
 * local notifications need no entitlement at all.
 *
 * Leaving it in costs a release. The App Store provisioning profile was minted
 * without the Push Notifications capability, so the first build after
 * expo-notifications arrived died at signing with
 *
 *     Provisioning profile "18-0 App Store" doesn't include the
 *     aps-environment entitlement.
 *
 * and the alternatives were worse: reissue the profile and its CI secret, and
 * then declare a push capability to App Review that nothing uses. If remote
 * push is ever wanted, delete this plugin and add the capability to the App ID
 * in the same change.
 */
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
