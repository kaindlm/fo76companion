"""Build the item database from the game's own files.

Source: github.com/fwdekker/fo76-dumps, which publishes data dumps of the
Fallout 76 client after every game update. This checks for a new release and
only rebuilds when the game has been patched.

Writes:
  docs/catalog.json   every player-facing item, sorted into categories
  docs/effects.json   legendary effects by star tier (used by filters and the parser)
  data/catalog_version.txt  which game version the catalog came from

Usage:
  python build_catalog.py              check GitHub, rebuild if there's a new release
  python build_catalog.py --force      rebuild even if nothing changed
  python build_catalog.py --dir PATH   build from dump files already on disk
"""
import csv
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CATALOG_OUT = ROOT / "docs" / "data" / "catalog.json"
EFFECTS_OUT = ROOT / "docs" / "data" / "effects.json"
VERSION_FILE = ROOT / "data" / "catalog_version.txt"
RELEASE_API = "https://api.github.com/repos/fwdekker/fo76-dumps/releases/latest"
NEEDED = ["tabular.WEAP.csv", "tabular.ARMO.csv", "tabular.ALCH.csv",
          "tabular.MISC.csv", "wiki.BOOK.wiki"]

# Editor ID prefixes for cut, test, and placeholder records.
JUNK_ID = re.compile(r"^(zzz|cut|del|deleted|test|backup|hide|debug|dev|nw_|nwot|ptr|placeholder|temp)",
                     re.IGNORECASE)
STAR = "\u00ac"  # the game's star glyph shows up as this character in the dumps


# ---------- loading ----------

def load_csv(path):
    rows = list(csv.reader(open(path, encoding="latin-1"), skipinitialspace=True))
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


def keywords(row):
    return set(re.findall(r'"(\w+)[^"]*\[KYWD', row.get("Keywords", "")))


def clean_name(name):
    return re.sub(r"\s+", " ", name.replace(STAR, "").strip())


def usable(row):
    name = row.get("Name", "").strip()
    if not name or name.startswith(("<", "[")) or row.get("File") == "NW.esm":
        return False
    return not JUNK_ID.match(row.get("Editor ID", ""))


def num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


# ---------- categorizing ----------

WEAPON_RULES = [  # checked in order against the UI weapon type, then the name
    ("Heavy", ("gatling", "fatman", "fat man", "flamer", "minigun", "machinegun", "machine gun",
               "missile", "launcher", "heavy", "cryolator", "mortar", "pepper shaker", "harpoon", "auto axe")),
    ("Thrown", ("thrown", "grenade", " mine", "molotov", "throwing")),
    ("Pistol", ("pistol", "revolver", "10mm", "flare gun", "syringer")),
    ("Shotgun", ("shotgun", "blunderbuss")),
    ("Energy", ("laser", "plasma", "gamma", "blaster", "tesla", "zapper", "enclave")),
    ("Bow", ("bow",)),
    ("Unarmed", ("unarmed", "knuckles", "gauntlet", "fist", "claws", "boxing glove")),
    ("Melee", ("melee", "sword", "axe", "knife", "hammer", "bat", "club", "blade", "machete")),
    ("Rifle", ("rifle", "sniper", "carbine", "bolt-action")),
]


def weapon_subtype(kw, name):
    ui = " ".join(k[len("UI_WeaponType"):].lower() for k in kw if k.startswith("UI_WeaponType"))
    if "PhotomodeGripHeavy" in kw:
        return "Heavy"
    for text in (ui, name.lower()):
        for label, words in WEAPON_RULES:
            if any(w in text for w in words):
                return label
    if "WeaponTypeGrenade" in kw or "ObjectTypeOrdnance" in kw:
        return "Thrown"
    if "WeaponTypeMeleeGeneral" in kw:
        return "Melee"
    return "Other"


def armor_subtype(kw, name):
    n = name.lower()
    for label, words in (("Head", ("helmet", "helm", "mask", "hood", "hat")),
                         ("Torso", ("chest", "torso", "body")),
                         ("Arm", ("arm",)), ("Leg", ("leg",))):
        if any(re.search(rf"\b{w}\b", n) for w in words):
            return label
    for part, label in (("Head", "Head"), ("Torso", "Torso"), ("Arm", "Arm"), ("Leg", "Leg")):
        if any(k.startswith("ArmorBodyPart" + part) or k == f"ma_PA_{part}" for k in kw):
            return label
    return None


def item(row, category, subtype=None, kw=None, **extra):
    kw = kw if kw is not None else set()
    rec = {
        "name": clean_name(row["Name"]),
        "cat": category,
        "sub": subtype,
        "value": num(row.get("Value")),
        "weight": num(row.get("Weight")),
        # NonPlayerTradable is the game's own "can't trade" flag.
        "tradable": "NonPlayerTradable" not in kw,
        "id": row.get("Form ID", ""),
    }
    rec.update(extra)
    return rec


