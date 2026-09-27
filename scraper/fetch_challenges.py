"""Daily job: current daily/weekly challenges, seasonal and weekend events.

Bethesda doesn't publish the challenge list as text, and its Community Calendar is an
image. These fan sites track them and are read here; Claude pulls out the structured list.
If every source fails on a given day, the previous day's data is kept and flagged.

Writes docs/data/challenges.json.
"""
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "challenges.json"
ET = ZoneInfo("America/New_York")
MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
UA = "Mozilla/5.0 (compatible; FO76CompanionBot/1.0; personal use)"

CHALLENGE_SOURCES = [
    ("fo76challenges.com", "https://fo76challenges.com/"),
    ("Index76", "https://index76.com/challenges"),
]
EVENT_SOURCES = [
    ("FalloutBuilds events", "https://www.falloutbuilds.com/fo76/events/"),
    ("Nuka Knights calendar", "https://nukaknights.com/events-calendar.html"),
]


# ---------- time ----------

def periods(now=None):
    """Daily challenges reset at noon Eastern; weeklies reset Tuesday at noon Eastern."""
    now = (now or datetime.now(timezone.utc)).astimezone(ET)
    day_start = now.replace(hour=12, minute=0, second=0, microsecond=0)
    if now < day_start:
        day_start -= timedelta(days=1)
    week_start = day_start - timedelta(days=(day_start.weekday() - 1) % 7)  # Tuesday = 1
    return {
        "daily_start": day_start, "daily_end": day_start + timedelta(days=1),
        "weekly_start": week_start, "weekly_end": week_start + timedelta(days=7),
        "today": now.date().isoformat(),
    }


# ---------- fetching ----------

def page_text(url, limit=25000):
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-US"}, timeout=30)
    r.raise_for_status()
    t = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", r.text, flags=re.I)
    t = re.sub(r"<(br|/p|/div|/li|/h\d|/tr)[^>]*>", "\n", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t).strip()
    return t[:limit]


def reddit_text():
    """Optional: recent r/fo76 posts about challenges, if Reddit API keys are set."""
    cid, secret = os.environ.get("REDDIT_CLIENT_ID"), os.environ.get("REDDIT_CLIENT_SECRET")
    if not (cid and secret):
        return None
    ua = os.environ.get("REDDIT_USER_AGENT", UA)
    tok = requests.post("https://www.reddit.com/api/v1/access_token", auth=(cid, secret),
                        data={"grant_type": "client_credentials"}, headers={"User-Agent": ua}, timeout=30)
    tok.raise_for_status()
    r = requests.get("https://oauth.reddit.com/r/fo76/search",
                     headers={"Authorization": f"bearer {tok.json()['access_token']}", "User-Agent": ua},
                     params={"q": "daily challenges OR weekly challenges", "restrict_sr": 1, "sort": "new", "t": "week", "limit": 10},
                     timeout=30)
    r.raise_for_status()
    posts = [c["data"] for c in r.json()["data"]["children"]]
    return "\n\n".join(f"[{datetime.fromtimestamp(p['created_utc'], timezone.utc):%Y-%m-%d}] {p['title']}\n{p.get('selftext', '')[:3000]}"
                       for p in posts) or None


def gather():
    parts, status = [], []
    for label, url in CHALLENGE_SOURCES + EVENT_SOURCES:
        try:
            parts.append(f"=== SOURCE: {label} ({url}) ===\n{page_text(url)}")
            status.append({"name": label, "url": url, "ok": True})
        except Exception as e:  # one broken source shouldn't stop the rest
            status.append({"name": label, "url": url, "ok": False, "error": str(e)[:120]})
    try:
        rt = reddit_text()
        if rt:
            parts.append(f"=== SOURCE: r/fo76 recent posts ===\n{rt}")
            status.append({"name": "r/fo76", "url": "https://www.reddit.com/r/fo76/", "ok": True})
    except Exception as e:
        status.append({"name": "r/fo76", "url": "https://www.reddit.com/r/fo76/", "ok": False, "error": str(e)[:120]})
    return "\n\n".join(parts), status


# ---------- extraction ----------

