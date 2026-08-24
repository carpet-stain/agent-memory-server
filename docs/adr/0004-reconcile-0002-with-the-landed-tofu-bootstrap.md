# 0004. Reconcile 0002 with the landed tofu bootstrap

Date: 2026-08-23

## Status

Accepted. Amends 0002 (clause: CI credential tier; clause: migration mechanics; clause: apply
discipline; clause: GCP apply credential).

## Context

ADR-0002 was accepted before the first apply. The bootstrap that landed across #18 and
the #20–#26 first-apply shakeout diverged from four of its clauses and aged two of its
Consequences;
a fresh reader following 0002 alone builds a false picture of the credential model, the apply
discipline, and the migration mechanism. This ADR records the reversals and why each happened —
0002's overall decision (tool, backend, CI-run migration) stays live, so this is an amendment
under project-starter-template's convention (`docs/adr/README.md` there, landed by pst#125),
not a supersession.

Reconciliation context, not a drift: `store_password = "yes"` landed because the Neon API 400s
on the opt-out (`terraform/neon.tf` owns that fact). 0002's "the Neon admin/owner credential is
never written to SSM" is SSM-side custody and remains true — Neon-side retention was never in
its scope.

## Decision

**1. CI credential tier (amends decision 3).** The CI credential is a whole `/cicd/agent-memory/*`
tier — neon-api-key, tf-state-passphrase, and the R2 plan/apply pairs, under the
`alias/cicd-secrets` KMS key — not the single `/runtime/agent-memory/neon-api-key` leaf 0002
named. The tier exists because plan and apply need distinct R2 credentials and none of these
belong on the runtime-readable path. The role×path clause is untouched: `/runtime` still holds
only the `app` connection-uri and bearers, readable by the serving SA alone.

**2. Migration mechanics (amends decision 5).** The post-apply migration connects as **owner**
and grants **privileges, not membership**: `GRANT USAGE`, table DML, and
`ALTER DEFAULT PRIVILEGES` to `app` (`tofu-apply.yml`). The recorded admin-connection
`GRANT owner TO app` is impossible — see Alternatives. Decision 5's consequence still holds and
is realized in code (#26): `ensureSchema()`-as-`app` is removed, schema and grants are CI-owned,
serving pools stay `app`.

**3. Apply discipline (amends decision 4).** The merge path (`tofu-apply.yml`) holds decision 4
verbatim: it consumes the exact reviewed artifact, ungated. The reversal is scoped to the
dispatch escape hatch: `tofu-apply-dispatch.yml` runs behind `environment: tofu-apply-dispatch`
and re-plans fresh, because by construction no reviewed artifact exists for a manual dispatch.
The rejected-alternative reasoning ("a gate is redundant") survives for the merge path; it just
isn't universal.

**4. GCP apply credential (amends decision 3).** Apply reuses `agent-memory-deploy` as tofu's
`google`-provider credential (infra#272 decision 4), reversing "we stop reusing" it.
The deploy identity already carries `run.developer` plus `actAs` on the runtime SA; the marginal
extra AR-writer scope was accepted over minting a separate apply SA. 0002's over-scoped
objection was real and knowingly traded away — traded, not wrong. The plan-read half of
decision 3 (distinct plan-read WIF provider) landed as written.

**Aged Consequences, corrected.** The migration credential output is
`neon_owner_connection_uri` — owner, not admin, and `sensitive` as required. GCP plan-time auth
is no longer unproven: `tofu-plan.yml` federates through the plan-read WIF provider and has
applied for real.

## Alternatives considered

- **Superseding 0002** — marks the whole ADR dead while its tool, backend, and CI-run-migration
  decisions are live, and forces restating them verbatim. pst's convention is explicit: a
  clause-level reversal amends; supersession is for a replaced decision.
- **Editing 0002's Decision in place** — hides that a reversal happened, and the section sits at
  479 words against pst's 500-word cap; 21 words is no room for reconciliation prose.
- **infra#286's inline `## Amendment — #N` style** — explicitly deprecated by pst#125 in favor
  of the amending-ADR convention this file uses.
- **Keeping `GRANT owner TO app` from the admin connection** (the amended decision 5) — not a
  choice: Neon's project admin holds no ADMIN OPTION on API-created roles, so the grant fails
  from the admin connection. Owner-connected privilege grants deliver the same property —
  `app` reads and writes owner-owned tables, never owns them — without membership.

## Consequences

- 0002 is readable only alongside this ADR; its Status carries the reciprocal dated marker
  routing readers here. `reusable-adr-guard.yml@v1` greps only `Supersedes NNNN` — the two-file
  marker discipline is manual.
- Amended clauses are recorded once, here; 0002's body stays unedited, so the pre-apply
  reasoning remains walkable.
- If Neon ever grants ADMIN OPTION on API-created roles (or supports `store_password` opt-out),
  revisit clauses 2 and the Context note respectively.
