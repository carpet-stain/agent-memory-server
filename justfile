# Composition root — base-owned, never edited by an overlay (ADR-0020 in the
# template's source repo). Base verbs live in justfile.base; a language
# overlay drops its verbs in justfile.lang and the optional import picks it
# up — absent in a base-only repo, active the moment the overlay lands.
# justfile.release is the same optional-import shape, gated on
# include_release_automation instead of a language overlay.

import 'justfile.base'
import? 'justfile.lang'
import? 'justfile.release'

# List recipes when invoked with no arguments.
_default:
    @just --list
