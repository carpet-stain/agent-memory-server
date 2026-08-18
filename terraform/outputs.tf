output "cloud_run_uri" {
  description = "The Service's own *.run.app URL — not directly reachable (ingress locked to the load balancer); useful for infra#250's reachability checks and confirming the WIF `sub` claim once deployed."
  value       = google_cloud_run_v2_service.this.uri
}

output "neon_project_id" {
  value = neon_project.this.id
}

output "ssm_parameter_paths" {
  description = "Where the deployed service reads its own secrets from."
  value = {
    connection_uri = aws_ssm_parameter.connection_uri.name
    bearer_tokens  = aws_ssm_parameter.bearer_tokens.name
  }
}
