# Consumer-side Neon TF (infra#204's boundary, reaffirmed by ADR-0046): the
# `project`/`role`/`connection_uri` live in THIS repo's state, never infra's
# CI-applied state. One Neon project per agent — the isolation boundary
# ADR-0046 v1 pins is the database, and a project of its own (not just a
# database within a shared project) means a compromised connection can't
# even enumerate a sibling agent's project.
resource "neon_project" "this" {
  name      = "agent-memory-${var.agent_role}"
  org_id    = var.neon_org_id
  region_id = var.neon_region_id

  # Provider defaults to 24h; the org's plan caps at 6h — creation 400s
  # above that.
  history_retention_seconds = 21600

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

# No postgresql provider here: it would authenticate from same-run
# neon_project attributes — a provider-configuration cycle. GRANT owner TO
# app and the schema bootstrap run as tofu-apply.yml's post-apply migration
# instead (ADR-0002 decision 5).

locals {
  # Neon's connection string shape: postgres://<role>:<password>@<host>/<database>?sslmode=require
  connection_uri = "postgres://${neon_role.app.name}:${neon_role.app.password}@${neon_project.this.database_host}/${neon_database.this.name}?sslmode=require"
}
