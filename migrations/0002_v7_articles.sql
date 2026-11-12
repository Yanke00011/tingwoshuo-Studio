PRAGMA foreign_keys = ON;

-- V7 content model. The V6 drafts and GitHub publish tables remain intact so
-- the existing production workflow can run until an explicitly approved cutover.
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('life', 'tech')),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 91),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL,
  content_updated_date TEXT,
  body_markdown TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  frontmatter_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(frontmatter_json) AND json_type(frontmatter_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn', 'deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision INTEGER,
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  deleted_at TEXT,
  legacy_source_path TEXT UNIQUE,
  UNIQUE(section, slug)
);

CREATE INDEX IF NOT EXISTS articles_public_listing
  ON articles(status, published_at DESC, section, slug)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS articles_updated_at
  ON articles(updated_at DESC);

CREATE TABLE IF NOT EXISTS article_versions (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL,
  content_updated_date TEXT,
  body_markdown TEXT NOT NULL,
  body_html TEXT,
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  frontmatter_json TEXT NOT NULL CHECK (json_valid(frontmatter_json) AND json_type(frontmatter_json) = 'object'),
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(article_id, revision)
);
CREATE INDEX IF NOT EXISTS article_versions_created_at
  ON article_versions(article_id, created_at DESC);

-- Keep existing keys stable. The current bucket stays private; public media is
-- served only through a published-article reference in the blog read Worker.
ALTER TABLE media ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'published'));
ALTER TABLE media ADD COLUMN content_type TEXT NOT NULL DEFAULT 'image/webp';
ALTER TABLE media ADD COLUMN byte_size INTEGER;
ALTER TABLE media ADD COLUMN width INTEGER;
ALTER TABLE media ADD COLUMN height INTEGER;
ALTER TABLE media ADD COLUMN sha256 TEXT;
ALTER TABLE media ADD COLUMN published_at TEXT;

CREATE TABLE IF NOT EXISTS article_media (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  media_key TEXT NOT NULL REFERENCES media(key) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('cover', 'body')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  alt TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(article_id, media_key, role, position, revision)
);
CREATE INDEX IF NOT EXISTS article_media_by_media ON article_media(media_key);
CREATE INDEX IF NOT EXISTS article_media_by_article ON article_media(article_id, role, position);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_path TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- FTS5 trigram supports Chinese substring queries of 3+ Unicode characters.
-- Short 1–2 character queries are handled by the application's verified
-- n-gram fallback rather than being silently missed by the trigram tokenizer.
CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
  article_id UNINDEXED,
  title,
  description,
  tags,
  body,
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS articles_search_insert
AFTER INSERT ON articles
WHEN NEW.status = 'published' AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO article_search(article_id, title, description, tags, body)
  SELECT a.id, v.title, v.description, v.tags_json, v.body_markdown
  FROM article_versions v JOIN articles a ON a.id = v.article_id
  WHERE a.id = NEW.id AND a.published_revision = v.revision;
END;

CREATE TRIGGER IF NOT EXISTS articles_search_update
AFTER UPDATE ON articles
BEGIN
  DELETE FROM article_search WHERE article_id = OLD.id;
  INSERT INTO article_search(article_id, title, description, tags, body)
  SELECT NEW.id, v.title, v.description, v.tags_json, v.body_markdown
  FROM article_versions v
  WHERE NEW.status = 'published' AND NEW.deleted_at IS NULL
    AND NEW.published_revision = v.revision AND v.article_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS articles_search_delete
AFTER DELETE ON articles
BEGIN
  DELETE FROM article_search WHERE article_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS article_versions_search_insert
AFTER INSERT ON article_versions
WHEN EXISTS (SELECT 1 FROM articles a WHERE a.id = NEW.article_id AND a.status = 'published' AND a.deleted_at IS NULL AND a.published_revision = NEW.revision)
BEGIN
  DELETE FROM article_search WHERE article_id = NEW.article_id;
  INSERT INTO article_search(article_id, title, description, tags, body)
  VALUES (NEW.article_id, NEW.title, NEW.description, NEW.tags_json, NEW.body_markdown);
END;
