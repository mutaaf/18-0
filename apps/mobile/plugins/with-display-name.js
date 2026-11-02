/**
 * Keep the name on the home screen "17-0" while the native project is called
 * something a parser can read.
 *
 * `expo.name` does two unrelated jobs: it is the label under the icon, and it
 * is what prebuild sanitises into the Xcode target name. The name was "18-0"
 * then, which sanitises to "180" -- *purely numeric* -- and an Xcode project
 * file is a plist, so `name = 180;` is written unquoted and every plist parser
 * reads it back as the number 180. EAS then looks up the target by the string
 * "180", matches nothing, and the build dies at "Configure Xcode project" with
 *
 *     Could not find target '180' in project.pbxproj
 *
 * which says nothing about names being numbers. "17-0" has exactly the same
 * problem ("170"). So `expo.name` is "Seventeen Zero" -- target
 * `SeventeenZero`, a string -- and this plugin puts "17-0" back in the two
 * places a person actually sees it.
 */
const { withInfoPlist, withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const DISPLAY_NAME = '17-0';

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
