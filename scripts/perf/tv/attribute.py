"""Charges each marked block of a harness run with the app's CPU and memory.

    python3 attribute.py run.log samples.txt

`run.log` holds the tests' "PERF begin|end <name> <epoch> [moves]" lines,
`samples.txt` the sampler's "<epoch> <pid> <cpu time> <rss kb>" lines.
"""
import re, sys

def cpu_seconds(t):
    # ps TIME: [[dd-]hh:]mm:ss.cc
    days = 0
    if '-' in t:
        d, t = t.split('-', 1)
        days = int(d)
    parts = [float(p) for p in t.split(':')]
    s = 0.0
    for p in parts:
        s = s * 60 + p
    return s + days * 86400

samples = []
for line in open(sys.argv[2]):
    f = line.split()
    if len(f) == 4:
        samples.append((float(f[0]), f[1], cpu_seconds(f[2]), int(f[3])))

def at(epoch, pid=None):
    best = None
    for s in samples:
        if pid and s[1] != pid:
            continue
        if s[0] <= epoch:
            best = s
        else:
            break
    return best

begins = {}
rows = []
for line in open(sys.argv[1]):
    m = re.search(r'PERF begin (\S+) ([\d.]+) (\d+)', line)
    if m:
        begins[m.group(1)] = (float(m.group(2)), int(m.group(3)))
        continue
    m = re.search(r'PERF end (\S+) ([\d.]+)', line)
    if m and m.group(1) in begins:
        t0, moves = begins.pop(m.group(1))
        t1 = float(m.group(2))
        a, b = at(t0), at(t1)
        if not a or not b or a[1] != b[1]:
            rows.append((m.group(1), 'no samples', '', '', ''))
            continue
        cpu = b[2] - a[2]
        peak = max(s[3] for s in samples if t0 <= s[0] <= t1 and s[1] == a[1]) / 1024
        per = f'{cpu * 1000 / moves:.1f} ms/move' if moves else ''
        rows.append((m.group(1), f'{t1 - t0:.1f} s', f'cpu {cpu:.2f} s ({cpu / (t1 - t0) * 100:.0f}%)', per, f'rss {a[3] / 1024:.0f}->{b[3] / 1024:.0f} MB, peak {peak:.0f}'))

for r in rows:
    print('  ' + '  '.join(x for x in r if x))
