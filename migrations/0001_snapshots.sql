-- Cloud sync (SPEC §K): one snapshot of each learner's data, gzip JSON written by the site.
CREATE TABLE snapshots (
  email TEXT PRIMARY KEY,        -- from the Cloudflare Access login, lower case
  version INTEGER NOT NULL,      -- +1 on every write; the client sends it back as If-Match
  data BLOB NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL    -- epoch ms
);
