"""Send trade posts to Claude and get back structured price records.

Uses Anthropic's Message Batches API (half price; results usually arrive within minutes,
at most 24 hours). Posts go 25 to a request. A batch that isn't done by the end of a run is
saved in data/pending_batches.json and collected on the next run, so nothing is paid for twice
and nothing is lost.
"""
import json
import os
import re
import time
from pathlib import Path

import requests

MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
BATCH_SIZE = 25
ROOT = Path(__file__).resolve().parent.parent
PENDING_FILE = ROOT / "data" / "pending_batches.json"
API = "https://api.anthropic.com/v1/messages"

CATEGORIES = [
    "weapon", "armor", "power_armor", "weapon_mod", "armor_mod", "pa_mod",
    "legendary_mod", "plan", "recipe", "apparel", "serum", "chem", "food_drink",
    "fish", "fishing", "bobblehead", "magazine", "collectible", "ammo",
    "junk_flux", "consumable", "misc",
]
EFFECTS_FILE = Path(__file__).resolve().parent.parent / "docs" / "data" / "effects.json"


def effect_names():
    if not EFFECTS_FILE.exists():
        return ""
    effects = json.loads(EFFECTS_FILE.read_text())["effects"]
    by_star = {}
    for e in effects:
        by_star.setdefault(e["stars"], []).append(e["name"])
    return "\n".join(f"{s}-star: " + ", ".join(names) for s, names in sorted(by_star.items()))

PROMPT = """You extract Fallout 76 trade prices from r/Market76 posts.

Posts usually look like "H: (have) W: (want)". Return ONE record for each item
that has a stated price. Skip items with no price, "offers", "PC" (price check),
or vague wants like "caps" with no amount.

For each record return:
- post_id: the id given with the post
- side: "selling" if the poster has it and names a price, "buying" if they want it and name what they'll pay
- item: the standard in-game name, no star effects (e.g. "Handmade Rifle", "Plan: Tesla Rifle", "Asylum Worker Uniform (Pink)")
- category: one of %s. Legendary weapons go under "weapon", legendary armor under "armor" or "power_armor". Loose legendary mod boxes (e.g. "Rangers mod", "4* Vital box mod") go under "legendary_mod".
- stars: number of legendary stars, or null if not legendary
- effects: legendary effects in star order, using ONLY names from the list below (these are the in-game legendary mod names). Players abbreviate and use descriptions instead of names, e.g. B = Bloodied, AA = Anti-armor, FFR = Rapid (faster fire rate), 25 or 25%% = V.A.T.S. Optimized (25%% less VATS AP cost), 90 = Lightweight (90%% less weight). Map each to the closest name in the list. Empty list if none.
%s
- amount: the number (e.g. 2000, 5)
- currency: "caps", "leaders" (leader bobbleheads), or "other"
- price_text: the price exactly as written, short (e.g. "2k caps", "5 leaders", "Bloodied Gatling")
- quote: the exact line or phrase from the post that this record came from, 150 characters max

Convert "2k" to 2000, "1.5k" to 1500. If a price is another item and not caps or leaders, use currency "other", amount null.

Respond with ONLY a JSON array, no other text. If nothing has a price, respond [].

Posts:
%s"""


def _format_posts(posts):
    chunks = []
    for p in posts:
        body = (p.get("body") or "")[:1500]
        chunks.append(f"--- id: {p['id']}\nTitle: {p['title']}\nBody: {body}")
    return "\n".join(chunks)


def _headers():
    return {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
            "content-type": "application/json"}


def _parse_json(text):
    text = re.sub(r"```(json)?", "", text).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


PRICE_HINT = re.compile(r"\d|leader|caps?\b|\bc\b", re.IGNORECASE)
PRICE_CHECK = re.compile(r"\bprice ?check\b|\bPC\b|\bwhat(?:'s| is) (?:it|this) worth\b", re.IGNORECASE)


