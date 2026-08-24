# 0002. Terraform tool, backend, credentials, and apply discipline

Date: 2026-08-20

## Status

Accepted

Amended by 0004, 2026-08-23 (clause: CI credential tier; clause: migration mechanics; clause:
apply discipline; clause: GCP apply credential).

## Context

`terraform/` (landing in #7) is real infrastructure — a Neon project/role/database per agent, an
AWS SSM `/runtime/agent-memory/*` write path, and a consumer-owned `google_cloud_run_v2_service` —
with no recorded decision governing it. The tool is ambiguous: the directory is `terraform/`,
`versions.tf` pins `>= 1.9.0` with no runtime declared, and `AGENTS.md` says "terraform apply",
while the rest of the org's infra is OpenTofu-first. The backend is undeclared. Full CI apply (the
maintainer's explicit call) has no written credential, gating, or provider-cycle resolution. This
is the repo's first substantive decision record — it anchors epic #11 and the infra seam (#272)
that depend on it.

## Decision

**1. Tool — OpenTofu + tenv.** Keep `.tf` (tflint parses only `.tf`); adopt `tofu` via pinned
`tenv`; retarget `versions.tf`'s `required_version` to a tofu range; fix `AGENTS.md`'s "terraform
apply" wording.

**2. Backend — dedicated R2 bucket.** A repo-dedicated R2 bucket with its own scoped credential
(provisioned by #272), single key `agent-memory-server/terraform.tfstate`, client-side
`TF_ENCRYPTION` (`pbkdf2`/`aes_gcm`, infra ADR-0002).

**3. Credentials — GitHub OIDC, two federations, both plan/apply-split.**

- **AWS:** a `plan-read`/`apply` role pair (#272, mirroring infra ADR-0010) — plan-read trusts the
  PR sub, apply trusts main. Reads the Neon key + R2 creds from SSM, writes
  `/runtime/agent-memory/*`. No standing credential.
- **GCP:** a distinct plan-read WIF pool provider (#272) with its own `attribute_condition` = the
  PR sub and read-only SA bindings, referenced by the plan job; plus the apply path on main. The
  existing `agent-memory-deploy` deploy provider (`gcp/main.tf:166-180`, `#227`'s main-only pin)
  stays literally untouched — each provider admits only its own sub. We stop reusing
  `agent-memory-deploy` as tofu's `google`-provider credential (it's the image-push/deploy
  identity, ADR-0026 — over-scoped).
- **Neon key** — a separate `/runtime/agent-memory/neon-api-key`, not a cross-tier read of the
  shared `/infra/neon-api-key`. The rationale is trust-path isolation and independent rotation,
  explicitly not Neon-side least privilege: Neon keys are account/org-global (no project scoping),
  so a second key is more surface to rotate, not less power — the benefit is keeping a compromised
  agent-memory CI role off the `/infra` crown-jewel path.
- **Role×path (owner credential).** The runtime path `/runtime/agent-memory/*` holds only the
  `app` connection-uri and bearer tokens (readable by the serving SA's wildcard,
  `iam/main.tf:361-401`). The Neon admin/owner credential is never written to SSM — it lives only
  in encrypted R2 state and the CI apply job's ephemeral memory. The serving container can only
  ever obtain `app`.

**4. Apply discipline — saved-plan-on-merge, no environment gate.** Copy-adapt infra's
`tofu-plan.yml` and `tofu-apply.yml`: plan on PR uploads a tree-hash-keyed (ADR-0007) encrypted
plan artifact and PR comment; apply on merge-to-main consumes that exact artifact. No
`environment:` gate — infra's `tofu-apply.yml` has none; PR review plus merge to protected `main`
is the checkpoint. Copy-adapt strips infra-only machinery (`mint-app-token`, `derive-repo-list`,
the `github` provider — none apply here) and keeps the skeleton (tree-hash artifact, OIDC assume,
R2 + `TF_ENCRYPTION`, `**.tf` path filter, non-cancelling apply concurrency). Delivery: copy-adapt
now; consolidation into a shared pst tofu overlay is tracked by pst#116 and supersedes the copy
only once a dotfiles ADR relaxes ADR-0024 — built when it has two real consumers to migrate, not
speculatively for one. Interim copy-drift is the accepted cost.

**5. Chicken-and-egg — CI-run migration, drop the `postgresql` provider.** PR#7's `postgresql`
provider configures from same-run `neon_project` attributes — a same-run cycle. The `postgresql`
provider and `postgresql_grant_role` leave `terraform/` entirely. Tofu still creates `neon_role`
owner and app. The `GRANT owner TO app` and owner-owned schema bootstrap run as a post-apply
migration step in the CI apply job, connecting as the Neon admin (from a `sensitive` `tofu output`,
in-process) — never a runtime credential.

## Alternatives considered

- **Terraform proper** (decision 1) — diverges from infra's OpenTofu-first line; client-side state
  encryption is OpenTofu-only. Commit, don't drift.
- **Reusing infra's shared `tofu-state` R2 bucket** (decision 2) — R2 tokens scope per-bucket, so a
  shared bucket lets this repo's CI clobber infra's state (encryption is confidentiality, not
  integrity). A dedicated bucket keeps blast-radius posture consistent with the Neon key decision.
- **Cross-tier read of `/infra/neon-api-key`** (decision 3) — widens the crown jewel's blast
  radius and breaks ADR-0010's role×path matrix.
- **An `environment:` gate on apply** (decision 4) — redundant; PR review plus merge to protected
  `main` already gates the same human twice.
- **Advisory-plan-only / human-apply-only** (decision 4) — rejected; the maintainer's call is full
  CI apply.
- **`-target` two-phase apply** (decision 5) — non-idempotent snowflake first apply.
- **Split root modules** (decision 5) — a permanent second root plus `terraform_remote_state`
  coupling, a stale-output apply window on every coupled change, and no partial-failure retry
  story.
- **Grant in the server's boot `ensureSchema()`** (decision 5) — puts owner on the runtime-readable
  SSM path (a privilege regression) and races across autoscaled instances. The CI-run migration
  keeps the grant in one checked-in, CI-executed, auditable SQL migration — it satisfies the
  split-root alternative's "keep isolation in IaC" intent without a second root, and delivers the
  "server never holds owner" property the boot-grant alternative only promised.

## Consequences

- **Deploy-before-migrate ordering window.** A post-apply migration means `tofu apply` updates the
  Cloud Run service before the schema migration runs. Harmless on greenfield first apply (no
  traffic); backwards for any future schema-dependent rollout. Resolution lives in #11/#634 —
  migrate before flipping the service, or keep the image tolerant of a not-yet-migrated schema.
- **Server change (#634 dependency).** `ensureSchema()`-as-`app` is removed; schema and grant
  become CI-owned; serving pools stay `app`. This also fixes a latent bug (today `ensureSchema`
  runs as `app`, so tables are created owned by `app` and the owner/app split isn't realized) and
  removes the autoscale migration race. The migration must create objects as owner (`CREATE SCHEMA
... AUTHORIZATION owner` / `SET ROLE owner`) — connecting as admin and running bare DDL
  reproduces the ownership bug.
- **Containment is end-to-end only if #11 keeps it so.** The admin-URI `tofu output` must be
  `sensitive = true`, and the CI migration step must not echo `tofu output -raw` to the job log.
- **GCP plan-time auth is the one unproven leg.** The #272 seam that builds the plan-read pool
  provider doesn't exist yet, so it can't be pre-validated the way infra ADR-0022 validated every
  fork before Accepted. This ADR records Status Accepted with that leg flagged unproven and a
  throwaway plan-only validation gated into #11 before first real apply — a named divergence from
  ADR-0022's validate-first precedent, not left to drift.
- **Greenfield.** Backend is unconfigured, no `tfstate` exists, and PR#7 is unmerged, so there is
  no state migration; removing the `postgresql` provider is a clean edit before first apply.

See dotfiles ADR-0046 and infra ADR-0002, ADR-0003, ADR-0007, ADR-0010, ADR-0012, and ADR-0026 for
the conventions this decision builds on rather than re-argues.
