# Coding standards — Terraform/OpenTofu

Instantiates the generic Terraform conventions with this repo's concrete choices; authoritative
here on conflict. The decisions and their rejected alternatives: ADR-0002. The infra-side seam
(roles, state bucket, `/cicd` tier): carpet-stain/infra#272.

## Tool

OpenTofu, installed via tenv — it resolves `terraform/versions.tf`'s
`required_version = "~> 1.12"` pin. Files stay `.tf` (tflint parses only the shared extension).
`terraform/` is a single flat root module; extract a child module only at a real reuse boundary.

## State backend

- Dedicated R2 bucket `agent-memory-tofu-state` (infra#272), key
  `agent-memory-server/terraform.tfstate`, `use_lockfile` locking.
- The backend block commits only non-identifying values and names
  `profile = "r2-backend"`; the secret gate writes that profile (R2 key id +
  sha256 of the token) to a temp credentials file behind `AWS_SHARED_CREDENTIALS_FILE`,
  and the endpoint rides `AWS_ENDPOINT_URL_S3` from `/cicd/agent-memory/r2-account-id`.
  The `aws` provider keeps the ambient env credentials — that split is why raw keys
  never appear in backend config (they'd embed in the saved plan; infra#164).
- State **and** plan files are client-side encrypted: `TF_ENCRYPTION` (pbkdf2 key
  provider + aes_gcm, `enforced = true` for both), built by the gate from
  `/cicd/agent-memory/tf-state-passphrase`. Env-only — never in a `.tf` file.

## Credentials

No standing credential in this repo (ADR-0002 decision 3):

- **CI** assumes `agent-memory-plan-read` (PR sub) / `agent-memory-apply` (main sub) via
  GitHub OIDC — `vars.AWS_PLAN_ROLE_ARN` / `vars.AWS_APPLY_ROLE_ARN` — and reads the
  `/cicd/agent-memory/*` set from SSM. GCP plan-time refresh federates through the
  read-only plan-read WIF provider (`vars.GCP_PLAN_WIF_PROVIDER` + `vars.GCP_PLAN_SA_EMAIL`);
  apply reuses the deploy identity (`vars.GCP_DEPLOY_WIF_PROVIDER` + `vars.GCP_DEPLOY_SA_EMAIL`).
- **Local runs**: `scripts/with-tofu-secrets.sh` reads an AWS keypair from the macOS
  Keychain (item `infra-aws-local-apply`; override with `WITH_TOFU_SECRETS_KEYCHAIN_ITEM`)
  and fetches the same params. The keypair needs read on `/cicd/agent-memory/*` plus
  `kms:Decrypt` on `alias/cicd-secrets`.
- Non-secret tofu inputs (the four `TF_VAR_*`) live in `.envrc.local` locally and as repo
  variables in CI — see `.envrc.local.example`.
- The Neon admin credential exists only in encrypted state and the apply job's memory —
  never SSM (ADR-0002 decision 5).

## Verbs

- `just tofu <args>` — read-only passthrough (`plan`, `output`, `state list`, …); rejects
  `apply`/`destroy`.
- `just tofu-apply <args>` — the local mutation path.

Both wrap `tofu -chdir=terraform` behind the secret gate.

## Apply discipline

Saved-plan-on-merge (ADR-0002 decision 4): `tofu-plan.yml` plans on PR and uploads a
tree-hash-keyed encrypted plan artifact plus a PR comment; `tofu-apply.yml` applies exactly
that artifact on merge-to-main — no re-plan, no `environment:` gate. A merged tree with no
artifact hard-fails; `tofu-apply-dispatch.yml` (required-reviewer Environment) is the escape
hatch. The apply job then runs the post-apply migration — `GRANT owner TO app` and
`src/db/schema.sql` under `SET ROLE owner` — as the Neon admin from the sensitive
`neon_admin_connection_uri` output, masked and never echoed (decision 5).

## Lint

`just lint --tag tofu` (the tofu-tagged lefthook.yml jobs): `tofu fmt -check`, `tflint` (bundled ruleset
defaults, no `.tflint.hcl`), `trivy config`. CI slice: `tofu-lint.yml`. Never `fmt -recursive`
or whole-tree scans — they descend into `.claude/worktrees` copies. There's no standalone
`validate` job: CI's `tofu plan` subsumes it.

## Pins and contracts

`~>` pessimistic provider pins in `terraform/versions.tf` with the committed
`.terraform.lock.hcl` as the reproducibility gate — upgrades are deliberate `init -upgrade`
diffs, never a side effect. Every variable and output carries `type` + `description`;
`validation` blocks for constraints types can't express; `sensitive = true` on anything
secret-shaped.
