"""Daily job: fetch new Xbox posts, parse prices, update the price table.

Files:
  data/observations.jsonl  every price record seen (last 365 days kept)
  data/seen_ids.json       post ids already processed, so nothing is paid for twice
  docs/prices.json         summary the web page reads
  docs/catalog.json        item database (rebuilt only after game patches)
"""
import json
import statistics
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OBS_FILE = ROOT / "data" / "observations.jsonl"
SEEN_FILE = ROOT / "data" / "seen_ids.json"
OUT_FILE = ROOT / "docs" / "data" / "prices.json"
KEEP_DAYS = 365
DAY = 86400


def load_seen():
    return set(json.loads(SEEN_FILE.read_text())) if SEEN_FILE.exists() else set()


def load_observations():
    if not OBS_FILE.exists():
        return []
    return [json.loads(line) for line in OBS_FILE.read_text().splitlines() if line.strip()]


def save_observations(obs):
    cutoff = time.time() - KEEP_DAYS * DAY
    obs = [o for o in obs if o["seen_at"] >= cutoff]
    OBS_FILE.write_text("".join(json.dumps(o) + "\n" for o in obs))
    return obs


def item_key(rec):
    effects = " / ".join(e.strip() for e in (rec.get("effects") or []))
    name = rec["item"].strip()
    return f"{name} | {effects}" if effects else name


def price_stats(values):
    if not values:
        return None
    return {
        "median": round(statistics.median(values)),
        "low": min(values),
        "high": max(values),
        "count": len(values),
    }


def summarize(obs):
    now = time.time()
    groups = defaultdict(list)
    for o in obs:
        groups[item_key(o).lower()].append(o)

    items = []
    for recs in groups.values():
        latest = max(recs, key=lambda r: r["seen_at"])
        entry = {
            "item": latest["item"],
            "category": latest.get("category") or "misc",
            "sub": latest.get("sub"),
            "catalog_id": latest.get("catalog_id"),
            "stars": latest.get("stars"),
            "effects": latest.get("effects") or [],
            "last_seen": latest["seen_at"],
            "prices": {},
            "recent": [],
        }
        for side in ("selling", "buying"):
            for currency in ("caps", "leaders"):
                rows = [r for r in recs if r.get("side") == side and r.get("currency") == currency
                        and isinstance(r.get("amount"), (int, float))]
                if not rows:
                    continue
                recent = [r["amount"] for r in rows if r["seen_at"] >= now - 30 * DAY]
                week = [r["amount"] for r in rows if r["seen_at"] >= now - 7 * DAY]
                if recent:
                    s = price_stats(recent)
                    s["window"] = "30d"
                else:
                    # Nothing in the last 30 days: fall back to the most recent 90 days of posts
                    # before the latest one, and say how old it is.
                    latest = max(r["seen_at"] for r in rows)
                    older = [r["amount"] for r in rows if r["seen_at"] >= latest - 90 * DAY]
                    s = price_stats(older)
                    s["window"] = "older"
                s["last_seen"] = max(r["seen_at"] for r in rows)
                s["median_7d"] = round(statistics.median(week)) if week else None
                entry["prices"][f"{side}_{currency}"] = s
        for r in sorted(recs, key=lambda r: r["seen_at"], reverse=True)[:8]:
            entry["recent"].append({"side": r.get("side"), "price": r.get("price_text"),
                                    "amount": r.get("amount"), "currency": r.get("currency"),
                                    "quote": r.get("quote"), "title": r.get("title"),
                                    "url": r.get("url"), "seen_at": r["seen_at"]})
        items.append(entry)

    items.sort(key=lambda e: e["last_seen"], reverse=True)
    return {"updated": now, "platform": "Xbox", "item_count": len(items), "items": items}


def main():
    import os
    from build_catalog import main as update_catalog
    from fetch_posts import fetch_xbox_posts
    from match_items import Matcher
    import parse_posts as pp

    try:
        update_catalog()  # quick check; only rebuilds after a game patch
    except Exception as e:  # a catalog problem shouldn't stop price updates
        print(f"Catalog check failed, keeping the old one: {e}")

    seen = load_seen()
    save_seen = lambda: SEEN_FILE.write_text(json.dumps(sorted(seen)))
    use_batch = os.environ.get("USE_BATCH", "1") != "0"

    # 1. Pick up anything left over from yesterday's batch.
    new_records, failed = pp.collect(0) if use_batch else ([], [])

    # 2. New posts only, minus price checks and posts with no price in them.
    posts = [p for p in fetch_xbox_posts() if p["id"] not in seen]
    worth = [p for p in posts if pp.worth_parsing(p)]
    print(f"{len(posts)} new posts; {len(worth)} have prices worth reading, {len(posts) - len(worth)} skipped free.")
    seen.update(p["id"] for p in posts)

    # 3. Send them. Mark them seen before waiting so a crash can't cause a second paid run.
    if worth:
        if use_batch:
            pp.submit(worth)
            save_seen()
            got, bad = pp.collect(wait_seconds=int(os.environ.get("BATCH_WAIT", "2700")))
            new_records += got
            failed += bad
        else:
            new_records += pp.parse_posts_direct(worth)
    # Requests that errored or expired get another chance next run (if the post is still recent).
    seen.difference_update(failed)
    save_seen()

    now = time.time()
    for r in new_records:
        r["seen_at"] = r.get("created_utc") or now
    print(f"{len(new_records)} new price records.")

    matcher = Matcher()
    obs = [matcher.apply(o) for o in load_observations() + new_records]
    obs = save_observations(obs)
    OUT_FILE.write_text(json.dumps(summarize(obs)))
    print(f"Wrote {OUT_FILE.name} with {len(obs)} observations.")


if __name__ == "__main__":
    main()