def from_weapons(rows):
    out = []
    for r in rows:
        kw = keywords(r)
        if not usable(r) or "ObjectTypeWeapon" not in kw or re.match(r"^cr[A-Z]|^crcr|^crWeap", r["Editor ID"]):
            continue
        out.append(item(r, "weapon", weapon_subtype(kw, r["Name"]), kw))
    return out


def from_armor(rows):
    out = []
    for r in rows:
        kw = keywords(r)
        if not usable(r) or "playerCannotEquip" in kw:
            continue
        if "ArmorTypePower" in kw:
            out.append(item(r, "power_armor", armor_subtype(kw, r["Name"]), kw))
        elif "ObjectTypeArmor" in kw:
            out.append(item(r, "armor", armor_subtype(kw, r["Name"]), kw))
        elif "ObjectTypeUnderarmor" in kw:
            out.append(item(r, "apparel", "Underarmor", kw))
        elif "ObjectTypeClothing" in kw:
            sub = "Headwear" if "ClothingTypeHeadwear" in kw else "Outfit"
            out.append(item(r, "apparel", sub, kw))
    return out


FISH_REGION = re.compile(r"Fishing_FishType_(\w+)")


def from_consumables(rows):
    out = []
    for r in rows:
        kw = keywords(r)
        if not usable(r):
            continue
        eid = r["Editor ID"]
        if "ObjectTypeFish" in kw or eid.startswith("Fishing_Fish_"):
            regions = [re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m).replace("_", ": ") for m in FISH_REGION.findall(r["Keywords"])
                       if m not in ("Generic", "Glowing", "Sawgill", "Axolotl")]
            size = next((s for s in ("Small", "Medium", "Large") if f"Fishing_FishSize_{s}" in kw), None)
            glowing = "Fishing_FishType_Glowing" in kw
            out.append(item(r, "fish", size, kw, region=", ".join(regions) or None, glowing=glowing))
        elif "BobbleheadKeyword" in kw:
            out.append(item(r, "bobblehead", None, kw))
        elif "MagazineKeyword" in kw:
            out.append(item(r, "magazine", None, kw))
        elif "ObjectTypeSerum" in kw:
            out.append(item(r, "serum", None, kw))
        elif "ObjectTypeChem" in kw:
            out.append(item(r, "chem", None, kw))
        elif "ObjectTypeFood" in kw or "ObjectTypeDrink" in kw:
            out.append(item(r, "food_drink", "Drink" if "ObjectTypeDrink" in kw else "Food", kw))
        else:
            out.append(item(r, "consumable", None, kw))
    return out


SHARD = re.compile(r"LegendaryShard_(Weapon|Armor|Shared|PowerArmor)(\d)_", re.IGNORECASE)


def from_misc(rows):
    out, effects = [], {}
    for r in rows:
        if not usable(r):
            continue
        eid, raw_name = r["Editor ID"], r["Name"]
        low = eid.lower()
        m = SHARD.match(eid)
        if m:
            applies = {"weapon": "Weapon", "armor": "Armor", "shared": "Both",
                       "powerarmor": "Power armor"}[m.group(1).lower()]
            stars = int(m.group(2))
            name = clean_name(raw_name)
            out.append(item(r, "legendary_mod", f"{stars}★ {applies}", stars=stars, effect=name))
            effects.setdefault((name, stars), set()).add(applies)
        elif low.startswith("miscmod_pa_") or "mod_poweramor" in low or "mod_powerarmor" in low:
            out.append(item(r, "pa_mod"))
        elif low.startswith(("miscmod_mod_armor", "miscmod_armor")):
            out.append(item(r, "armor_mod"))
        elif low.startswith("miscmod"):
            out.append(item(r, "weapon_mod"))
        elif low.startswith("fishing_"):
            out.append(item(r, "fishing"))
        elif "flux" in low:
            out.append(item(r, "junk_flux", "Flux"))
        elif low.startswith(("bulk_", "c_")) or "scrap" in low:
            out.append(item(r, "junk_flux", "Junk"))
        elif ("plush" in low or "snowglobe" in low or "snow globe" in raw_name.lower()
              or raw_name.lower().startswith("collectible")):
            out.append(item(r, "collectible"))
        else:
            out.append(item(r, "misc"))
    effect_list = [{"name": n, "stars": s, "applies": sorted(a)} for (n, s), a in effects.items()]
    effect_list.sort(key=lambda e: (e["stars"], e["name"]))
    return out, effect_list


BOOK_RE = re.compile(
    r"==\[(.*?)\] (.*?)==\r?\nForm ID:\s+(\w+)\r?\nEditor ID:\s+(\S*)\r?\nWeight:\s+(\S+)\r?\nValue:\s+(\d+)")


def from_books(text):
    out = []
    for file, name, form_id, eid, weight, value in BOOK_RE.findall(text):
        row = {"Name": name, "Editor ID": eid, "File": file, "Form ID": form_id,
               "Weight": weight, "Value": value}
        if not usable(row):
            continue
        if name.startswith("Plan:"):
            sub = "Mod" if re.search(r"\bmod\b|mods\b", name, re.I) else None
            out.append(item(row, "plan", sub))
        elif name.startswith("Recipe:"):
            out.append(item(row, "recipe"))
    return out


