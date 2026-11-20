import Foundation
import ObjectiveC

/**
 * On a TV, a scroll view tells React where it is scrolled once it stops, not
 * on every frame of getting there.
 *
 * Fabric's scroll view (`RCTScrollViewComponentView`) answers every
 * `scrollViewDidScroll:` with `_updateStateWithContentOffset`: a state update
 * that the JS thread turns into a commit of the whole shadow tree, with a Yoga
 * layout pass and a walk of every node to round it to the pixel grid. On an
 * Apple TV the focus engine scrolls the list for nearly every press of the
 * remote -- an animation of about twenty frames -- so each press queued twenty
 * whole-screen commits on the JS thread. On the play screen that was the
 * largest single share of the JS thread's work per press (measured with Time
 * Profiler, docs/apple-tv.md "The fourth pass"), and a real Apple TV ran
 * hundreds of milliseconds late on everything JS-driven behind it.
 *
 * The state is the content offset, which nothing on the JS side needs per
 * frame: `onScroll` events are separate and still fire as before. So the
 * update is deferred until the scrolling has paused for a moment, and then
 * made once with the offset at that time. A `measure` in the instant between
 * reads an offset that is at most that long out of date.
 *
 * tvOS only: a phone's scrolling is a finger's, with its own costs, and is
 * left exactly as React Native ships it.
 */
enum ScrollStateCoalescer {
  /// How long scrolling must rest before the offset is committed.
  static let quiet: TimeInterval = 0.12
  private static var installed = false

  static func install() {
    #if os(tvOS)
    guard !installed, let cls = NSClassFromString("RCTScrollViewComponentView") else { return }
    let original = NSSelectorFromString("_updateStateWithContentOffset")
    guard let method = class_getInstanceMethod(cls, original) else { return }
    installed = true

    typealias Update = @convention(c) (AnyObject, Selector) -> Void
    let update = unsafeBitCast(method_getImplementation(method), to: Update.self)
    let flush = NSSelectorFromString("seventeenZero_commitContentOffset")
    let commit: @convention(block) (AnyObject) -> Void = { view in update(view, original) }
    class_addMethod(cls, flush, imp_implementationWithBlock(commit), "v@:")

    let deferred: @convention(block) (NSObject) -> Void = { view in
      NSObject.cancelPreviousPerformRequests(withTarget: view, selector: flush, object: nil)
      view.perform(flush, with: nil, afterDelay: quiet, inModes: [.common])
    }
    method_setImplementation(method, imp_implementationWithBlock(deferred))
    #endif
  }
}
