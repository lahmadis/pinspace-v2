-- Migration 008: Add organization_id columns alongside institution_id
-- Part 1 of P4.5 schema rename. Old columns remain for now.

ALTER TABLE workspaces ADD COLUMN organization_id UUID;
UPDATE workspaces SET organization_id = institution_id;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
CREATE INDEX workspaces_organization_id_idx ON workspaces(organization_id);

ALTER TABLE user_profiles ADD COLUMN organization_id UUID;
UPDATE user_profiles SET organization_id = institution_id;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
CREATE INDEX user_profiles_organization_id_idx ON user_profiles(organization_id);
