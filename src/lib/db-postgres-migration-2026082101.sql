-- Opaque, short-lived provider continuation state for the browser Precision CAD agent.
-- No provider credentials or browser-supplied filesystem paths are stored here.
CREATE TABLE IF NOT EXISTS nf_remote_agent_states (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nf_remote_agent_states_expiry
  ON nf_remote_agent_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_nf_remote_agent_states_owner
  ON nf_remote_agent_states(user_id, project_id, revision);

CREATE TABLE IF NOT EXISTS nf_remote_agent_tool_claims (
  state_handle TEXT NOT NULL,
  call_id TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (state_handle, call_id)
);

CREATE INDEX IF NOT EXISTS idx_nf_remote_agent_tool_claims_created
  ON nf_remote_agent_tool_claims(created_at);
