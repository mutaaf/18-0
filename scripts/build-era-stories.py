#!/usr/bin/env python3
"""
Generate one true sentence about every franchise-era, from game results.

    curl -sL -o /tmp/games.csv \
      https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
    python3 scripts/build-era-stories.py /tmp/games.csv

Writes packages/data/src/franchise-era-records.ts.

This exists because the obvious approach does not work. Asking a model to
summarise a team's Wikipedia season list returns prose that looks right and is
not: the first one tried put Buffalo in the playoffs in 2015 and 2016, when
their drought actually ran from 2000 to 2016. At that error rate, generating a
hundred and fifty lines of football history would mean shipping a game full of
confident falsehoods to an audience that would notice immediately.

Every line here is instead computed from nflverse's game-by-game results, the
same source packages/data already builds the card dataset from. Records are
counted, not recalled. Nothing is phrased that the numbers do not say.

No line names a player, for the same reason the hand-written table in eras.ts
does not: the leaderboard ranks Player IQ seasons, and naming the pool's best
players would hand over the answer.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / 'packages' / 'data' / 'generated' / 'dataset.json'
OUT = ROOT / 'packages' / 'data' / 'src' / 'franchise-era-records.ts'

ERAS = [('1999_2004', 1999, 2004), ('2005_2009', 2005, 2009), ('2010_2014', 2010, 2014),
        ('2015_2019', 2015, 2019), ('2020_2025', 2020, 2025)]

# nflverse uses the code a team played under at the time; the card dataset uses
# the current franchise. Relocations are folded forward so a franchise-era is
# one continuous history.
RELOCATED = {'LA': 'lar', 'STL': 'lar', 'OAK': 'lv', 'SD': 'lac'}

COUNT = {1: 'once', 2: 'twice', 3: 'three times', 4: 'four times', 5: 'five times', 6: 'six times'}
SPELLED = {3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six'}


def roman(n: int) -> str:
    out, table = '', [(1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'),
                      (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    for value, letters in table:
        while n >= value:
            out += letters
            n -= value
    return out


def era_of(year: int) -> str | None:
    for key, first, last in ERAS:
        if first <= year <= last:
            return key
    return None


def record(w: int, l: int, t: int) -> str:
    return f'{w}-{l}' + (f'-{t}' if t else '')


def sentence(seasons: list) -> str:
    """One line, in descending order of what a fan would lead with."""
    won = [s for s in seasons if s['sb_won']]
    lost = [s for s in seasons if 'SB' in s['post'] and not s['sb_won']]
    title_game = [s for s in seasons if 'CON' in s['post']]
    january = [s for s in seasons if s['post']]
    best = max(seasons, key=lambda s: (s['w'] - s['l'], s['w']))
    worst = min(seasons, key=lambda s: (s['w'] - s['l'], s['w']))

    # Super Bowl numbering: the first was played after the 1966 season.
    if won:
        titles = ' and Super Bowl '.join(roman(s['year'] - 1965) for s in won)
        return f'Won Super Bowl {titles}.'
    if lost:
        s = lost[0]
        if s['l'] == 0:
            return f"Went {record(s['w'], s['l'], s['t'])}, then lost Super Bowl {roman(s['year'] - 1965)}."
        return f"Reached Super Bowl {roman(s['year'] - 1965)} and lost it."
    if worst['w'] == 0:
        return f"Went winless in {worst['year']}."
    if title_game:
        s = title_game[0]
        return f"One game from the Super Bowl in {s['year']}, at {record(s['w'], s['l'], s['t'])}."
    if january:
        made = COUNT.get(len(january), f'{len(january)} times')
        return f"Made January {made}, best at {record(best['w'], best['l'], best['t'])} in {best['year']}."
    count = SPELLED.get(len(seasons), str(len(seasons)))
    return (f"{count} seasons, no January. Best was "
            f"{record(best['w'], best['l'], best['t'])} in {best['year']}.")


def main(games_csv: str) -> None:
    rows = [r for r in csv.DictReader(open(games_csv)) if 1999 <= int(r['season']) <= 2025]

    tally: dict = defaultdict(lambda: {'w': 0, 'l': 0, 't': 0, 'post': set(), 'sb_won': False})
    for row in rows:
        year, kind = int(row['season']), row['game_type']
        if row['home_score'] == '' or row['away_score'] == '':
            continue  # unplayed
        home, away = int(row['home_score']), int(row['away_score'])
        for code, mine, theirs in ((row['home_team'], home, away), (row['away_team'], away, home)):
            team = RELOCATED.get(code, code.lower())
            entry = tally[(team, year)]
            if kind == 'REG':
                if mine > theirs:
                    entry['w'] += 1
                elif mine < theirs:
                    entry['l'] += 1
                else:
                    entry['t'] += 1
            else:
                entry['post'].add(kind)
                if kind == 'SB' and mine > theirs:
                    entry['sb_won'] = True

    by_era: dict = defaultdict(list)
    for (team, year), entry in tally.items():
        era = era_of(year)
        if era:
            by_era[(team, era)].append({'year': year, **entry})

    # Only franchise-eras a spin can actually land on.
    cards = json.load(open(DATASET))['cards']
    spinnable = {(c['franchiseId'], c['era']) for c in cards}

    lines = {}
    for key, seasons in sorted(by_era.items()):
        if key not in spinnable:
            continue
        lines[f'{key[0]}:{key[1]}'] = sentence(sorted(seasons, key=lambda s: s['year']))

    body = '\n'.join(f"  '{k}': {json.dumps(v)}," for k, v in sorted(lines.items()))
    OUT.write_text(f'''/**
 * One true sentence per franchise-era, computed from game results.
 *
 * GENERATED by scripts/build-era-stories.py from nflverse's game-by-game
 * results -- the same source packages/data builds the card dataset from. Do
 * not edit by hand: rerun the script.
 *
 * Records here are counted, not recalled. The alternative, asking a model to
 * summarise each team's season list, produced prose that read correctly and
 * was not: it placed Buffalo in the playoffs in 2015 and 2016, when the drought
 * actually ran 2000 to 2016.
 *
 * eras.ts holds the hand-written table, which wins where it has an entry: "The
 * Legion of Boom" beats a record. This is the floor, so every franchise-era has
 * something true to say.
 *
 * {len(lines)} franchise-eras.
 */
export const FRANCHISE_ERA_RECORD: Readonly<Record<string, string>> = {{
{body}
}};
''')
    print(f'{OUT.relative_to(ROOT)}  {len(lines)} franchise-eras')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/games.csv')
