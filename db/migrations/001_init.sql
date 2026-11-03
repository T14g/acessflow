CREATE TABLE users (
  id CHAR(36) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  manager_id CHAR(36) NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email),
  CONSTRAINT users_role CHECK (role IN ('employee', 'manager', 'admin', 'security_analyst')),
  CONSTRAINT users_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT users_manager_fk FOREIGN KEY (manager_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY sessions_user (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE systems (
  id CHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY systems_code (code)
) ENGINE=InnoDB;

CREATE TABLE profiles (
  id CHAR(36) NOT NULL,
  system_id CHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  privileged TINYINT(1) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY profiles_system_code (system_id, code),
  CONSTRAINT profiles_system_fk FOREIGN KEY (system_id) REFERENCES systems (id)
) ENGINE=InnoDB;

CREATE TABLE sod_conflicts (
  id CHAR(36) NOT NULL,
  profile_a_id CHAR(36) NOT NULL,
  profile_b_id CHAR(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sod_pair (profile_a_id, profile_b_id),
  CONSTRAINT sod_a_fk FOREIGN KEY (profile_a_id) REFERENCES profiles (id),
  CONSTRAINT sod_b_fk FOREIGN KEY (profile_b_id) REFERENCES profiles (id)
) ENGINE=InnoDB;

CREATE TABLE access_requests (
  id CHAR(36) NOT NULL,
  requester_id CHAR(36) NOT NULL,
  beneficiary_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  justification VARCHAR(1000) NOT NULL,
  expires_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL,
  decision_by CHAR(36) NULL,
  decision_justification VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY requests_beneficiary_profile (beneficiary_id, profile_id, status),
  CONSTRAINT requests_status CHECK (status IN (
    'submitted', 'pending_approval', 'rejected', 'approved', 'provisioning', 'provisioned', 'failed'
  )),
  CONSTRAINT requests_requester_fk FOREIGN KEY (requester_id) REFERENCES users (id),
  CONSTRAINT requests_beneficiary_fk FOREIGN KEY (beneficiary_id) REFERENCES users (id),
  CONSTRAINT requests_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles (id),
  CONSTRAINT requests_decision_fk FOREIGN KEY (decision_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE access_grants (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL,
  active_marker TINYINT NULL,
  granted_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY grants_request (request_id),
  UNIQUE KEY grants_one_active (user_id, profile_id, active_marker),
  CONSTRAINT grants_status CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT grants_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT grants_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles (id),
  CONSTRAINT grants_request_fk FOREIGN KEY (request_id) REFERENCES access_requests (id)
) ENGINE=InnoDB;

CREATE TABLE risk_assessments (
  id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  recommendation VARCHAR(32) NOT NULL,
  findings JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY assessments_request (request_id),
  CONSTRAINT assessments_recommendation CHECK (recommendation IN ('require_approval', 'deny', 'allow_with_approval')),
  CONSTRAINT assessments_request_fk FOREIGN KEY (request_id) REFERENCES access_requests (id)
) ENGINE=InnoDB;

CREATE TABLE risk_alerts (
  id CHAR(36) NOT NULL,
  assessment_id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  code VARCHAR(60) NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY alerts_request (request_id),
  CONSTRAINT alerts_severity CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT alerts_assessment_fk FOREIGN KEY (assessment_id) REFERENCES risk_assessments (id),
  CONSTRAINT alerts_request_fk FOREIGN KEY (request_id) REFERENCES access_requests (id)
) ENGINE=InnoDB;

CREATE TABLE audit_events (
  id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY audit_entity (entity_type, entity_id),
  CONSTRAINT audit_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE outbox_events (
  id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(40) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  processed_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY outbox_pending (status, available_at),
  CONSTRAINT outbox_status CHECK (status IN ('pending', 'processing', 'processed', 'failed'))
) ENGINE=InnoDB;

CREATE TABLE directory_accounts (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  external_ref VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY directory_user (user_id),
  CONSTRAINT directory_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE directory_memberships (
  id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  grant_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY membership_grant (grant_id),
  CONSTRAINT membership_account_fk FOREIGN KEY (account_id) REFERENCES directory_accounts (id),
  CONSTRAINT membership_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles (id),
  CONSTRAINT membership_grant_fk FOREIGN KEY (grant_id) REFERENCES access_grants (id)
) ENGINE=InnoDB;
