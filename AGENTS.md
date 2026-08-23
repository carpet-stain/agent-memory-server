# agent-memory-server — Agent Guide

Hosted per-role agent memory: an MCP-over-HTTP server (TypeScript) on Neon Postgres, plus its
deploy IaC and consumer-side Neon Terraform. Realizes ADR-0046 (in `carpet-stain/dotfiles`) —
read that ADR before touching architecture here, not this file.

## Git workflow

This repo runs the standard carpet-stain git-flow base: short-lived branches off `main`, draft
PR at the first commit (`git pr --draft` or equivalent), commit freely, squash to one
[Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) when ready
(`git reset --soft origin/main && git commit`), finalize, rebase-merge. This doc is authoritative
over generic git conventions on conflict — see `carpet-stain/dotfiles`' `git.md`/`github.md` for
the baseline this instantiates.

- **Protected branch:** `main`.
- **Scopes:** `server` (MCP tool surface, store logic), `schema` (Postgres DDL), `auth`
  (bearer↔role mapping), `migrate` (JSONL↔Postgres import/reverse-dump/parity-diff), `deploy`
  (Dockerfile, Cloud Run), `tf` (Neon consumer Terraform), `ci`, `docs`, `adr`, `release`.
- **Version scheme:** SemVer, automated via git-cliff (`release-prepare.yml`/`release-publish.yml`,
  `cliff.toml`) — release automation is live in this repo.

## Credentials

`gh`/git operations use a scoped fine-grained PAT (Contents/Pull requests/Actions read-write, no
Administration) via `GH_TOKEN` in `.envrc.local` (copy `.envrc.local.example`). Elevate only for
the one action that needs admin (e.g. branch-protection bootstrap) with
`env -u GH_TOKEN -u GITHUB_TOKEN gh ...`, never as the session default.

Production secrets (Neon `connection_uri`, per-role bearer tokens) live in AWS SSM under
`/runtime/agent-memory/*` (infra#240's boundary) — the deployed server reads them at container
boot and re-reads only the bearer set on a minutes-scale TTL (ADR-0003), never per-request.
Nothing under `.envrc.local` is ever a production credential;
`DATABASE_URL_TEST` points at a disposable local/dockerized Postgres only.

## TypeScript toolchain

- `corepack enable && pnpm install` — pnpm version comes from `package.json`'s `packageManager`,
  node from `.node-version`.
- `just typecheck` — `tsc --noEmit`.
- `just lint` — full lefthook suite (base + lang, Biome for TS); CI's `lint.yml` runs
  `--tag base`, `test.yml` runs `--tag lang` plus the actual test run.
- `just test` — `pnpm run test` (vitest). Needs `DATABASE_URL_TEST` — the concurrency and
  round-trip tests run against a real Postgres (advisory locks aren't mockable), never a real
  Neon database.
- `just build` / `just dev` — compile to `dist/`, or run with reload via `tsx`.
- `just tofu` / `just tofu-apply` — OpenTofu against `terraform/`, behind the local secret gate;
  CI lint slice is `just lint --tag tofu`. Conventions: `docs/CODING.md`.

## Where things live

- `src/db/` — schema (`schema.sql`), the `KnowledgeGraphStore` (Postgres-backed, every mutating
  method serializes under `pg_advisory_xact_lock` per ADR-0046), connection pooling.
- `src/tools.ts` — the 9-tool MCP surface, mirroring `@modelcontextprotocol/server-memory`'s
  contract (the reference server this replaces) with `entityType` narrowed to ADR-0033's four
  pointer types.
- `src/auth.ts` / `src/config.ts` / `src/registry.ts` — bearer→role→store resolution. Pools are
  fixed at boot; the bearer set refreshes on a short TTL so a rotation (`bearer-rotate.yml`,
  ADR-0003) reaches running instances without a redeploy.
- `src/server.ts` — the streamable-HTTP endpoint (stateless: one `McpServer`+transport per
  request, matching a horizontally-scaled Cloud Run deployment with no sticky sessions).
- `src/migrate/` — JSONL→Postgres import, the reverse dump (post-cutover rollback path), and the
  quiesced bidirectional parity diff migration/verify depends on.
- `terraform/` — consumer-side Neon `project`/`role`/`connection_uri` and the
  `google_cloud_run_v2_service` resource, per infra#240's consumer/infra boundary. Applied by CI
  via saved-plan-on-merge (`tofu-plan.yml`/`tofu-apply.yml`, ADR-0002); `docs/CODING.md` is
  authoritative over generic Terraform conventions.
- `docs/adr/` — this repo's own ADRs. Point at `carpet-stain/dotfiles`' ADR-0046/0033 rather than
  re-deriving their content; write a new ADR here only for a decision specific to this repo's own
  implementation (e.g. HTTP framework choice, if it ever changes).
