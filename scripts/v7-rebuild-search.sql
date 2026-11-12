-- Rebuild the derived FTS5 index from authoritative article/version rows.
-- Run only against a local or explicitly isolated staging D1 after restoring
-- application tables. Never run this file against production without approval.
DELETE FROM article_search;

INSERT INTO article_search (article_id, title, description, tags, body)
SELECT a.id, v.title, v.description, v.tags_json, v.body_markdown
FROM articles AS a
JOIN article_versions AS v
  ON v.article_id = a.id
 AND v.revision = a.published_revision
WHERE a.status = 'published'
  AND a.deleted_at IS NULL
  AND a.published_at IS NOT NULL;
