#!/usr/bin/env python3
"""
Analytics taxonomy — the adapter and the callers must agree.

    python3 tests/analytics.test.py

`trackEvent(name, props)` translates a product event into a GoatCounter path
through the `describe()` switch in js/analytics.js. A name with no explicit
case does not fail — it falls through to `default`, which hyphenates the name
and drops every property. That is silent, and it is exactly how the walk events
spent a release reporting as four undifferentiated paths with no slug.

So this suite reads both sides of that contract out of the source and asserts
they match:

  * every name any module passes to `trackEvent()` has a case of its own;
  * every case is reachable — no dead branch for an event nobody fires;
  * the properties a case interpolates are properties its callers actually
    pass, so a path can never contain the string "undefined";
  * no path carries a plaque id, a coordinate or anything else that could
    identify a person or a place a visitor stood in.

Dependency-free: standard library only, and it parses the source as text
rather than running it, so it needs no JavaScript engine.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, "js")
ADAPTER = os.path.join(JS, "analytics.js")

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


def sources():
    for entry in sorted(os.listdir(JS)):
        if entry.endswith(".js"):
            with open(os.path.join(JS, entry), encoding="utf-8") as fh:
                yield entry, fh.read()


adapter = open(ADAPTER, encoding="utf-8").read()

# The body of describe(), so a `case` in some later function cannot be mistaken
# for a branch of the taxonomy.
body = adapter.split("function describe(", 1)[1].split("\n}\n", 1)[0]

cases = set(re.findall(r"case '([a-z_]+)':", body))

# Every call site, as (event name, the properties object it passes).
calls = []
for filename, text in sources():
    if filename == "analytics.js":
        continue
    for match in re.finditer(r"trackEvent\('([a-z_]+)'(?:,\s*(\{[^{}]*\}))?\s*\)", text):
        calls.append((filename, match.group(1), match.group(2) or ""))

fired = {name for _, name, _ in calls}

print("\ncoverage")
check("some events were found to check at all", len(fired) >= 20, f"{len(fired)} found")

missing = sorted(fired - cases)
check("every event fired has an explicit case in describe()", not missing,
      f"falling through to default: {missing}")

# `page_view` is fired by initAnalytics inside the adapter itself, so it is
# never seen at a call site; everything else must be reachable.
unreachable = sorted(cases - fired - {"page_view"})
check("no case exists for an event nothing fires", not unreachable,
      f"dead branches: {unreachable}")

print("\nproperties")
# Each case's template placeholders, e.g. `${props.walk}` → {"walk"}.
needed = {}
for case, arm in re.findall(r"case '([a-z_]+)':((?:(?!\n    case ).)*)", body, re.S):
    needed[case] = set(re.findall(r"\$\{props\.([a-zA-Z]+)\}", arm))

gaps = []
for filename, name, props in calls:
    for key in needed.get(name, ()):
        # `{ walk: slug }` and the `{ kind }` shorthand both count.
        if not re.search(rf"\b{key}\s*[:,}}]", props):
            gaps.append(f"{filename}: {name} needs `{key}`")
check("every property a path interpolates is passed by its callers", not gaps,
      "; ".join(sorted(set(gaps))))

print("\nprivacy")
# The paths are public strings on a public dashboard. Nothing derived from a
# visitor may appear in one; `plaque.id`, coordinates and free text all would.
banned = re.findall(r"\$\{props\.(id|lat|lng|latitude|longitude|address|title|"
                    r"query|text|name|slug)\}", body)
check("no path interpolates an identifier, a coordinate or free text",
      not banned, f"found: {sorted(set(banned))}")

# Cross-check the call sites: a property named for a coordinate must never be
# passed, whether or not today's adapter happens to use it.
leaks = [f"{f}: {n}" for f, n, p in calls
         if re.search(r"\b(lat|lng|latitude|longitude|coords|position|address)\s*:", p)]
check("no call site passes a coordinate or an address", not leaks, "; ".join(leaks))

print("\nsingle configuration point")
# Prose may name it; code may not. What must stay in one place is the wiring —
# the endpoint, the script, and the global the vendor installs.
providers = [f for f, text in sources()
             if f != "analytics.js"
             and re.search(r"goatcounter\s*[.\[(=]|gc\.zgo\.at", text, re.I)]
check("only js/analytics.js talks to the analytics provider", not providers,
      f"also wired in: {providers}")

print()
if failed:
    print(f"ANALYTICS FAIL — {failed} of {passed + failed} checks failed")
    sys.exit(1)
print(f"ANALYTICS PASS — {passed} checks")
