# Single hand-maintained justfile — the template's base/lang/release overlay
# split is collapsed here (infra's shape): lefthook tags, not file layout,
# scope each CI slice.

# List recipes when invoked with no arguments.
_default:
    @just --list

# Run every pre-commit check (CI slices scope by tag: lint.yml `--tag base`,
# test.yml `--tag lang`, tofu-lint.yml `--tag tofu`).
lint *args:
    lefthook run pre-commit --all-files {{ args }}

# Create a numbered ADR from the template: `just adr "Short decision title"`.
adr *args:
    scripts/new-adr.sh {{ args }}

# Auto-format markdown with prettier (fixes what md-format only checks).
# Manual, deliberately NOT a lefthook job: `just lint` (and CI's lint job) run
# `lefthook run pre-commit --all-files`, and `prettier --write` always exits 0
# — hooking it would make md-format stop gating format in CI (dotfiles#406).
# Scoped via git ls-files to tracked markdown only, mirroring md-format's
# excludes (CHANGELOG is git-cliff-generated, agent-memory is heredoc notes).
format:
    git ls-files -z '*.md' ':!:CHANGELOG.md' ':!:.claude/agent-memory/**' | xargs -0 prettier --write

# Run the test suite (needs DATABASE_URL_TEST — see .envrc.local.example).
test *args:
    pnpm run test {{ args }}

# Type-check the project (vitest/tsx never do — tsc is the only checker).
typecheck:
    pnpm exec tsc --noEmit

# The `format` verb owns markdown; format TypeScript sources with Biome.
fmt:
    pnpm run format

# Build to dist/ (the Dockerfile's input).
build:
    pnpm run build

# Run the server locally with reload.
dev:
    pnpm run dev

# Preview the version + changelog release automation would compute (no side effects).
cliff-preview *args:
    git cliff --bump {{ args }}

# OpenTofu verbs — conventions in docs/CODING.md; both wrap
# `tofu -chdir=terraform` behind the local secret gate.

# Read-only passthrough (plan, output, state list…) — mutations are rejected
# so the only apply path is the explicit verb below (or CI's saved plan).
tofu *args:
    @case "{{ args }}" in (apply|apply\ *|destroy|destroy\ *) echo "error: mutations go through 'just tofu-apply'" >&2; exit 1 ;; esac
    scripts/with-tofu-secrets.sh tofu -chdir=terraform {{ args }}

tofu-apply *args:
    scripts/with-tofu-secrets.sh tofu -chdir=terraform apply {{ args }}
