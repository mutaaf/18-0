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
        // Broadcast mode is the default: the record is a full-screen graphic
        // that holds until Select, over the page this test measures.
        Thread.sleep(forTimeInterval: 3)
        if focusedLabel.hasPrefix("Final record") { press(.select, gap: 1.5) }
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

    /// Broadcast mode: the HUD and the stadium lights over the play screen, a
    /// season under it, the record as a graphic. Broadcast mode is the TV's
    /// default (it used to be switched on here and off again at the end), so
    /// this measures what a fresh install shows; a simulator where somebody
    /// switched it off in Account measures without the HUD.
    func test09_Broadcast() {
        launchHome()
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


    // MARK: the list-and-detail tabs (docs/apple-tv.md, "Navigation")

    /// From the front page to a tab, by the bar.
    func openTab(_ tab: String) {
        launchHome()
        press(.up, 3, gap: 0.6)
        XCTAssertTrue(seek(tab, .right, max: 6), "never reached \(tab): \(focusedLabel)")
        press(.select, gap: 4)
    }

    /// Presses `button` `times` times and returns the focused label after each.
    func walk(_ button: XCUIRemote.Button, _ times: Int, gap: TimeInterval = 0.6) -> [String] {
        var labels: [String] = []
        for _ in 0..<times {
            press(button, gap: gap)
            labels.append(focusedLabel)
        }
        return labels
    }

    /// Every press in `labels` landed somewhere new.
    func assertMoved(_ labels: [String], from start: String, _ what: String) {
        var last = start
        for (i, label) in labels.enumerated() {
            XCTAssertNotEqual(label, last, "\(what): press \(i + 1) did not move focus (\(label))")
            XCTAssertFalse(label.isEmpty, "\(what): press \(i + 1) lost focus")
            last = label
        }
    }

    func viewShot(_ name: String) {
        let dir = ProcessInfo.processInfo.environment["VIEW_SHOTS"] ?? "/tmp/17-0-tv-views"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    /// Up from wherever the remote is until it is on the tab bar's `tab`.
    func backToBar(_ tab: String, _ what: String) {
        for _ in 0..<60 {
            if focusedLabel == tab { break }
            press(.up, gap: 0.35)
        }
        XCTAssertEqual(focusedLabel, tab, "\(what): up never reached the tab bar")
    }

    /// My Stats: down through every section and every season to the end of
    /// the log, Select into a season's roster, Menu back to the season, up
    /// to the bar.
    func test12_StatsNav() {
        openTab("My Stats")
        press(.down, gap: 0.8)
        let first = focusedLabel
        report("stats_first", first)
        XCTAssertTrue(first.hasPrefix("Overview"), "down from the bar should land on Overview, not \(first)")
        viewShot("stats-overview")
        let sections = walk(.down, 6)
        assertMoved(sections, from: first, "stats sections")
        report("stats_sections", sections.map { String($0.prefix(24)) }.joined(separator: " | "))
        XCTAssertTrue(sections.last?.hasPrefix("Tendencies") == true, "the seventh section should be Tendencies: \(sections.last ?? "")")
        press(.up, 5, gap: 0.5)
        viewShot("stats-form")
        press(.down, 5, gap: 0.5)
        // Into the log, and to its end: focus stops moving only at the last season.
        var seasons: [String] = []
        var last = focusedLabel
        for _ in 0..<600 {
            press(.down, gap: 0.3)
            let label = focusedLabel
            if label == last { break }
            seasons.append(label)
            last = label
        }
        report("stats_seasons_walked", seasons.count)
        report("stats_last_season", last)
        XCTAssertGreaterThan(seasons.count, 0, "no season in the log was reachable")
        XCTAssertTrue(last.hasPrefix("Season \(seasons.count)"), "the walk stopped short of the end: \(last)")
        press(.up, 3, gap: 0.5)
        let season = focusedLabel
        viewShot("stats-season")
        press(.select, gap: 1.5)
        let pick = focusedLabel
        report("stats_select_into", pick)
        XCTAssertTrue(pick.hasSuffix("Select for the card."), "Select on a season should go into its roster, not \(pick)")
        let roster = walk(.down, 3, gap: 0.5)
        assertMoved(roster, from: pick, "stats roster")
        viewShot("stats-season-roster")
        press(.menu, gap: 1.5)
        XCTAssertEqual(focusedLabel, season, "Menu from the roster should come back to the season")
        mark("stats_focus", moves: 32) { for _ in 0..<2 {
            press(.up, 8, gap: 0.35)
            press(.down, 8, gap: 0.35)
        } }
        backToBar("My Stats", "stats")
    }

    /// Challenges: left and right along the filters, down into the list, the
    /// scored seasons, back up to the bar.
    func test13_ChallengesNav() {
        openTab("Challenges")
        press(.down, gap: 0.8)
        let chip = focusedLabel
        report("challenges_first", chip)
        XCTAssertTrue(chip.hasPrefix("Show: All"), "down from the bar should land on the filters, not \(chip)")
        let rights = walk(.right, 4)
        assertMoved(rights, from: chip, "challenge filters")
        report("challenges_filters", rights.joined(separator: " | "))
        XCTAssertTrue(rights.last?.hasPrefix("Show: Seasons") == true, "the last filter: \(rights.last ?? "")")
        press(.select, gap: 1.5)
        press(.down, gap: 0.8)
        let firstSeason = focusedLabel
        report("challenges_season", firstSeason)
        viewShot("challenges-season")
        let seasons = walk(.down, 2, gap: 0.5)
        report("challenges_seasons", seasons.joined(separator: " | "))
        XCTAssertTrue(seek("Show:", .up, max: 6), "up from the seasons should reach the filters: \(focusedLabel)")
        XCTAssertTrue(seek("Show: All", .left, max: 6), "never got back to All: \(focusedLabel)")
        press(.select, gap: 1.5)
        press(.down, gap: 0.8)
        let pitch = focusedLabel
        XCTAssertTrue(pitch.hasPrefix("Put one up"), "the first row of All: \(pitch)")
        viewShot("challenges-pitch")
        let rows = walk(.down, 3, gap: 0.5)
        assertMoved(rows, from: pitch, "challenge rows")
        report("challenges_rows", rows.map { String($0.prefix(40)) }.joined(separator: " | "))
        viewShot("challenges-row")
        press(.right, gap: 0.8)
        report("challenges_right_into_panel", focusedLabel)
        press(.left, gap: 0.8)
        mark("challenges_focus", moves: 16) { for _ in 0..<2 {
            press(.up, 3, gap: 0.35); press(.down, 3, gap: 0.35)
            press(.right, gap: 0.35); press(.left, gap: 0.35)
        } }
        backToBar("Challenges", "challenges")
    }

    /// Leaderboards: along the boards, Select one, down to the periods and
    /// along them, into the field and down it, Select into an entry's roster,
    /// Menu back, up to the bar.
    func test14_LeaderboardNav() {
        openTab("Leaderboards")
        press(.down, gap: 0.8)
        let board = focusedLabel
        report("leaderboard_first", board)
        XCTAssertTrue(board.hasPrefix("Board: GM Mode"), "down from the bar should land on the boards, not \(board)")
        let boards = walk(.right, 2)
        assertMoved(boards, from: board, "boards")
        report("leaderboard_boards", boards.joined(separator: " | "))
        viewShot("leaderboard-points-chip")
        press(.left, 2, gap: 0.5)
        press(.down, gap: 0.8)
        let period = focusedLabel
        XCTAssertTrue(period.hasPrefix("Period:"), "below the boards are the periods: \(period)")
        let periods = walk(.right, 2)
        assertMoved(periods, from: period, "periods")
        press(.left, 2, gap: 0.5)
        press(.down, gap: 1.0)
        let top = focusedLabel
        report("leaderboard_list_first", top)
        XCTAssertTrue(top.hasPrefix("Rank") || top.hasPrefix("Your place"), "down from the periods should reach the field: \(top)")
        viewShot("leaderboard-entry")
        let field = walk(.down, 3, gap: 0.6)
        report("leaderboard_field", field.map { String($0.prefix(30)) }.joined(separator: " | "))
        assertMoved(Array(field.prefix(while: { $0.hasPrefix("Rank") })), from: top, "the field")
        Thread.sleep(forTimeInterval: 1.5) // the roster arrives once the remote rests
        let entry = focusedLabel
        viewShot("leaderboard-entry-roster")
        press(.select, gap: 1.5)
        let pick = focusedLabel
        report("leaderboard_select_into", pick)
        XCTAssertTrue(pick.hasPrefix("QB."), "Select on an entry should go into its roster, not \(pick)")
        press(.menu, gap: 1.5)
        XCTAssertEqual(focusedLabel, entry, "Menu from the roster should come back to the entry")
        mark("leaderboard_nav_focus", moves: 12) { for _ in 0..<2 {
            press(.up, 3, gap: 0.35); press(.down, 3, gap: 0.35)
        } }
        XCTAssertTrue(seek("Board:", .up, max: 8), "up from the field should reach the boards: \(focusedLabel)")
        report("leaderboard_up", focusedLabel)
        // Points: a different list, the same walk.
        XCTAssertTrue(seek("Board: Points", .right, max: 4), "never reached Points: \(focusedLabel)")
        press(.select, gap: 3)
        press(.down, 2, gap: 0.8)
        report("leaderboard_points_first", focusedLabel)
        viewShot("leaderboard-points")
        backToBar("Leaderboards", "leaderboard")
    }

    /// Not a measurement: on each of Leaderboards, Challenges and My Stats,
    /// what the remote lands on as it presses into the page, printed per
    /// press, with a screenshot (VIEW_SHOTS). How "the page is not navigable"
    /// was diagnosed, and how to diagnose it again.
    func test15_DiagnoseTabs() {
        let shots = ProcessInfo.processInfo.environment["VIEW_SHOTS"] ?? "/tmp/17-0-tv-views"
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        for tab in ["Leaderboards", "Challenges", "My Stats"] {
            launchHome()
            press(.up, 3, gap: 0.6)
            XCTAssertTrue(seek(tab, .right, max: 6), "never reached \(tab): \(focusedLabel)")
            press(.select, gap: 4)
            var trail: [String] = []
            for button in [XCUIRemote.Button.down, .down, .down, .down, .down, .down, .right, .right, .left, .left, .up, .up] {
                press(button, gap: 0.7)
                trail.append("\(button.rawValue):\(focusedLabel.prefix(60))")
            }
            report("diagnose_\(tab.replacingOccurrences(of: " ", with: "_"))", trail.joined(separator: " | "))
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/diagnose-\(tab.replacingOccurrences(of: " ", with: "-")).png"))
        }
    }
    // MARK: the reveal (docs/apple-tv.md, "The fifth pass")

    /// The press on Reveal, three seasons over: from the front page, Select
    /// until the remote is on "Reveal your result", then one measured Select
    /// and five seconds of the record building. Nothing queries the app inside
    /// the block. `PERF reveal_ready` is printed six seconds before the press,
    /// for `PROFILE_AT=reveal_ready` in js-probe.sh to start Time Profiler on.
    /// Screenshots of the held record and of the page under it (VIEW_SHOTS)
    /// are how a change to the reveal is checked for looking the same.
    func test16_Reveal() {
        for season in 0..<3 {
            launchHome()
            press(.select, gap: 5)
            var ready = false
            for _ in 0..<70 {
                let label = focusedLabel
                if label.hasPrefix("Reveal") { ready = true; break }
                // A season the remote was handed the "All" filter in, where
                // Select does nothing: down onto the list.
                press(label.hasPrefix("Filter") ? .down : .select, gap: 1.7)
            }
            XCTAssertTrue(ready, "never reached Reveal: \(focusedLabel)")
            if !ready { return }
            report("reveal_ready", season)
            Thread.sleep(forTimeInterval: 6)
            mark("reveal", moves: 1) { press(.select, gap: 5) }
            let up = focusedLabel
            report("reveal_focused_\(season)", up)
            if season == 0 { viewShot("reveal-record") }
            if up.hasPrefix("Final record") { press(.select, gap: 3) }
            if season == 0 { viewShot("reveal-page") }
            XCTAssertTrue(app.buttons["Build another roster"].exists, "the result page is not under the record")
        }
    }
    // MARK: usability (docs/apple-tv.md, "Usability")

    /// Not a measurement of time: the core journeys, walked with the remote,
    /// with every press and where it landed printed (`PERF journey_*`). The
    /// press counts and dead ends in the usability tables come from here.
    /// A dead end is a press after which the remote is on nothing, or on the
    /// same control with nothing changed on screen.
    func test17_Journeys() {
        let shots = ProcessInfo.processInfo.environment["VIEW_SHOTS"] ?? "/tmp/17-0-tv-views"
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        func shot(_ name: String) {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/journey-\(name).png"))
        }
        var presses = 0
        var trail: [String] = []
        func step(_ button: XCUIRemote.Button, gap: TimeInterval = 1.2) {
            press(button, gap: gap)
            presses += 1
            trail.append("\(button.rawValue):\(focusedLabel.prefix(48))")
        }
        func done(_ name: String) {
            report("journey_\(name)_presses", presses)
            report("journey_\(name)_trail", trail.joined(separator: " | "))
            presses = 0
            trail = []
        }

        // Casual throughout: every other test plays Rookie, which never ranks,
        // but these journeys play whatever Play starts and switch lenses, and a
        // ranked season here would be a real row on a real board. Not counted.
        func casual() {
            press(.right, gap: 0.6)
            let ranked = app.switches.matching(NSPredicate(format: "label == 'Play for the leaderboard'")).firstMatch
            if ranked.exists, ranked.hasFocus, (ranked.value as? String) == "1" { press(.select, gap: 1) }
            press(.left, gap: 0.6)
        }
        defer {
            // Leave Play on Rookie, which the rest of the harness assumes: the
            // lens last started is what Play starts (state/next-season.ts).
            launchHome()
            casual()
            press(.down, gap: 0.8)
            _ = seek("Play Rookie", .right, max: 4)
            press(.select, gap: 4)
            press(.menu, gap: 2)
            report("journey_left_play_on", focusedLabel)
        }

        // 1. Launch to the first spin: where the remote starts, and Select.
        launchHome()
        casual()
        report("journey_launch_focus", focusedLabel)
        shot("1-home")
        step(.select, gap: 5)
        shot("1-first-spin")
        done("first_spin")

        // 2. A whole season, Select only, to the result page.
        var reached = false
        for _ in 0..<70 {
            if app.buttons["Build another roster"].exists { reached = true; break }
            let label = focusedLabel
            step(label.hasPrefix("Filter") ? .down : .select, gap: 1.7)
        }
        report("journey_season_reached_result", reached)
        shot("2-result")
        done("season")

        // 3. The result to the next season's first spin.
        Thread.sleep(forTimeInterval: 2)
        report("journey_result_focus", focusedLabel)
        for _ in 0..<4 {
            let label = focusedLabel
            // On the new spin's list: a player row ("Hold Select for details").
            if label.contains("Hold Select") || label.hasPrefix("Filter") { break }
            step(.select, gap: 4)
        }
        shot("3-next-season")
        done("next_season")

        // 4. Menu out of a season in progress, then where Menu goes from the front page's tabs.
        step(.menu, gap: 2)
        report("journey_menu_from_play", focusedLabel)
        shot("4-menu-from-play")
        done("menu_from_play")

        // 5. Switching mode: from the front page to a different lens, started.
        launchHome()
        casual()
        for _ in 0..<6 {
            if focusedLabel.hasPrefix("Play GM") || focusedLabel.hasPrefix("Play · GM") || focusedLabel.hasPrefix("Play a GM") { break }
            step(focusedLabel.hasPrefix("Play") && trail.isEmpty ? .down : .right, gap: 0.8)
        }
        step(.select, gap: 5)
        shot("5-mode-switched")
        done("switch_mode")
        // What Play says now: the lens just started (state/next-season.ts).
        launchHome()
        casual()
        report("journey_home_play_after_switch", focusedLabel)
        XCTAssertTrue(focusedLabel.hasPrefix("Play GM Mode"), "Play should start the lens last started: \(focusedLabel)")

        // 6. Finding My Stats, Challenges and Leaderboards from the front page.
        for tab in ["My Stats", "Challenges", "Leaderboards"] {
            launchHome()
            casual()
            for _ in 0..<4 {
                if ["Games", "Leaderboards", "Play", "Challenges", "My Stats"].contains(focusedLabel) { break }
                step(.up, gap: 0.6)
            }
            for _ in 0..<6 {
                if focusedLabel == tab { break }
                step(.right, gap: 0.6)
            }
            step(.select, gap: 3)
            step(.down, gap: 1)
            shot("6-\(tab.replacingOccurrences(of: " ", with: "-"))")
            done("find_\(tab.replacingOccurrences(of: " ", with: "_"))")
            step(.menu, gap: 2)
            report("journey_menu_from_\(tab.replacingOccurrences(of: " ", with: "_"))", focusedLabel)
            done("menu_\(tab.replacingOccurrences(of: " ", with: "_"))")
        }
    }
}
