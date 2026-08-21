#!/usr/bin/env bash
# Local secret gate for the tofu verbs (docs/CODING.md), mirroring infra's
# with-infra-secrets.sh: an AWS keypair from the macOS Keychain, the
# /cicd/agent-memory/* set from SSM, then exec the wrapped command with the
# backend/provider/encryption env exported. Every Keychain read prompts (no
# ACL whitelisting), so an unattended shell fails closed.
set -euo pipefail

[[ $# -gt 0 ]] || {
  echo "usage: with-tofu-secrets.sh <command> [args...]" >&2
  exit 2
}

# Keypair that can read /cicd/agent-memory/* + kms:Decrypt on
# alias/cicd-secrets — see docs/CODING.md §Local runs.
keychain_item="${WITH_TOFU_SECRETS_KEYCHAIN_ITEM:-infra-aws-local-apply}"

aws_key_id="$(security find-generic-password -s "$keychain_item" | sed -n 's/.*"acct"<blob>="\(.*\)"/\1/p')"
aws_secret="$(security find-generic-password -s "$keychain_item" -w)"
if [[ -z "$aws_key_id" || -z "$aws_secret" ]]; then
  echo "error: Keychain item '$keychain_item' missing or empty" >&2
  exit 1
fi

# Local runs always use the read-write R2 pair, like infra's own gate — the
# read-only pair exists for CI's PR-triggered plan job.
prefix="/cicd/agent-memory"

# Per-name GetParameter, not batch GetParameters — matches the singular
# action the infra#272 grants carry (same adaptation as read-ssm-params).
param() {
  local value
  value="$(AWS_ACCESS_KEY_ID="$aws_key_id" AWS_SECRET_ACCESS_KEY="$aws_secret" AWS_REGION=us-east-1 \
    aws ssm get-parameter --with-decryption --name "$1" --query Parameter.Value --output text)" || {
    echo "error: failed reading SSM parameter: $1" >&2
    exit 1
  }
  if [[ -z "$value" || "$value" == "PLACEHOLDER" ]]; then
    echo "error: $1 is empty or still PLACEHOLDER — populate it (infra docs/BOOTSTRAP.md §19)" >&2
    exit 1
  fi
  printf '%s' "$value"
}

neon_api_key="$(param "$prefix/neon-api-key")"
passphrase="$(param "$prefix/tf-state-passphrase")"
r2_key_id="$(param "$prefix/r2-apply-access-key-id")"
r2_token="$(param "$prefix/r2-apply-storage-token")"
r2_account="$(param "$prefix/r2-account-id")"

# R2's S3-compatible secret is sha256(token value), not the token itself.
r2_secret="$(printf '%s' "$r2_token" | shasum -a 256 | cut -d' ' -f1)"

creds_file="$(mktemp)"
trap 'rm -f "$creds_file"' EXIT
chmod 600 "$creds_file"
printf '[r2-backend]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
  "$r2_key_id" "$r2_secret" >"$creds_file"

# Split: the backend resolves profile r2-backend (versions.tf) from this
# file; the aws provider (SSM/KMS) takes the Keychain pair via env.
export AWS_SHARED_CREDENTIALS_FILE="$creds_file"
export AWS_ACCESS_KEY_ID="$aws_key_id"
export AWS_SECRET_ACCESS_KEY="$aws_secret"
export AWS_REGION=us-east-1
export AWS_ENDPOINT_URL_S3="https://${r2_account}.r2.cloudflarestorage.com"
export NEON_API_KEY="$neon_api_key"

# shellcheck disable=SC2089,SC2090 # the quotes ARE the payload — this is HCL, not shell
TF_ENCRYPTION='
key_provider "pbkdf2" "state" {
  passphrase = "'"$passphrase"'"
}
method "aes_gcm" "state" {
  keys = key_provider.pbkdf2.state
}
state {
  method   = method.aes_gcm.state
  enforced = true
}
plan {
  method   = method.aes_gcm.state
  enforced = true
}'
# shellcheck disable=SC2090 # same — literal quotes intended
export TF_ENCRYPTION

exec "$@"