# ---------- build ----------

def dedupe(items):
    """Many items exist as several records (variants, events). Keep one per name + category."""
    seen = {}
    for it in items:
        key = (it["cat"], it["name"].lower())
        if key not in seen:
            seen[key] = it
        elif (seen[key].get("value") or 0) < (it.get("value") or 0):
            it["tradable"] = it["tradable"] or seen[key]["tradable"]
            seen[key] = it
        else:
            # if any variant is tradable, count the item as tradable
            seen[key]["tradable"] = seen[key]["tradable"] or it["tradable"]
    return sorted(seen.values(), key=lambda i: (i["cat"], i["name"].lower()))


CHANGES_OUT = ROOT / "docs" / "data" / "changes.json"
DIFF_CATS = {"weapon": "weapon", "armor": "armor", "power_armor": "power_armor",
             "legendary_mod": "legendary_effect", "serum": "mutation"}


def log_catalog_diff(old, new, version):
    """After a game update, note build-relevant items that appeared or disappeared from the game files."""
    key = lambda i: (i["cat"], i["name"].lower())
    old_map = {key(i): i for i in old if i["cat"] in DIFF_CATS}
    new_map = {key(i): i for i in new if i["cat"] in DIFF_CATS}
    added = [new_map[k] for k in new_map.keys() - old_map.keys()]
    removed = [old_map[k] for k in old_map.keys() - new_map.keys()]
    if not added and not removed:
        return
    import hashlib
    import time as _t
    log = json.loads(CHANGES_OUT.read_text()) if CHANGES_OUT.exists() else {"patches": [], "changes": []}
    pid = f"data:{version}"
    now = int(_t.time())
    log["changes"] = [c for c in log["changes"] if c["patch_id"] != pid]
    for items, direction, verb in ((added, "added", "Added to"), (removed, "removed", "No longer in")):
        for i in sorted(items, key=lambda x: x["name"])[:150]:
            entry = {"name": i["name"], "kind": DIFF_CATS[i["cat"]], "direction": direction,
                     "summary": f"{verb} the game files in this update."}
            entry["id"] = hashlib.sha1(f"{pid}|{i['name'].lower()}|{direction}".encode()).hexdigest()[:14]
            entry["patch_id"], entry["found"] = pid, now
            log["changes"].append(entry)
    log["patches"] = [p for p in log["patches"] if p["id"] != pid] + [{
        "id": pid, "title": f"Game data update ({version})", "date": _t.strftime("%Y-%m-%d"),
        "url": f"https://github.com/fwdekker/fo76-dumps/releases/tag/{version}", "source": "Game files (fo76-dumps)"}]
    CHANGES_OUT.write_text(json.dumps(log, indent=1))
    print(f"Logged {len(added)} added and {len(removed)} removed items from the game files.")


def build(folder, version):
    folder = Path(folder)
    items = []
    items += from_weapons(load_csv(folder / "tabular.WEAP.csv"))
    items += from_armor(load_csv(folder / "tabular.ARMO.csv"))
    items += from_consumables(load_csv(folder / "tabular.ALCH.csv"))
    misc_items, effects = from_misc(load_csv(folder / "tabular.MISC.csv"))
    items += misc_items
    items += from_books((folder / "wiki.BOOK.wiki").read_text(encoding="latin-1"))
    items = dedupe(items)

    for i in items:  # drop empty fields to keep the file small
        for k in [k for k, v in i.items() if v is None or v is False and k == "glowing"]:
            del i[k]

    if CATALOG_OUT.exists() and version != "local":
        old = json.loads(CATALOG_OUT.read_text())
        if old.get("game_version") not in (None, "local", version):
            log_catalog_diff(old["items"], items, version)

    CATALOG_OUT.write_text(json.dumps({"game_version": version, "count": len(items),
                                       "items": items}, separators=(",", ":")))
    EFFECTS_OUT.write_text(json.dumps({"game_version": version, "effects": effects},
                                      separators=(",", ":")))
    VERSION_FILE.write_text(version)
    print(f"Catalog: {len(items)} items, {len(effects)} legendary effects ({version}).")


def main():
    args = sys.argv[1:]
    if "--dir" in args:
        build(args[args.index("--dir") + 1], "local")
        return

    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):  # GitHub Actions provides this; avoids rate limits
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    resp = requests.get(RELEASE_API, headers=headers, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"GitHub returned {resp.status_code}: {resp.text[:200]}")
    release = resp.json()
    version = release["tag_name"]
    current = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else ""
    if version == current and "--force" not in args:
        print(f"Catalog already up to date ({version}).")
        return

    assets = {a["name"]: a["browser_download_url"] for a in release["assets"]}
    with tempfile.TemporaryDirectory() as tmp:
        for name in NEEDED:
            r = requests.get(assets[name], timeout=120)
            r.raise_for_status()
            (Path(tmp) / name).write_bytes(r.content)
        build(tmp, version)


if __name__ == "__main__":
    main()
