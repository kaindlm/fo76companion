"""Pull recent r/Market76 posts and keep only Xbox ones.

Uses Reddit's official API if REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set (needs Reddit's
approval). Otherwise reads the public RSS feed, which needs no keys. The feed version:
  - keeps each post's line breaks, so "H:" and "W:" lines stay separate
  - reads each post's date
  - pages back through older posts when it can, and the job runs every 3 hours so busy days
    aren't missed (each post is only ever sent to Claude once, so running often costs nothing extra)
  - has no flair, so it decides "Xbox or not" from the title, then the post text
Switching to the API later only takes adding the Reddit secrets; nothing else changes.
"""
import html
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime

import requests

SUBREDDIT = "Market76"
USER_AGENT = os.environ.get("REDDIT_USER_AGENT", "fo76-price-tracker/0.1 (personal use)")
XBOX_PATTERN = re.compile(r"\b(xb|xbox|xb1|xbx|xbs)\b", re.IGNORECASE)
OTHER_PLATFORM = re.compile(r"\b(pc|ps|ps4|ps5|psn|playstation)\b", re.IGNORECASE)


def is_xbox(title, flair="", body=""):
    if XBOX_PATTERN.search(title or "") or XBOX_PATTERN.search(flair or ""):
        return True
    if OTHER_PLATFORM.search(title or "") or OTHER_PLATFORM.search(flair or ""):
        return False
    # No platform in the title or flair (common with the feed, which has no flair): check the post text.
    head = (body or "")[:400]
    return bool(XBOX_PATTERN.search(head)) and not OTHER_PLATFORM.search(head)


def _api_token(client_id, client_secret):
    r = requests.post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(client_id, client_secret),
        data={"grant_type": "client_credentials"},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def fetch_via_api(limit=300):
    token = _api_token(os.environ["REDDIT_CLIENT_ID"], os.environ["REDDIT_CLIENT_SECRET"])
    headers = {"Authorization": f"bearer {token}", "User-Agent": USER_AGENT}
    posts, after = [], None
    while len(posts) < limit:
        params = {"limit": 100}
        if after:
            params["after"] = after
        r = requests.get(f"https://oauth.reddit.com/r/{SUBREDDIT}/new", headers=headers,
                         params=params, timeout=30)
        r.raise_for_status()
        data = r.json()["data"]
        for child in data["children"]:
            d = child["data"]
            posts.append({
                "id": d["id"],
                "title": d.get("title", ""),
                "body": d.get("selftext", ""),
                "flair": d.get("link_flair_text") or "",
                "created_utc": d.get("created_utc"),
                "url": "https://www.reddit.com" + d.get("permalink", ""),
            })
        after = data.get("after")
        if not after:
            break
    return posts


def _feed_text(content_html):
    """Turn the feed's HTML into text but keep line breaks, and drop Reddit's footer links."""
    t = html.unescape(content_html or "")
    t = re.sub(r"<(br|/p|/li|/div|/h\d|/tr|/blockquote)[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<li[^>]*>", "- ", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.splitlines()]
    footer = re.compile(r"^(submitted by|\[link\]|\[comments\])", re.I)
    return "\n".join(ln for ln in lines if ln and not footer.match(ln))


def _feed_time(entry, ns):
    for tag in ("a:published", "a:updated"):
        v = entry.findtext(tag, default="", namespaces=ns)
        if v:
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
    return None


ATOM = {"a": "http://www.w3.org/2005/Atom"}


def parse_feed(content):
    """Posts from a Reddit Atom feed (listing or search)."""
    root = ET.fromstring(content)
    out = []
    for entry in root.findall("a:entry", ATOM):
        pid = entry.findtext("a:id", default="", namespaces=ATOM).replace("t3_", "")
        if not pid:
            continue
        link = entry.find("a:link", ATOM)
        out.append({
            "id": pid,
            "title": entry.findtext("a:title", default="", namespaces=ATOM),
            "body": _feed_text(entry.findtext("a:content", default="", namespaces=ATOM)),
            "flair": "",
            "created_utc": _feed_time(entry, ATOM),
            "url": link.get("href") if link is not None else "",
        })
    return out


