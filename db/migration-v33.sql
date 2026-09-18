-- Run this migration on an existing V32 database before enabling V33.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role='super_admin' WHERE role='admin';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','sub_admin','super_admin'));

CREATE TABLE IF NOT EXISTS sub_admin_permissions (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