PROMPT = """You extract the CURRENT Fallout 76 challenges and events from fan-site pages.

Now (US Eastern): {now}
Current daily period: {ds} to {de} (dailies reset at noon Eastern)
Current weekly period: {ws} to {we} (weeklies reset Tuesday at noon Eastern)

Return ONLY this JSON, no other text:
{{
  "daily": [{{"title": "Catch a Fish in the Mire Region", "detail": "one short tip if the source gives one, else empty", "score": 250}}],
  "weekly": [{{"title": "...", "detail": "...", "score": 1500}}],
  "events": [{{"name": "Seasonal Fish Run", "type": "seasonal|weekend|update|other", "starts": "YYYY-MM-DD", "ends": "YYYY-MM-DD", "description": "one plain sentence"}}],
  "season": {{"name": "", "number": null, "ends": "YYYY-MM-DD or empty"}}
}}

Rules:
- Only include daily/weekly challenges the sources present as active for the periods above. If a source's list is clearly for an older period, leave it out. If no source shows current challenges, return empty lists.
- Merge duplicates across sources. Use the in-game wording for titles when given. Skip repeatable challenges ("Repeatable:") and the fixed "Gold Star" daily unless nothing else is listed.
- score is a number or null.
- Events: include ones happening now or starting within the next 45 days. Dates as YYYY-MM-DD. Put your own words in descriptions; don't copy sentences.

SOURCES:
{sources}"""


def ask_claude(text, p):
    prompt = PROMPT.format(
        now=datetime.now(ET).strftime("%Y-%m-%d %H:%M"),
        ds=p["daily_start"].strftime("%Y-%m-%d %H:%M"), de=p["daily_end"].strftime("%Y-%m-%d %H:%M"),
        ws=p["weekly_start"].strftime("%Y-%m-%d %H:%M"), we=p["weekly_end"].strftime("%Y-%m-%d %H:%M"),
        sources=text)
    r = requests.post("https://api.anthropic.com/v1/messages", headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json",
    }, json={"model": MODEL, "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]}, timeout=120)
    r.raise_for_status()
    out = "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


# ---------- output ----------

def cid(kind, period_start, title):
    base = f"{kind}|{period_start:%Y-%m-%d}|{re.sub(r'[^a-z0-9]+', ' ', title.lower()).strip()}"
    return hashlib.sha1(base.encode()).hexdigest()[:12]


def clean_items(items, kind, start):
    seen, out = set(), []
    for it in items or []:
        title = str(it.get("title", "")).strip()
        if not title:
            continue
        i = cid(kind, start, title)
        if i in seen:
            continue
        seen.add(i)
        score = it.get("score")
        out.append({"id": i, "title": title[:200], "detail": str(it.get("detail") or "")[:300],
                    "score": score if isinstance(score, (int, float)) else None})
    return out


def build_output(extracted, status, p, previous):
    daily = clean_items(extracted.get("daily"), "daily", p["daily_start"])
    weekly = clean_items(extracted.get("weekly"), "weekly", p["weekly_start"])
    notes = []
    prev_same = lambda k: previous.get(k, {}).get("period_start") == p[f"{k}_start"].isoformat()
    # If today's sources came back empty, keep what we already had for this same period.
    if not daily and prev_same("daily"):
        daily = previous["daily"]["items"]; notes.append("No source had today's dailies; showing the last list found.")
    if not weekly and prev_same("weekly"):
        weekly = previous["weekly"]["items"]; notes.append("No source had this week's weeklies; showing the last list found.")
    if not daily:
        notes.append("Today's dailies weren't found yet. Sources usually update within an hour or two of the noon Eastern reset.")

    today = p["today"]
    events = []
    for e in extracted.get("events") or []:
        name = str(e.get("name", "")).strip()
        starts, ends = str(e.get("starts") or ""), str(e.get("ends") or "")
        if not name or (ends and ends < today):
            continue
        events.append({"id": hashlib.sha1(f"event|{name.lower()}|{starts}".encode()).hexdigest()[:12],
                       "name": name[:120], "type": e.get("type") or "other", "starts": starts, "ends": ends,
                       "description": str(e.get("description") or "")[:300]})
    events.sort(key=lambda e: (e["starts"] or "9999", e["name"]))
    if not events and previous.get("events"):
        events = [e for e in previous["events"] if not e.get("ends") or e["ends"] >= today]

    return {
        "updated": datetime.now(timezone.utc).isoformat(),
        "daily": {"period_start": p["daily_start"].isoformat(), "resets_at": p["daily_end"].isoformat(), "items": daily},
        "weekly": {"period_start": p["weekly_start"].isoformat(), "resets_at": p["weekly_end"].isoformat(), "items": weekly},
        "events": events,
        "season": extracted.get("season") or previous.get("season") or {},
        "sources": status,
        "notes": notes,
    }


def main():
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    p = periods()
    text, status = gather()
    if not any(s["ok"] for s in status):
        print("Every source failed; keeping the previous file.")
        if previous:
            previous["notes"] = ["Couldn't reach any source today; this is the last list found."]
            previous["sources"] = status
            OUT.write_text(json.dumps(previous, indent=1))
        return
    try:
        extracted = ask_claude(text, p)
    except Exception as e:
        print(f"Extraction failed: {e}")
        extracted = {}
    out = build_output(extracted, status, p, previous)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"{len(out['daily']['items'])} daily, {len(out['weekly']['items'])} weekly, {len(out['events'])} events.")


if __name__ == "__main__":
    main()
