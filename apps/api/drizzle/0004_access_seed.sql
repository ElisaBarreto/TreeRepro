INSERT INTO permissions (key, description) VALUES
  ('users.read', 'List and view users'),
  ('users.invite', 'Invite users'),
  ('users.update', 'Edit user profiles and roles'),
  ('users.suspend', 'Suspend and reactivate users'),
  ('users.delete', 'Erase users'),
  ('roles.read', 'List roles and the permission catalog'),
  ('roles.manage', 'Create, edit and delete roles'),
  ('sessions.read', 'List any user''s sessions'),
  ('sessions.revoke', 'Revoke any user''s sessions'),
  ('audit.read', 'Read the audit log'),
  ('admin.access', 'Open the admin area');
--> statement-breakpoint
INSERT INTO roles (name, description, is_system) VALUES
  ('admin', 'Full access to every permission, including future ones.', true);
