"""Line up names from trade posts with the item database.

Players write "tesla rifle plan" or "Plan - Tesla"; the database says
"Plan: Tesla Rifle". Matching gives every price a canonical name and category,
so prices for the same item group together.
"""
import difflib
import json
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs" / "data"


def norm(s):
    s = (s or "").lower().replace("’", "'")
    s = re.sub(r"^(plan|recipe)\s*[:\-]\s*", r"\1 ", s)
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class Matcher:
    def __init__(self):
        cat_file, eff_file = DOCS / "catalog.json", DOCS / "effects.json"
        self.items = json.loads(cat_file.read_text())["items"] if cat_file.exists() else []
        effects = json.loads(eff_file.read_text())["effects"] if eff_file.exists() else []
        self.by_norm = {}
        self.by_cat = {}
        self.by_tokens = {}
        for it in self.items:
            n = norm(it["name"])
            self.by_norm.setdefault(n, it)
            self.by_cat.setdefault(it["cat"], {})[n] = it
            self.by_tokens.setdefault(frozenset(n.split()), []).append(it)
        self.all_names = list(self.by_norm)
        self.effect_names = {norm(e["name"]): e["name"] for e in effects}

    def item(self, name, category=None):
        n = norm(name)
        if not n or not self.items:
            return None
        if category in ("plan", "recipe") and not n.startswith(category):
            n = f"{category} {n}"
        if n in self.by_norm:
            return self.by_norm[n]
        # same words, different order ("pink asylum worker uniform")
        same = self.by_tokens.get(frozenset(n.split()), [])
        same_cat = [i for i in same if i["cat"] == category] or same
        if same_cat:
            return same_cat[0]
        pool = self.by_cat.get(category)
        if pool:
            # shorthand for a longer name ("handmade" -> "handmade rifle")
            longer = sorted((k for k in pool if k.startswith(n + " ")), key=len)
            if longer and len(n) >= 4:
                return pool[longer[0]]
            hit = difflib.get_close_matches(n, list(pool), n=1, cutoff=0.86)
            if hit:
                return pool[hit[0]]
        hit = difflib.get_close_matches(n, self.all_names, n=1, cutoff=0.92)
        return self.by_norm[hit[0]] if hit else None

    def effect(self, name):
        n = norm(name)
        if n in self.effect_names:
            return self.effect_names[n]
        hit = difflib.get_close_matches(n, list(self.effect_names), n=1, cutoff=0.8)
        return self.effect_names[hit[0]] if hit else name

    def legendary_mod(self, rec):
        """Loose legendary mods are listed in the database under their effect name."""
        pool = self.by_cat.get("legendary_mod", {})
        for name in list(rec.get("effects") or []) + [rec.get("item", "")]:
            n = norm(re.sub(r"(?i)\b(legendary|mod|mods|box|\d\s*\*|\d\s*star)\b", " ", name))
            n = norm(self.effect(n))
            if n in pool:
                return pool[n]
        return None

    def apply(self, rec):
        """Canonicalize one parsed record in place."""
        rec["effects"] = [self.effect(e) for e in (rec.get("effects") or [])]
        if rec.get("category") == "legendary_mod":
            hit = self.legendary_mod(rec)
        else:
            hit = self.item(rec.get("item"), rec.get("category"))
        if hit:
            rec["item"] = hit["name"]
            rec["category"] = hit["cat"]
            rec["sub"] = hit.get("sub")
            rec["catalog_id"] = hit["id"]
        return rec
