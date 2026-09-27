"""Read new Fallout 76 patch notes and log every change to named things (buff, nerf, fix...).

Source: the Fallout wiki's patch pages (they carry Bethesda's full patch notes as text,
and the wiki has an API). Pages are re-read for two weeks after they first appear, because
the wiki often fills in details over a few days; each change keeps a stable id, so rewording
doesn't create duplicates or re-alert you.

Extra sources can be added with the PATCH_SOURCE_URLS secret (comma-separated page URLs).

Writes docs/data/changes.json.
"""
import hashlib
import html
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "changes.json"
SEEN = ROOT / "data" / "patch_pages.json"
WIKI_API = "https://fallout.fandom.com/api.php"
MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
UA = "FO76CompanionBot/1.0 (personal, non-commercial)"
REREAD_DAYS = 14
KINDS = ["weapon", "armor", "power_armor", "perk", "legendary_perk", "legendary_effect", "mutation",
         "consumable", "plan", "quest", "event", "item", "other"]
DIRECTIONS = ["buff", "nerf", "fix", "change", "added", "removed"]


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def wiki(params):
    r = requests.get(WIKI_API, params={**params, "format": "json"}, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    return r.json()


def wiki_patch_pages(limit=6):
    """Newest pages in the wiki's Fallout 76 patches category, skipping test-server pages."""
    data = wiki({"action": "query", "list": "categorymembers", "cmtitle": "Category:Fallout_76_patches",
                 "cmsort": "timestamp", "cmdir": "desc", "cmlimit": 20, "cmtype": "page"})
    titles = [m["title"] for m in data["query"]["categorymembers"]
              if "PTS" not in m["title"] and "test server" not in m["title"].lower() and m["title"] != "Fallout 76 patches"]
    return titles[:limit]


def wiki_page_text(title):
    data = wiki({"action": "parse", "page": title, "prop": "wikitext|revid", "redirects": 1})
    p = data["parse"]
    text = p["wikitext"]["*"]
    # Keep it readable for Claude: drop refs, templates' braces, link markup.
    text = re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", text, flags=re.S)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"'{2,}", "", text)
    return {"id": f"wiki:{p['title']}", "title": p["title"], "rev": p.get("revid"),
            "url": "https://fallout.fandom.com/wiki/" + p["title"].replace(" ", "_"), "text": text[:120000]}


def extra_page(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    t = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", r.text, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", t, flags=re.I)))
    t = re.sub(r"[ \t]+", " ", t)
    title = (re.search(r"<title>([^<]*)</title>", r.text) or [None, url])[1]
    return {"id": f"url:{url}", "title": html.unescape(title).strip(), "rev": hashlib.sha1(t.encode()).hexdigest()[:10],
            "url": url, "text": t[:120000]}


def names_for_prompt():
    d = ROOT / "docs" / "data"
    perks = json.loads((d / "perks.json").read_text())["perks"] if (d / "perks.json").exists() else []
    effects = json.loads((d / "effects.json").read_text())["effects"] if (d / "effects.json").exists() else []
    cat = json.loads((d / "catalog.json").read_text())["items"] if (d / "catalog.json").exists() else []
    return {
        "perks": sorted({p["name"] for p in perks if p["special"] != "Legendary"}),
        "legendary_perks": sorted({p["name"] for p in perks if p["special"] == "Legendary"}),
        "effects": sorted({e["name"] for e in effects}),
        "mutations": sorted({i["name"].replace(" Serum", "") for i in cat if i["cat"] == "serum"}),
    }


PROMPT = """You read Fallout 76 patch notes and list every change to a specific, named thing a player uses.

Patch page: {title}

For each change return:
- name: the thing's in-game name (use these exact spellings when it matches one):
  Perk cards: {perks}
  Legendary perks: {legendary_perks}
  Legendary effects: {effects}
  Mutations: {mutations}
- kind: one of {kinds}
- direction, judged from the player's side: "buff" (stronger, cheaper, more of it), "nerf" (weaker, costlier, less of it),
  "fix" (a bug fixed so it now works as described), "change" (neither clearly better nor worse), "added", "removed"
- summary: one short plain sentence in your own words saying what changed (numbers when the notes give them)

Rules: one entry per named thing per change. Skip vague items ("various fixes", "stability improvements"),
Atomic Shop listings, and cosmetic-only changes. Quests and events count. If a line changes several named
things, make one entry for each.

Return ONLY JSON: {{"patch_title": "short name like 'Patch 70: The Slasher'", "date": "YYYY-MM-DD or empty", "changes": [{{"name": "", "kind": "", "direction": "", "summary": ""}}]}}

PATCH NOTES:
{text}"""


