-- FO76 Companion database (Cloudflare D1). Paste into the D1 console once.

-- One row per build. Only the owner can change it. "version" goes up on every save,
-- so a stale save from another device is refused instead of overwriting newer work.
CREATE TABLE IF NOT EXISTS builds (
  id       TEXT PRIMARY KEY,
  person   TEXT NOT NULL,
  data     TEXT NOT NULL,
  version  INTEGER NOT NULL DEFAULT 1,
  updated  INTEGER NOT NULL,
  rev      INTEGER NOT NULL,
  deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS builds_sync ON builds(person, rev);

-- One row per tick, per person: inventory items (kind 'inv'), checklist and challenge
-- ticks (kind 'ck'), and personal tasks (kind 'task'). One row each means two edits
-- never touch the same record unless they are the same tick.
CREATE TABLE IF NOT EXISTS marks (
  person   TEXT NOT NULL,
  kind     TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,
  updated  INTEGER NOT NULL,
  rev      INTEGER NOT NULL,
  PRIMARY KEY (person, kind, key)
);
CREATE INDEX IF NOT EXISTS marks_sync ON marks(person, rev);

CREATE TABLE IF NOT EXISTS ratelimit (
  hour INTEGER PRIMARY KEY,
  n    INTEGER NOT NULL
);
