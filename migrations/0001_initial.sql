PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('life', 'tech')),
  slug TEXT NOT NULL,
  data_json TEXT NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  github_path TEXT,
  github_sha TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE(section, slug)
);
CREATE INDEX IF NOT EXISTS drafts_updated_at ON drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS drafts_status ON drafts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS draft_versions (
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision)
);
CREATE INDEX IF NOT EXISTS draft_versions_created_at ON draft_versions(draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  alt TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pr-open', 'merged', 'deployed', 'failed')),
  github_branch TEXT NOT NULL,
  github_commit TEXT NOT NULL,
  pull_request_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS publish_jobs_created_at ON publish_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  identity TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