def ask_claude(page, names):
    prompt = PROMPT.format(title=page["title"], kinds=", ".join(KINDS), text=page["text"],
                           **{k: ", ".join(v) for k, v in names.items()})
    r = requests.post("https://api.anthropic.com/v1/messages", headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json",
    }, json={"model": MODEL, "max_tokens": 16000, "messages": [{"role": "user", "content": prompt}]}, timeout=300)
    r.raise_for_status()
    out = "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def change_id(patch_id, c):
    base = f"{patch_id}|{re.sub(r'[^a-z0-9]+', ' ', c['name'].lower()).strip()}|{c['kind']}|{c['direction']}"
    return hashlib.sha1(base.encode()).hexdigest()[:14]


def merge(log, page, extracted, now):
    """Replace this page's entries with the new reading, keeping first-seen times for unchanged ids."""
    old = {c["id"]: c for c in log["changes"] if c["patch_id"] == page["id"]}
    log["changes"] = [c for c in log["changes"] if c["patch_id"] != page["id"]]
    seen_ids = set()
    for c in extracted.get("changes") or []:
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        kind = c.get("kind") if c.get("kind") in KINDS else "other"
        direction = c.get("direction") if c.get("direction") in DIRECTIONS else "change"
        entry = {"name": name[:120], "kind": kind, "direction": direction, "summary": str(c.get("summary") or "")[:300]}
        entry["id"] = change_id(page["id"], entry)
        if entry["id"] in seen_ids:
            continue
        seen_ids.add(entry["id"])
        entry["patch_id"] = page["id"]
        entry["found"] = old.get(entry["id"], {}).get("found", now)
        log["changes"].append(entry)
    patch = {"id": page["id"], "title": extracted.get("patch_title") or page["title"], "date": extracted.get("date") or "",
             "url": page["url"], "source": "Fallout wiki" if page["id"].startswith("wiki:") else page["url"]}
    log["patches"] = [p for p in log["patches"] if p["id"] != page["id"]] + [patch]


def main():
    now = int(time.time())
    log = load(OUT, {"patches": [], "changes": []})
    seen = load(SEEN, {})
    pages = []
    try:
        for t in wiki_patch_pages():
            try:
                pages.append(wiki_page_text(t))
            except Exception as e:
                print(f"Couldn't read wiki page {t}: {e}")
    except Exception as e:
        print(f"Wiki category lookup failed: {e}")
    for url in filter(None, (u.strip() for u in os.environ.get("PATCH_SOURCE_URLS", "").split(","))):
        try:
            pages.append(extra_page(url))
        except Exception as e:
            print(f"Couldn't read {url}: {e}")

    names = names_for_prompt()
    for page in pages:
        s = seen.get(page["id"])
        if s and (s["rev"] == page["rev"] or now - s["first"] > REREAD_DAYS * 86400):
            continue  # nothing new, or old enough to leave alone
        try:
            extracted = ask_claude(page, names)
        except Exception as e:
            print(f"Couldn't read changes from {page['title']}: {e}")
            continue
        merge(log, page, extracted, now)
        seen[page["id"]] = {"rev": page["rev"], "first": s["first"] if s else now}
        print(f"{page['title']}: {len(extracted.get('changes') or [])} changes.")

    log["patches"].sort(key=lambda p: p.get("date") or "", reverse=True)
    log["updated"] = datetime.now(timezone.utc).isoformat()
    OUT.write_text(json.dumps(log, indent=1))
    SEEN.write_text(json.dumps(seen, indent=1))


if __name__ == "__main__":
    main()
