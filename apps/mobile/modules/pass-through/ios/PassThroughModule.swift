import ExpoModulesCore
import UIKit

/**
 * A view the tvOS focus engine looks straight through.
 *
 * UIKit will not move focus to an item another view covers, and the test it
 * uses is the covering view's `isUserInteractionEnabled` -- including its
 * ancestors'. React Native's `pointerEvents="none"` sets that property, but
 * react-native-tvos overrides the getter on every Fabric view to answer YES
 * (`RCTViewComponentView isUserInteractionEnabled`), so on a TV no React
 * Native view is ever transparent to focus. The result screen's fireworks
 * were a full-screen view over the page for nine seconds, and for those nine
 * seconds the remote could not cross from Build Another to the roster.
 *
 * This view answers NO, and so everything inside it -- the overlay and the
 * Skia canvas drawing the show -- stops counting as cover. Measured with
 * `UIFocusDebugger checkFocusabilityForItem:` before and after
 * (docs/apple-tv.md, Performance). It draws nothing and takes no touches;
 * nothing on a TV is touched.
 */
public final class PassThroughView: ExpoView {
  public override var isUserInteractionEnabled: Bool {
    get { false }
    set {}
  }
}

public class PassThroughModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PassThrough")
    View(PassThroughView.self) {}
  }
}