def worth_parsing(post):
    """Skip price-check posts and posts with nothing that looks like a price, before paying for them."""
    text = f"{post.get('title', '')} {post.get('body', '')}"
    if PRICE_CHECK.search(post.get("title", "")):
        return False
    return bool(PRICE_HINT.search(text))


def _requests_for(posts):
    effects_text = effect_names()
    out = []
    for i in range(0, len(posts), BATCH_SIZE):
        chunk = posts[i:i + BATCH_SIZE]
        out.append({"custom_id": f"chunk-{i // BATCH_SIZE}",
                    "params": {"model": MODEL, "max_tokens": 8000,
                               "messages": [{"role": "user", "content": PROMPT % (", ".join(CATEGORIES), effects_text, _format_posts(chunk))}]},
                    "post_ids": [p["id"] for p in chunk]})
    return out


def _load_pending():
    return json.loads(PENDING_FILE.read_text()) if PENDING_FILE.exists() else []


def _save_pending(pending):
    PENDING_FILE.write_text(json.dumps(pending))


def submit(posts):
    """Send posts as one batch. Returns the pending entry (also saved to disk)."""
    reqs = _requests_for(posts)
    r = requests.post(f"{API}/batches", headers=_headers(),
                      json={"requests": [{"custom_id": q["custom_id"], "params": q["params"]} for q in reqs]}, timeout=120)
    r.raise_for_status()
    entry = {"id": r.json()["id"], "created": time.time(),
             "chunks": {q["custom_id"]: q["post_ids"] for q in reqs},
             "posts": {p["id"]: {"url": p["url"], "title": p["title"][:200], "created_utc": p.get("created_utc")} for p in posts}}
    pending = _load_pending()
    pending.append(entry)
    _save_pending(pending)
    print(f"Submitted batch {entry['id']}: {len(posts)} posts in {len(reqs)} requests.")
    return entry


def _records_from_message(msg, entry):
    text = "".join(b.get("text", "") for b in msg.get("content", []) if b.get("type") == "text")
    out = []
    for rec in _parse_json(text):
        post = entry["posts"].get(str(rec.get("post_id")))
        if not post or not rec.get("item"):
            continue
        rec["url"], rec["title"], rec["created_utc"] = post["url"], post["title"], post.get("created_utc")
        out.append(rec)
    return out


def collect(wait_seconds=0, poll=30):
    """
    Gather results from any finished batches. Waits up to wait_seconds for unfinished ones.
    Returns (records, failed_post_ids). Failed posts can be retried on a later run.
    """
    deadline = time.time() + wait_seconds
    records, failed = [], []
    while True:
        pending, still = _load_pending(), []
        for entry in pending:
            r = requests.get(f"{API}/batches/{entry['id']}", headers=_headers(), timeout=60)
            r.raise_for_status()
            info = r.json()
            if info.get("processing_status") != "ended":
                still.append(entry)
                continue
            got = set()
            res = requests.get(info["results_url"], headers=_headers(), timeout=120)
            res.raise_for_status()
            for line in res.text.splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("result", {}).get("type") == "succeeded":
                    records += _records_from_message(row["result"]["message"], entry)
                    got.add(row["custom_id"])
            for cid, ids in entry["chunks"].items():
                if cid not in got:
                    failed += ids
            print(f"Collected batch {entry['id']}: {len(got)} of {len(entry['chunks'])} requests succeeded.")
        _save_pending(still)
        if not still or time.time() >= deadline:
            if still:
                print(f"{len(still)} batch(es) still processing; they'll be collected next run.")
            return records, failed
        time.sleep(poll)


def parse_posts_direct(posts):
    """Old one-request-at-a-time path (full price). Used only if USE_BATCH=0."""
    records = []
    for q in _requests_for(posts):
        r = requests.post(API, headers=_headers(), json=q["params"], timeout=120)
        r.raise_for_status()
        entry = {"posts": {p["id"]: {"url": p["url"], "title": p["title"][:200], "created_utc": p.get("created_utc")} for p in posts}}
        records += _records_from_message(r.json(), entry)
    return records
