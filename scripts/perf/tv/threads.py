"""Milliseconds per thread in a Time Profiler export, and the JS thread's
heaviest frames.

    python3 threads.py profile.xml            # the export js-probe.sh writes
    THREAD='Main Thread' python3 threads.py profile.xml

The simulator's Hermes frames are the interpreter's own, not the app's
functions, but what calls them is named: an event dispatched to JS, a state
update, a commit, a Yoga layout. That is how the fourth pass found that a
scroll view's state updates were a quarter of the JS thread's work per press
(docs/apple-tv.md).
"""
import os
import sys
import xml.etree.ElementTree as ET
from collections import Counter

want = os.environ.get('THREAD', 'JavaScript')
root = ET.parse(sys.argv[1]).getroot()
ids = {el.get('id'): el for el in root.iter() if el.get('id') is not None}


def deref(el):
    ref = el.get('ref')
    return ids.get(ref, el) if ref is not None else el


per_thread = Counter()
inclusive = Counter()
for row in root.iter('row'):
    thread = weight = backtrace = None
    for cell in row:
        cell = deref(cell)
        if cell.tag == 'thread':
            thread = cell.get('fmt')
        elif cell.tag == 'weight':
            weight = int(cell.text or 0)
        elif cell.tag in ('backtrace', 'tagged-backtrace'):
            backtrace = cell
    if thread is None or weight is None:
        continue
    per_thread[thread] += weight
    if backtrace is not None and want in thread:
        for name in {deref(f).get('name') for f in backtrace.findall('frame')}:
            inclusive[name] += weight

print('  ms per thread:')
for thread, w in per_thread.most_common(6):
    print(f'  {w / 1e6:9.0f}  {thread}')
print(f'\n  {want}, inclusive ms (frames that name React Native work):')
keep = ('react::', 'yoga::', 'reanimated::', 'RCT', 'Hermes', 'hermes::vm::Runtime::interpretFunctionImpl')
for name, w in inclusive.most_common(400):
    if name and any(k in name for k in keep):
        print(f'  {w / 1e6:9.0f}  {name[:140]}')
