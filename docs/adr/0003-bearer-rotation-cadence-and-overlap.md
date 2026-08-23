# 0003. Bearer rotation cadence and overlap

Date: 2026-08-23

## Status

Accepted

## Context

ADR-0046 (dotfiles) priced the hosted move at "a leaked role token grants full read+write of
that role's entire private memory" and listed rotatable tokens among the operational
mitigations. Issue #32 builds the rotation; the parameters it leaves open — cadence, overlap,
and how a running server learns about a rotation — are this ADR.

The failure mode to design against is a lapsed token mid-session: ADR-0041's vended `gh` token
has a documented recurring ~1h dead window (dotfiles#453) that strands long-lived shells, and
here that failure is silent in the worst way — the session keeps running and stops recording.
The deployed server also reads its secrets from SSM once at boot (infra#240: cold p95 is what
the cost kill-switch gates), so rotation must reach running instances without either a
redeploy or a per-request SSM read.

## Decision

**Cadence: weekly. Overlap: one full cadence — every token lives 14 days, the last 7 as the
"previous" token.** Mechanism:

- Terraform holds two token slots (`random_password.bearer_token["a"|"b"]`), each paired with
  a `time_static` mint timestamp. The SSM `bearer-tokens` value is the pair, newest-first.
- `bearer-rotate.yml` runs weekly and `-replace`s the **older** slot, `-target`ed to the
  bearer SSM parameter. Exactly one slot rotates per run by construction, so a missed run can
  only extend a token's life — it can never rotate both slots at once and break the overlap.
  The `-target` scope is also why the unattended apply needs no reviewer gate: it cannot plan
  a Neon or Cloud Run resource.
- The server caches the token set with a 5-minute TTL and re-reads it on an unknown token
  (30s cooldown against garbage-token spam). Validation compares sha256 digests with
  `timingSafeEqual` across the whole set, no early exit.

Why these numbers:

- **Overlap 7 days** — the longest realistic agent session is hours; a multi-day-weekend
  session is the ceiling. 7 days clears that ceiling several times over and dwarfs the ~1h
  dead window that made dotfiles#453 hurt. An in-flight session holding the previous token
  outlives any plausible run.
- **Cadence 7 days** — bounds a leaked token at ≤14 days of use versus unbounded today; weekly
  is the natural granularity for a scheduled Actions run, and one rotation per week keeps the
  rotation applies rare enough to audit by hand.
- **TTL 5 minutes / cooldown 30s** — a rotated-out token dies at most minutes after its
  overlap ends, noise against a 7-day overlap, while the steady-state request path stays
  boot-cached per infra#240.

Expiry is an explicit `401 {"error":"invalid bearer token"}` — the client's re-vend signal
(dotfiles#671 owns the client half), never a silent no-op write.

## Alternatives considered

- **OAuth / short-lived issued credentials** — ADR-0046's named revisit path, rejected with
  the maintainer 2026-08-22: a whole auth subsystem, and its trigger ("the static-bearer
  posture stops holding") hasn't fired. Short-TTL rotation gets most of the benefit without
  reopening the ADR.
- **Two `time_rotating` resources, phase-offset** — the declarative-looking version. Rejected:
  a lapse in scheduled applies longer than the offset expires both slots and rotates them in
  the same apply, invalidating every issued token at once — exactly the mid-session failure
  this design exists to prevent. Replace-the-older is immune by construction.
- **Per-request SSM read** — trivially fresh, rejected by infra#240's boot-cache requirement.
- **Redeploy on rotation** — couples a weekly credential event to the deploy pipeline and
  violates the issue's no-redeploy acceptance; the TTL refresh is two orders of magnitude
  cheaper.

## Consequences

- A leaked bearer is now bounded at 14 days; revocation-on-demand is one manual
  `bearer-rotate.yml` dispatch twice a week apart (or an immediate `-replace` of both slots
  via `tofu-apply-dispatch.yml`, accepting the mid-session break).
- Clients must tolerate a 401 by re-vending from SSM (dotfiles#671); a client that caches a
  token >7 days past mint without re-vending will break — by design, loudly.
- The rotation workflow is a second unattended apply path; its safety rests on the `-target`
  scope. Widening that scope re-raises the reviewer-gate question — don't widen it silently.
- Revisit the cadence downward (and the ADR-0046 OAuth trigger) if the roster grows beyond a
  handful of roles or a token actually leaks.
