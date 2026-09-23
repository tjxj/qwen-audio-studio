-- 002_studio.sql — V2 metadata schema.
-- Applied against a freshly created temporary database, which is activated with an
-- atomic rename only after the v1 JSON import validates.

CREATE TABLE schema_migrations (
    version       INTEGER PRIMARY KEY,
    applied_at    TEXT    NOT NULL,
    source_digest TEXT,
    backup_id     TEXT
);

CREATE TABLE output_directories (
    id              TEXT PRIMARY KEY,
    canonical_path  TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    last_checked_at TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE settings (
    singleton_id         INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    revision             INTEGER NOT NULL DEFAULT 1,
    default_directory_id TEXT REFERENCES output_directories (id),
    default_params_json  TEXT    NOT NULL,
    script_font          TEXT    NOT NULL DEFAULT 'serif',
    script_font_size     INTEGER NOT NULL DEFAULT 16,
    max_workers          INTEGER NOT NULL DEFAULT 2,
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);

CREATE TABLE projects (
    id                         TEXT PRIMARY KEY,
    name                       TEXT NOT NULL,
    mode                       TEXT NOT NULL,
    prompt                     TEXT NOT NULL DEFAULT '',
    params_json                TEXT    NOT NULL,
    reference_bindings_json    TEXT    NOT NULL DEFAULT '[]',
    template_application_json  TEXT,
    output_directory_id        TEXT REFERENCES output_directories (id),
    revision                   INTEGER NOT NULL DEFAULT 1,
    archived                   INTEGER NOT NULL DEFAULT 0,
    deleted_at                 TEXT,
    final_job_id               TEXT,
    created_at                 TEXT NOT NULL,
    updated_at                 TEXT NOT NULL
);

CREATE TABLE jobs (
    id                      TEXT PRIMARY KEY,
    batch_id                TEXT,
    variant_index           INTEGER,
    project_id              TEXT NOT NULL REFERENCES projects (id),
    project_name            TEXT NOT NULL,
    display_name            TEXT NOT NULL,
    note                    TEXT    NOT NULL DEFAULT '',
    mode                    TEXT    NOT NULL,
    prompt                  TEXT    NOT NULL,
    compiled_prompt         TEXT    NOT NULL DEFAULT '',
    params_json             TEXT    NOT NULL,
    reference_snapshot_json TEXT    NOT NULL DEFAULT '[]',
    output_directory_id     TEXT REFERENCES output_directories (id),
    output_path_snapshot    TEXT,
    status                  TEXT    NOT NULL,
    stage                   TEXT,
    attempt                 INTEGER NOT NULL DEFAULT 1,
    output_asset_id         TEXT,
    report_json             TEXT,
    error_json              TEXT,
    elapsed_seconds         REAL,
    parent_job_id           TEXT,
    favorite                INTEGER NOT NULL DEFAULT 0,
    deleted_at              TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    UNIQUE (batch_id, variant_index)
);

CREATE INDEX idx_jobs_project ON jobs (project_id, created_at DESC);
CREATE INDEX idx_jobs_status ON jobs (status, created_at DESC);
CREATE INDEX idx_jobs_deleted ON jobs (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE generation_requests (
    client_request_id  TEXT PRIMARY KEY,
    request_hash       TEXT    NOT NULL,
    batch_id           TEXT    NOT NULL UNIQUE,
    project_id         TEXT    NOT NULL REFERENCES projects (id),
    project_revision   INTEGER NOT NULL,
    job_ids_json       TEXT    NOT NULL,
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL
);

CREATE TABLE assets (
    id             TEXT PRIMARY KEY,
    owner_type     TEXT NOT NULL,
    owner_id       TEXT NOT NULL,
    kind           TEXT NOT NULL,
    canonical_path TEXT NOT NULL,
    mime_type      TEXT NOT NULL,
    bytes          INTEGER NOT NULL,
    sha256         TEXT NOT NULL DEFAULT '',
    ownership      TEXT NOT NULL,
    hidden         INTEGER NOT NULL DEFAULT 0,
    deleted_at     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE INDEX idx_assets_owner ON assets (owner_type, owner_id);

CREATE TABLE imports (
    id              TEXT PRIMARY KEY,
    source_asset_id TEXT NOT NULL REFERENCES assets (id),
    metadata_json   TEXT    NOT NULL DEFAULT '{}',
    expires_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- "references" is a SQL keyword, so every occurrence of this table name stays quoted.
CREATE TABLE "references" (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    asset_id      TEXT NOT NULL REFERENCES assets (id),
    metadata_json TEXT    NOT NULL DEFAULT '{}',
    persistent    INTEGER NOT NULL DEFAULT 0,
    role_alias    TEXT,
    last_used_at  TEXT,
    expires_at    TEXT,
    deleted_at    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE reference_leases (
    job_id       TEXT NOT NULL REFERENCES jobs (id),
    reference_id TEXT NOT NULL REFERENCES "references" (id),
    released_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (job_id, reference_id)
);

CREATE TABLE upload_consents (
    id                      TEXT PRIMARY KEY,
    reference_ids_json      TEXT    NOT NULL,
    project_id              TEXT    NOT NULL REFERENCES projects (id),
    expires_at              TEXT    NOT NULL,
    consumed_by_request_id  TEXT,
    created_at              TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL
);

CREATE TABLE templates (
    id                          TEXT PRIMARY KEY,
    source                      TEXT NOT NULL,
    version                     INTEGER NOT NULL DEFAULT 1,
    name                        TEXT NOT NULL,
    mode                        TEXT NOT NULL,
    description                 TEXT NOT NULL DEFAULT '',
    tags_json                   TEXT    NOT NULL DEFAULT '[]',
    prompt_pattern              TEXT    NOT NULL,
    variables_json              TEXT    NOT NULL DEFAULT '[]',
    role_count                  INTEGER NOT NULL DEFAULT 1,
    suggested_duration_seconds  INTEGER,
    params_preset_json          TEXT,
    deleted_at                  TEXT,
    created_at                  TEXT NOT NULL,
    updated_at                  TEXT NOT NULL
);

CREATE INDEX idx_templates_mode ON templates (mode, source);

CREATE TABLE template_favorites (
    template_id TEXT PRIMARY KEY REFERENCES templates (id),
    created_at  TEXT NOT NULL
);

CREATE TABLE file_operations (
    id          TEXT PRIMARY KEY,
    action      TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    state       TEXT NOT NULL,
    moves_json  TEXT    NOT NULL DEFAULT '[]',
    error_code  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
