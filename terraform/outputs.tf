# Sensitive: apply logs are public (issue #36) — reachability is ingress's
# job, keeping the hostname unpublished is this output's.
output "cloud_run_uri" {
  description = "The Service's own *.run.app URL — for infra#250's reachability checks and confirming the WIF `sub` claim once deployed."
  value       = google_cloud_run_v2_service.this.uri
  sensitive   = true
}

output "neon_project_id" {
  description = "Neon API handle for this project — nothing needs it in a public log (issue #36)."
  value       = neon_project.this.id
  sensitive   = true
}

# Containment (ADR-0002 decision 5): the credential exists only in
# encrypted state and the apply job's memory — never SSM, never echoed.
# Owner, not the project admin: Neon's admin holds no ADMIN OPTION on
# API-created roles, so owner connects and grants privileges itself.
output "neon_owner_connection_uri" {
  description = "owner-role URI against the agent database — the CI post-apply migration's DDL/grant identity; objects it creates are owner-owned by construction."
  value       = "postgres://${neon_role.owner.name}:${neon_role.owner.password}@${neon_project.this.database_host}/${neon_database.this.name}?sslmode=require"
  sensitive   = true
}

output "neon_role_names" {
  description = "owner/app role names, for the migration's privilege grants — login names are half a credential pair (issue #36)."
  value = {
    owner = neon_role.owner.name
    app   = neon_role.app.name
  }
  sensitive = true
}

output "bearer_minted" {
  description = "Per-slot mint timestamps — bearer-rotate.yml replaces the older slot (ADR-0003). Timestamps only, never token material."
  value       = { for slot, minted in time_static.bearer_minted : slot => minted.rfc3339 }
}

# Sensitive: interpolates var.agent_role, which the public source doesn't
# carry (issue #36).
output "ssm_parameter_paths" {
  description = "Where the deployed service reads its own secrets from."
  value = {
    connection_uri = aws_ssm_parameter.connection_uri.name
    bearer_tokens  = aws_ssm_parameter.bearer_tokens.name
  }
  sensitive = true
}
