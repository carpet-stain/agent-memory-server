# Consumer-side Neon TF (infra#204's boundary, reaffirmed by ADR-0046): the
# `project`/`role`/`connection_uri` live in THIS repo's state, never infra's
# CI-applied state. One Neon project per agent — the isolation boundary
# ADR-0046 v1 pins is the database, and a project of its own (not just a
# database within a shared project) means a compromised connection can't
# even enumerate a sibling agent's project.
resource "neon_project" "this" {
  name      = "agent-memory-${var.agent_role}"
  region_id = var.neon_region_id

  # Password storage handled by SSM below, not Neon's own state-side store.
  store_password = "no"
}

# Owner role — never handed to the server. Table/database owners bypass row-
# level security (issue #634's own reasoning for requiring a non-owner
# connection), so the identity that owns the schema and the identity that
# runs queries against it must differ even though v1 has no RLS policies
# yet — this keeps adding one later a policy change, not an isolation-model
# change.
resource "neon_role" "owner" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = "${replace(var.agent_role, "-", "_")}_owner"
}

resource "neon_database" "this" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = replace(var.agent_role, "-", "_")
  owner_name = neon_role.owner.name
}

# The role the wrapper actually connects as.
resource "neon_role" "app" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = "${replace(var.agent_role, "-", "_")}_app"
}

# Grants `app` membership in `owner` (INHERIT, the postgresql_grant_role
# default) so it can read/write everything `owner` creates — present and
# future tables both, since this is live role-membership, not a point-in-
# time privilege snapshot — without ever being able to act as `owner` for
# RLS-bypass purposes (that check is by literal role identity, not inherited
# privilege).
#
# KNOWN GAP, not applied by this session: this provider block authenticates
# as neon_project.this's own default admin role, a resource attribute
# created in this same apply. Terraform/OpenTofu provider configuration
# generally can't depend on a resource from the same run — this either needs
# `-target=neon_project.this,neon_role.owner,neon_role.app` on a first apply
# before the rest, or the grant moves to a post-apply step in the deploy
# workflow. Flagging for whoever runs the first real apply rather than
# guessing which fix this org prefers.
provider "postgresql" {
  host      = neon_project.this.database_host
  port      = 5432
  username  = neon_project.this.database_user
  password  = neon_project.this.database_password
  database  = neon_project.this.database_name
  superuser = false
  sslmode   = "require"
}

resource "postgresql_grant_role" "app_inherits_owner" {
  role       = neon_role.app.name
  grant_role = neon_role.owner.name
}

locals {
  # Neon's connection string shape: postgres://<role>:<password>@<host>/<database>?sslmode=require
  connection_uri = "postgres://${neon_role.app.name}:${neon_role.app.password}@${neon_project.this.database_host}/${neon_database.this.name}?sslmode=require"
}
