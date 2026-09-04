/**
 * Keep the name on the home screen "18-0" while the native project is called
 * something a parser can read.
 *
 * `expo.name` does two unrelated jobs: it is the label under the icon, and it
 * is what prebuild sanitises into the Xcode target name. "18-0" sanitises to
 * "180", which is *purely numeric*, and an Xcode project file is a plist — so
 * `name = 180;` is written unquoted and every plist parser reads it back as the
 * number 180. EAS then looks up the target by the string "180", matches
 * nothing, and the build dies at "Configure Xcode project" with
 *
 *     Could not find target '180' in project.pbxproj
 *
 * which says nothing about names being numbers. So `expo.name` is now
 * "Eighteen Zero" -- target `EighteenZero`, a string -- and this plugin puts
 * "18-0" back in the two places a person actually sees it.
 */
const { withInfoPlist, withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const DISPLAY_NAME = '18-0';

module.exports = function withDisplayName(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.CFBundleDisplayName = DISPLAY_NAME;
    return cfg;
  });

  return withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: 'app_name', translatable: 'false' }, _: DISPLAY_NAME }],
      cfg.modResults,
    );
    return cfg;
  });
};
