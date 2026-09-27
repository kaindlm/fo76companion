"""One-time backfill: search r/Market76 item by item to fill in the past year of Xbox prices.

Run it from the Actions tab ("Backfill price history"). It:
  1. builds a list of search terms from the item database (quick or full),
  2. searches each one (public search feed, or the API if Reddit keys are set),
  3. keeps Xbox posts from the last 365 days that the tracker hasn't read yet,
  4. prints an estimated cost, then sends up to MAX_POSTS of them to Claude (half-price batch),
  5. adds the prices to your history.

It remembers which terms are done (data/backfill_state.json), so if a full run hits
GitHub's time limit, starting it again picks up where it stopped. Delete that file to start over.

Settings (set by the workflow's inputs):
  MODE          quick (weapons, armor sets, power armor sets, legendary mods, serums),
                full (adds plans and apparel), or deep (the quick list, each searched 7 ways to
                reach further back for common items; terms already done in quick mode only run the extra ways)
  MAX_POSTS     most posts to send to Claude this run (spending cap), default 3000
  EXTRA_TERMS   comma-separated extra searches, e.g. "Beta Wave Tuner, Fasnacht Crown"
  SEARCH_MINUTES  stop searching after this long and process what was found, default 240
"""
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_posts as fp  # noqa: E402
import parse_posts as pp  # noqa: E402
import run_daily as rd  # noqa: E402
from match_items import Matcher  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "data" / "backfill_state.json"
FOUND = ROOT / "data" / "backfill_found.json"
YEAR = 365 * 86400

# Rough cost per post through the half-price batch path (input ~370 tokens, output ~100),
# at Haiku 4.5's published rates. Printed as an estimate only.
EST_PER_POST = 0.00045

# Deep mode: extra ways to search each term. Each returns its own capped slice of the year.
DEEP_VARIANTS = [
    {"sort": "relevance"}, {"sort": "top"}, {"sort": "comments"},
    {"sort": "new", "extra": "leaders"}, {"sort": "new", "extra": "caps"}, {"sort": "new", "extra": "XB"},
]

SLOT = re.compile(r" (Helmet|Helm|Chest Piece|Torso|Left Arm|Right Arm|Left Leg|Right Leg)$")


def clean(term):
    term = re.sub(r"^(Plan|Recipe):\s*", "", term)
    term = re.sub(r"[\"“”]", "", term).strip()
    return term if len(term) >= 4 else ""


def build_terms(mode):
    cat = json.loads((ROOT / "docs" / "data" / "catalog.json").read_text())["items"]
    terms = []
    add = lambda t: (c := clean(t)) and c.lower() not in {x.lower() for x in terms} and terms.append(c)
    for i in cat:
        if i["cat"] == "weapon" and i["tradable"]:
            add(i["name"])
    for c in ("armor", "power_armor"):
        sets = {}
        for i in cat:
            if i["cat"] == c:
                m = SLOT.search(i["name"])
                if m:
                    sets.setdefault(i["name"][:m.start()], set()).add(m.group(1))
        for s, slots in sets.items():
            if len(slots) >= 4:
                add(s)
    for i in cat:
        if i["cat"] == "legendary_mod":
            add(i["name"])
        if i["cat"] == "serum":
            add(i["name"])
    if mode == "full":  # deep uses the quick list
        for i in cat:
            if i["cat"] in ("plan", "apparel") and i["tradable"]:
                add(i["name"])
    for t in os.environ.get("EXTRA_TERMS", "").split(","):
        add(t)
    return terms


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def main():
    mode = os.environ.get("MODE", "quick")
    max_posts = int(os.environ.get("MAX_POSTS", "3000"))
    minutes = float(os.environ.get("SEARCH_MINUTES", "240"))
    pause = 1.0 if fp.has_api_keys() else 6.5  # public search allows roughly 10 requests a minute

    terms = build_terms(mode)
    state = load(STATE, {"done": []})
    done = set(state["done"])
    # Progress keys: plain term = its standard search is done; "deep|term" = its deep variations are done.
    key = (lambda t: f"deep|{t}") if mode == "deep" else (lambda t: t)
    found = {p["id"]: p for p in load(FOUND, [])}  # posts found but not yet sent (from an earlier cut-off run)
    seen = rd.load_seen()
    todo = [t for t in terms if key(t) not in done]
    print(f"Mode {mode}: {len(terms)} search terms, {len(todo)} still to search. "
          f"Using {'the Reddit API' if fp.has_api_keys() else 'the public search feed'}.")

    cutoff = time.time() - YEAR
    deadline = time.time() + minutes * 60
    errors = 0
    for n, term in enumerate(todo, 1):
        if time.time() > deadline:
            print(f"Search time limit reached after {n - 1} terms; run the backfill again to continue.")
            break
        try:
            posts = [] if (mode == "deep" and term in done) else fp.search(term, pause=pause)
            if mode == "deep":
                for v in DEEP_VARIANTS:
                    posts += fp.search(term, pages=1, pause=pause, **v)
            errors = 0
        except Exception as e:
            errors += 1
            print(f"  '{term}': search failed ({e})")
            if errors >= 5:
                print("Five searches in a row failed; Reddit may be blocking or rate-limiting. Stopping here; run again later.")
                break
            time.sleep(30 * errors)  # back off longer after each refusal
            continue
        kept = 0
        posts = list({p["id"]: p for p in posts}.values())
        for p in posts:
            if p["id"] in seen or p["id"] in found:
                continue
            if p.get("created_utc") and p["created_utc"] < cutoff:
                continue
            if not fp.is_xbox(p["title"], p["flair"], p["body"]) or not pp.worth_parsing(p):
                continue
            found[p["id"]] = p
            kept += 1
        done.add(key(term))
        if mode == "deep":
            done.add(term)  # its standard search ran too (now or in an earlier quick run)
        if n % 25 == 0 or kept:
            print(f"  [{n}/{len(todo)}] '{term}': {len(posts)} results, {kept} new Xbox posts with prices (total {len(found)})")
        if n % 20 == 0:  # save progress often in case the run is cut off
            STATE.write_text(json.dumps({"done": sorted(done)}))
            FOUND.write_text(json.dumps(list(found.values())))
    STATE.write_text(json.dumps({"done": sorted(done)}))

    batch = sorted(found.values(), key=lambda p: -(p.get("created_utc") or 0))[:max_posts]
    leftover = [p for p in found.values() if p["id"] not in {b["id"] for b in batch}]
    FOUND.write_text(json.dumps(leftover))
    if not batch:
        print("No new posts to add.")
        return
    print(f"Sending {len(batch)} posts to Claude (estimated cost about ${len(batch) * EST_PER_POST:.2f}). "
          f"{len(leftover)} more are saved for the next run.")

    pp.submit(batch)
    seen.update(p["id"] for p in batch)
    rd.SEEN_FILE.write_text(json.dumps(sorted(seen)))
    records, failed = pp.collect(wait_seconds=int(os.environ.get("BATCH_WAIT", "3600")))
    seen.difference_update(failed)
    rd.SEEN_FILE.write_text(json.dumps(sorted(seen)))

    now = time.time()
    for r in records:
        r["seen_at"] = r.get("created_utc") or now
    matcher = Matcher()
    obs = rd.save_observations([matcher.apply(o) for o in rd.load_observations() + records])
    rd.OUT_FILE.write_text(json.dumps(rd.summarize(obs)))
    print(f"Added {len(records)} price records. History now has {len(obs)} records. "
          "Anything still processing gets added by the next regular price update.")


if __name__ == "__main__":
    main()
