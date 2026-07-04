-- Plataforma de estudo C_TS452 — schema v2 (do zero)

DROP TABLE IF EXISTS attempts;
DROP TABLE IF EXISTS fsrs_state;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS concepts;

-- Conceitos individuais (a unidade que o FSRS rastreia)
CREATE TABLE concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  weight_pct REAL NOT NULL,
  title TEXT NOT NULL,
  production_rule TEXT,
  fiori_app_name TEXT,
  work_case_ref TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Estado FSRS por conceito
CREATE TABLE fsrs_state (
  concept_id INTEGER PRIMARY KEY REFERENCES concepts(id),
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',
  last_review TEXT,
  due TEXT
);

-- Histórico de tentativas (alimenta o FSRS e o "o que eu mais erro")
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id INTEGER REFERENCES concepts(id),
  session_id INTEGER,
  rating INTEGER NOT NULL,
  scenario_text TEXT,
  user_answer TEXT,
  ai_evaluation TEXT,
  correct INTEGER,
  answered_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sessões de estudo
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  mode TEXT
);

CREATE INDEX idx_attempts_concept ON attempts(concept_id);
CREATE INDEX idx_attempts_session ON attempts(session_id);
