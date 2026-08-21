output "cloud_run_uri" {
  description = "The Service's own *.run.app URL — not directly reachable (ingress locked to the load balancer); useful for infra#250's reachability checks and confirming the WIF `sub` claim once deployed."
  value       = google_cloud_run_v2_service.this.uri
}

output "neon_project_id" {
  value = neon_project.this.id
}

# Containment (ADR-0002 decision 5): the admin credential exists only in
# encrypted state and the apply job's memory — never SSM, never echoed.
output "neon_admin_connection_uri" {
  description = "Neon default-admin URI against the agent database — the CI post-apply migration's GRANT/DDL identity."
  value       = "postgres://${neon_project.this.database_user}:${neon_project.this.database_password}@${neon_project.this.database_host}/${neon_database.this.name}?sslmode=require"
  sensitive   = true
}

output "neon_role_names" {
  description = "owner/app role names, for the migration's GRANT + SET ROLE."
  value = {
    owner = neon_role.owner.name
    app   = neon_role.app.name
  }
}

output "ssm_parameter_paths" {
  description = "Where the deployed service reads its own secrets from."
  value = {
    connection_uri = aws_ssm_parameter.connection_uri.name
    bearer_tokens  = aws_ssm_parameter.bearer_tokens.name
  }
}
