import ExpoModulesCore
import UIKit

/**
 * The iPhone Duo's fold, told to JavaScript.
 *
 * A view rather than a module function, for two reasons the SDK makes
 * non-negotiable:
 *
 * - Reserved regions belong to a view. `reservedRegions(kind:)` answers in the
 *   asking view's own coordinate space, and there is no screen-level or
 *   trait-level equivalent -- no notification, no trait, no `UIDevice`
 *   property. Folding is not even a scene geometry change.
 * - UIKit re-runs `layoutSubviews` when a fold changes *only* for a view that
 *   read the regions in its previous pass (observation tracking). A function
 *   polled from JS would see the fold only when something else happened to
 *   lay out.
 *
 * So `FoldSensorView` is mounted once, full-window, invisible and untouchable,
 * at the root of the app. It reads the division regions every layout pass,
 * converts them to window coordinates (which is what React Native measures in),
 * and emits only when they differ from what it last sent.
 *
 * Inactive regions are included: a flat-open device reports its fold as an
 * inactive band, and the layout uses it anyway, so that folding to a book
 * changes nothing on screen but a shadow. The HIG asks for exactly that --
 * small adjustments while folding, never a rearrangement.
 *
 * The hinge is sent alongside, from a `UIHingeInteraction`. Layout never reads
 * it (Apple: reserved regions, not the angle, drive layout); it drives effects.
 */
public final class FoldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Fold")

    View(FoldSensorView.self) {
      Events("onFoldChange")
    }
  }
}

final class FoldSensorView: ExpoView {
  let onFoldChange = EventDispatcher()

  private var lastRegions: [[String: Any]]? = nil
  private var hinge: [String: Any]? = nil
  private var hingeInteraction: AnyObject? = nil

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    isAccessibilityElement = false
    accessibilityElementsHidden = true
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    attachHinge()
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard window != nil else { return }

    var regions: [[String: Any]] = []
    if #available(iOS 27.1, *) {
      // Read on every pass, deliberately: the read is what subscribes this
      // view to the next fold. Skipping it "because nothing changed" would
      // stop the passes that tell us something did.
      for region in reservedRegions(kind: .division, options: .includeInactive) {
        let frame = convert(region.frame, to: nil)
        regions.append([
          "x": frame.origin.x,
          "y": frame.origin.y,
          "width": frame.size.width,
          "height": frame.size.height,
          "margins": [
            "top": region.margins.top,
            "left": region.margins.left,
            "bottom": region.margins.bottom,
            "right": region.margins.right,
          ],
          "active": region.isActive,
        ])
      }
    }

    // Equal regions arrive many times per fold step; JS re-lays out the whole
    // screen on every event, so only a real change is sent.
    if let last = lastRegions, NSArray(array: last).isEqual(to: regions) { return }
    lastRegions = regions
    emit()
  }

  private func attachHinge() {
    guard hingeInteraction == nil, window != nil else { return }
    if #available(iOS 27.1, *) {
      let interaction = UIHingeInteraction { [weak self] _, update in
        guard let self else { return }
        // `update.hinge` is nil outside a hinged device, which is every
        // iPhone that is not a Duo -- and that is a fact worth sending too.
        if let hinge = update.hinge {
          let next: [String: Any] = [
            "status": Self.statusName(hinge.status),
            // UIKit's angle is radians. JS gets degrees, rounded: the system
            // decides the rate and granularity, and the event is cheaper when
            // three equal updates per step collapse into one.
            "angle": (hinge.angle * 180 / .pi).rounded(),
          ]
          if let current = self.hinge, NSDictionary(dictionary: current).isEqual(to: next) { return }
          self.hinge = next
        } else {
          if self.hinge == nil { return }
          self.hinge = nil
        }
        self.emit()
      }
      addInteraction(interaction)
      hingeInteraction = interaction
    }
  }

  @available(iOS 27.1, *)
  private static func statusName(_ status: UIHinge.Status) -> String {
    switch status {
    case .closed: return "closed"
    case .partiallyOpen: return "partiallyOpen"
    case .fullyOpen: return "fullyOpen"
    default: return "unknown"
    }
  }

  private func emit() {
    var payload: [String: Any] = ["regions": lastRegions ?? []]
    if let hinge { payload["hinge"] = hinge }
    onFoldChange(payload)
  }
}
