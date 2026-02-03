-- Entity log for cross-document tracking
CREATE TABLE IF NOT EXISTS entity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  normalized_text TEXT NOT NULL,
  label TEXT NOT NULL,
  original_text TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,  -- 1=anonymized, 0=de-anonymized
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, normalized_text)
);

CREATE INDEX IF NOT EXISTS idx_entity_log_user ON entity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_entity_log_text ON entity_log(normalized_text);
