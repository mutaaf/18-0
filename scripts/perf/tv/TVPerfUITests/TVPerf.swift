import XCTest

/// The Apple TV performance harness (docs/apple-tv.md, "Performance").
///
/// Drives the installed 17-0 app with the Siri Remote (`XCUIRemote`), the way a
/// person does, and marks the start and end of each measured block. The runner
/// (run.sh) samples the app's CPU time and memory from the host -- a simulator
/// app is a Mac process -- and charges each block with what it spent.
/// XCTest's own `XCTCPUMetric`, `XCTHitchMetric` and launch metric record
/// nothing on a tvOS simulator, which is why it is done this way.
///
/// Every test plays Rookie, which is practice: nothing here reaches a
/// leaderboard. Gut Check is played with Select ("don't know"), which records
/// nothing. A measured block never queries the accessibility tree: a query is
/// a snapshot of the whole app, and it would be the most expensive thing in it.
/// `test00_Controls` is the harness's own cost, to subtract.
final class TVPerf: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.eighteenzerodcai.app")
    let remote = XCUIRemote.shared

    override func setUp() {
        continueAfterFailure = true
    }

    // MARK: helpers

    func press(_ button: XCUIRemote.Button, _ times: Int = 1, gap: TimeInterval = 0.45) {
        for _ in 0..<times {
            remote.press(button)
            Thread.sleep(forTimeInterval: gap)
        }
    }

    var focusedLabel: String {
        let el = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
        return el.exists ? el.label : ""
    }

    /// Presses `button` until the focused element's label starts with `prefix`.
    @discardableResult
    func seek(_ prefix: String, _ button: XCUIRemote.Button, max: Int = 8) -> Bool {
        for _ in 0..<max {
            if focusedLabel.hasPrefix(prefix) { return true }
            press(button, gap: 0.6)
        }
        return focusedLabel.hasPrefix(prefix)
    }

    /// From the front page to Account's "On this TV" and back, flipping a switch.
    func toggleTVSetting(_ title: String) {
        press(.up, 3, gap: 0.6)                   // onto the tab bar
        XCTAssertTrue(seek("Account", .right, max: 8), "never reached the account disc: \(focusedLabel)")
        press(.select, gap: 2.5)
        XCTAssertTrue(seek(title, .down, max: 6), "never reached \(title): \(focusedLabel)")
        press(.select, gap: 1)
        report("toggled", focusedLabel)
        launchHome()
    }

    func report(_ name: String, _ value: Any) {
        print("PERF \(name) \(value)")
    }

    func launchHome(settle: TimeInterval = 4) {
        app.terminate()
        app.launch()
        Thread.sleep(forTimeInterval: settle)
        resetHome()
    }

    /// Every test starts from the same front page, whatever the last one left:
    /// no game in progress (a failed run leaves one, and Play becomes Resume)
    /// and Ranked on, so the lens tiles carry the same notes.
    func resetHome() {
        if focusedLabel.hasPrefix("Resume") {
            press(.right, gap: 0.6)
            if focusedLabel.hasPrefix("Discard") { press(.select, gap: 1.5) }
            report("reset", "discarded a game in progress")
        }
        if !focusedLabel.hasPrefix("Play") { return }
        press(.right, gap: 0.6)
        let ranked = app.switches.matching(NSPredicate(format: "label == 'Play for the leaderboard'")).firstMatch
        if ranked.exists, ranked.hasFocus, (ranked.value as? String) == "0" {
            press(.select, gap: 1)
            report("reset", "ranked back on")
        }
        press(.left, gap: 0.6)
    }

    /// Brackets a block with wall-clock marks. The runner samples the app's
    /// CPU time and memory from the host and charges each block with what it
    /// spent; `moves` turns that into a cost per remote press.
    func mark(_ name: String, moves: Int = 0, _ block: () -> Void) {
        print(String(format: "PERF begin %@ %.3f %d", name, Date().timeIntervalSince1970, moves))
        block()
        print(String(format: "PERF end %@ %.3f", name, Date().timeIntervalSince1970))
    }

    /// From the front page (Play focused) to the result screen, by Select alone:
    /// the remote lands on the first player who fits after each spin, on the
    /// first eligible slot when a pick fits two, on Spin once a pick is placed,
    /// and on Reveal when the roster is full (docs/apple-tv.md, Focus).
    @discardableResult
    func playSeason(maxSteps: Int = 70) -> Bool {
        press(.select, gap: 5)
        for _ in 0..<maxSteps {
            if app.buttons["Build another roster"].exists { return true }
            press(.select, gap: 1.7)
        }
        return app.buttons["Build another roster"].exists
    }

    // MARK: tests

    func test01_ColdLaunch() {
        for i in 0..<5 {
            app.terminate()
            Thread.sleep(forTimeInterval: 1.5)
            let t0 = Date()
            app.launch()
            // Usable: the remote is on Play.
            let play = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true AND label BEGINSWITH 'Play'")).firstMatch
            _ = play.waitForExistence(timeout: 20)
            report("launch_to_play_focused_s_\(i)", String(format: "%.2f", Date().timeIntervalSince(t0)))
        }
    }

    /// Left and right along the front page's lens shelf: eight moves a pass.
    func test02_HomeFocusMoves() {
        launchHome()
        press(.down, gap: 1)
        mark("home_focus", moves: 40) { for _ in 0..<5 {
            press(.right, 2)
            press(.left, 2)
            press(.right, 2)
            press(.left, 2)
        } }
    }

    /// Down and up the play screen's player list after a spin: sixteen moves a pass.
    func test03_PlayListFocusMoves() {
        launchHome()
        press(.select, gap: 7)
        mark("play_list_focus", moves: 80) { for _ in 0..<5 {
            press(.down, 8, gap: 0.35)
            press(.up, 8, gap: 0.35)
        } }
    }

    /// One spin, from Select on Spin to the list being ready. Picks the first
    /// player, places it, and measures the next spin landing.
    func test04_Spin() {
        launchHome()
        press(.select, gap: 7)
        press(.select, gap: 1.5)
        if !focusedLabel.lowercased().contains("spin") { press(.select, gap: 1.5) }
        report("spin_button_label", focusedLabel)
        mark("spin") { press(.select, gap: 6) }
    }

    /// A whole season, then how long the result screen holds the remote on
    /// its first page: Right is pressed every half second until focus leaves
    /// Build Another for something on the roster's page.
    func test05_SeasonAndResult() {
        launchHome()
        var ok = false
        mark("season") { ok = playSeason() }
        XCTAssertTrue(ok, "never reached the result screen")
        let start = Date()
        var crossed = -1.0
        var moves: [String] = []
        while Date().timeIntervalSince(start) < 14 {
            remote.press(.right)
            Thread.sleep(forTimeInterval: 0.25)
            let label = focusedLabel
            moves.append(String(format: "%.1f:%@", Date().timeIntervalSince(start), label))
            if !label.isEmpty && !label.hasPrefix("Build another") {
                crossed = Date().timeIntervalSince(start)
                break
            }
        }
        report("result_cross_s", String(format: "%.1f", crossed))
        report("result_cross_trail", moves.joined(separator: " | "))
        press(.left, 2)
        report("result_after_left", focusedLabel)
        // Down the roster page and back: focus moves on the result screen.
        press(.right, gap: 0.6)
        mark("result_focus", moves: 36) { for _ in 0..<3 {
            press(.down, 6, gap: 0.35)
            press(.up, 6, gap: 0.35)
        } }
    }

    /// Three rounds of Gut Check, played with Select (skip, records nothing).
    func test06_GutCheck() {
        launchHome()
        press(.down, gap: 0.8)
        press(.down, gap: 0.8)
        let label = focusedLabel
        report("gutcheck_tile", label)
        XCTAssertTrue(label.contains("Gut Check"), "focus is on \(label)")
        press(.select, gap: 3)
        mark("gutcheck_3_rounds", moves: 30) {
            for round in 0..<3 {
                press(.select, 10, gap: 1.2)
                Thread.sleep(forTimeInterval: 1.5)
                if round < 2 { press(.select, gap: 2.5) } // "Another ten" holds the focus
            }
        }
    }

    /// Up to the tab bar, along to Leaderboards, into the list, and down it.
    func test07_LeaderboardFocusMoves() {
        launchHome()
        // The bar is Games, Leaderboards, Play, Challenges, My Stats.
        press(.up, 3, gap: 0.6)  // onto the bar: the tab it was last on, Games at launch
        XCTAssertTrue(seek("Leaderboards", .right, max: 5), "never reached Leaderboards: \(focusedLabel)")
        press(.select, gap: 5)
        press(.down, gap: 0.8)
        report("leaderboard_entry", focusedLabel)
        mark("leaderboard_focus", moves: 48) { for _ in 0..<3 {
            press(.down, 8, gap: 0.35)
            press(.up, 8, gap: 0.35)
        } }
    }

    /// Tab to tab along the bar: Play, Leaderboards, Games and back.
    func test08_TabSwitches() {
        launchHome()
        press(.up, 3, gap: 0.6)
        report("tab_start", focusedLabel)
        mark("tab_switches", moves: 12) { for _ in 0..<3 {
            press(.left, gap: 0.3); press(.select, gap: 1.6)
            press(.left, gap: 0.3); press(.select, gap: 1.6)
            press(.right, gap: 0.3); press(.select, gap: 1.6)
            press(.right, gap: 0.3); press(.select, gap: 1.6)
        } }
    }

    /// The tab bar, one tab at a time. Build 27's moved as one block: its focus
    /// guide sent every left and right back to the tab you were on. Each step
    /// asserts the focused tab and saves the screen (TAB_SHOTS) to look at.
    func test11_TabBar() {
        launchHome()
        let shots = ProcessInfo.processInfo.environment["TAB_SHOTS"] ?? "/tmp/17-0-tv-tabs"
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        func shot(_ name: String) {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/\(name).png"))
        }
        func focusedTab() -> String {
            let el = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
            return el.exists ? (el.label.isEmpty ? el.identifier : el.label) : ""
        }
        let tabs = ["Games", "Leaderboards", "Play", "Challenges", "My Stats"]
        report("tabbar_start", focusedTab())
        press(.up, 3, gap: 0.7)
        shot("1-up-to-bar"); report("tabbar_up", focusedTab())
        XCTAssertTrue(tabs.contains(focusedTab()), "up from the page should land on a tab, not \(focusedTab())")
        // Every tab, one press at a time: the bar must not move as one block.
        press(.left, 4, gap: 0.5)
        XCTAssertEqual(focusedTab(), "Games")
        for name in tabs.dropFirst() {
            press(.right, gap: 0.6)
            XCTAssertEqual(focusedTab(), name)
        }
        shot("2-my-stats-focused")
        press(.left, 4, gap: 0.5)
        XCTAssertEqual(focusedTab(), "Games")
        press(.select, gap: 3)
        shot("3-games"); report("tabbar_select", focusedTab())
        press(.up, 3, gap: 0.7)
        XCTAssertEqual(focusedTab(), "Games", "up from Games should land on Games")
        press(.right, 4, gap: 0.7)
        shot("4-my-stats"); report("tabbar_right4", focusedTab())
        XCTAssertEqual(focusedTab(), "My Stats")
        press(.select, gap: 3)
        shot("5-stats")
    }

    /// What the harness costs on its own: the app idle, and Up pressed on the
    /// front page's top row, which moves nothing. Subtract these from a block
    /// to get what a move costs the app.
    func test00_Controls() {
        launchHome()
        mark("idle_20s") { Thread.sleep(forTimeInterval: 20) }
        mark("noop_press", moves: 40) { press(.up, 40, gap: 0.45) }
    }

    /// Broadcast mode: the HUD over the play screen, a season under it, the
    /// record as a graphic. Then broadcast mode off again.
    func test09_Broadcast() {
        launchHome()
        toggleTVSetting("Broadcast mode")
        press(.select, gap: 7)
        var labels: [String] = [focusedLabel]
        for _ in 0..<3 {
            press(.down, gap: 0.6)
            labels.append(focusedLabel)
        }
        report("broadcast_list_moves", labels.joined(separator: " | "))
        report("broadcast_list_moved", Set(labels).count - 1)
        mark("broadcast_list_focus", moves: 32) { for _ in 0..<2 {
            press(.down, 8, gap: 0.35)
            press(.up, 8, gap: 0.35)
        } }
        launchHome()
        var ok = false
        mark("broadcast_season") { ok = playSeason(maxSteps: 90) }
        XCTAssertTrue(ok, "never reached the result screen")
        launchHome()
        toggleTVSetting("Broadcast mode")
    }

    /// Not a measurement: a season with the focused control printed at every
    /// step, for when a season stops reaching the result.
    func test10_TraceSeason() {
        for season in 0..<4 {
            launchHome()
            press(.select, gap: 5)
            var done = false
            for i in 0..<30 {
                if app.buttons["Build another roster"].exists { report("trace_\(season)", "result at step \(i)"); done = true; break }
                report("trace_\(season)_\(i)", focusedLabel)
                press(.select, gap: 1.7)
            }
            if !done {
                let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.lifetime = .keepAlways; add(a)
                print(app.debugDescription.prefix(6000))
                return
            }
        }
    }
}