def _api_headers():
    token = _api_token(os.environ["REDDIT_CLIENT_ID"], os.environ["REDDIT_CLIENT_SECRET"])
    return {"Authorization": f"bearer {token}", "User-Agent": USER_AGENT}


def _api_post(d):
    return {"id": d["id"], "title": d.get("title", ""), "body": d.get("selftext", ""),
            "flair": d.get("link_flair_text") or "", "created_utc": d.get("created_utc"),
            "url": "https://www.reddit.com" + d.get("permalink", "")}


def has_api_keys():
    return bool(os.environ.get("REDDIT_CLIENT_ID") and os.environ.get("REDDIT_CLIENT_SECRET"))


_headers_cache = {}


def search(term, pages=3, pause=3.0, sort="new", extra=""):
    """
    Search r/Market76 for a phrase within the past year.
    Uses the API if keys are set, otherwise Reddit's public search feed.
    Reddit caps how many results any one search returns, which is why the backfill searches
    item by item, and why deep mode repeats each search with different sorts and extra words:
    each variation returns a different capped slice of the year.
    """
    q = f'"{term}" {extra}'.strip()
    posts, after = [], None
    for _ in range(pages):
        if has_api_keys():
            if "h" not in _headers_cache:
                _headers_cache["h"] = _api_headers()
            params = {"q": q, "restrict_sr": 1, "sort": sort, "t": "year", "limit": 100}
            if after:
                params["after"] = f"t3_{after}"
            r = requests.get(f"https://oauth.reddit.com/r/{SUBREDDIT}/search", headers=_headers_cache["h"], params=params, timeout=30)
            r.raise_for_status()
            page = [_api_post(c["data"]) for c in r.json()["data"]["children"]]
        else:
            params = {"q": q, "restrict_sr": "on", "sort": sort, "t": "year", "limit": 100}
            if after:
                params["after"] = f"t3_{after}"
            r = requests.get(f"https://www.reddit.com/r/{SUBREDDIT}/search.rss", headers={"User-Agent": USER_AGENT}, params=params, timeout=30)
            r.raise_for_status()
            page = parse_feed(r.content)
        new = [p for p in page if p["id"] not in {x["id"] for x in posts}]
        posts += new
        time.sleep(pause)
        if len(page) < 100 or not new:
            break
        after = page[-1]["id"]
    return posts


def fetch_via_rss(pages=3):
    ns = ATOM
    posts, seen, after = [], set(), None
    for page in range(pages):
        url = f"https://www.reddit.com/r/{SUBREDDIT}/new/.rss?limit=100" + (f"&after=t3_{after}" if after else "")
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except Exception as e:
            if page == 0:
                raise RuntimeError(f"Reddit feed failed ({e}). If this keeps happening, Reddit may be blocking GitHub's servers.")
            print(f"Stopped paging the feed at page {page + 1}: {e}")
            break
        added = 0
        for entry in root.findall("a:entry", ns):
            pid = entry.findtext("a:id", default="", namespaces=ns).replace("t3_", "")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            added += 1
            link = entry.find("a:link", ns)
            posts.append({
                "id": pid,
                "title": entry.findtext("a:title", default="", namespaces=ns),
                "body": _feed_text(entry.findtext("a:content", default="", namespaces=ns)),
                "flair": "",
                "created_utc": _feed_time(entry, ns),
                "url": link.get("href") if link is not None else "",
            })
            after = pid
        if added == 0:
            break  # the feed ignored paging or ran out; what we have is fine
        time.sleep(2)  # be polite to Reddit
    return posts


def fetch_xbox_posts():
    if os.environ.get("REDDIT_CLIENT_ID") and os.environ.get("REDDIT_CLIENT_SECRET"):
        posts = fetch_via_api()
    else:
        print("No Reddit API keys set, using RSS feed.")
        posts = fetch_via_rss()
    xbox = [p for p in posts if is_xbox(p["title"], p["flair"], p["body"])]
    print(f"Fetched {len(posts)} posts, {len(xbox)} Xbox.")
    return xbox
