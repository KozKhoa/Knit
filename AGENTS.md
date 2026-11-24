# Knit — Agent Instructions

Desktop utility suite built with pure-Rust core crates (`crates/knit-*`), a thin Tauri v2 shell (`src-tauri`), and a React/TypeScript frontend (`src/`).

## Context Pointers

- **Boundaries & file safety (`RULES.md`):** Pure-Rust crate isolation (zero `tauri` imports), `AtomicOutput` (`.tmp` then rename, cleanup on cancel), Unicode NFC normalization, and case-insensitive collision checks → [`RULES.md`](RULES.md)
- **Domain glossary & docs (`docs/`):** Ubiquitous terms (`PageDraft`, `BookmarkNode`, `LosslessPassthrough`, `AtomicOutput`, `ScanFilter`, `RenamePlan`, `UndoManifest`), ADRs (`ADR-001`..`ADR-006`), and tool specs → [`docs/glossary.md`](docs/glossary.md), [`docs/README.md`](docs/README.md)
- **Visual tokens (`DESIGIN.md`):** Corporate flat aesthetic (`#007BFF`, `#343A40`, `#F8F9FA`, `4px` radius, `Lato` + `JetBrains Mono`, Lucide vector icons only) → [`DESIGIN.md`](DESIGIN.md)
- **UI primitives & interaction patterns (`src/`):** Custom controls (`Select`, `NumberInput`, `ConfirmModal`), pointer drag/resize, scroll containment, CodeMirror stretch, path display, and packaging conflicts → [`.agents/skills/knit-ui-patterns/SKILL.md`](.agents/skills/knit-ui-patterns/SKILL.md)
- **Large files, previews & RAM (`GB+` PDFs/images):** `mmap`, `HAYRO_CACHE_CAP`, `InterpreterCache` resets, `MetadataOnly` cache, viewport/preview virtualization, and PSS telemetry → [`.agents/skills/knit-perf-and-memory/SKILL.md`](.agents/skills/knit-perf-and-memory/SKILL.md)
- **Review feedback (`user-review/version-1-X.md`):** End-to-end 5-step intake, planning, implementation, gate, and report workflow → [`.agents/skills/knit-review-cycle/SKILL.md`](.agents/skills/knit-review-cycle/SKILL.md)
- **Safe refactoring & dirty worktree hygiene:** Preserving behavior and clean diffs → [`.agents/skills/safe-code-change/SKILL.md`](.agents/skills/safe-code-change/SKILL.md)
- **Pre-commit & pre-release verification:** Workspace tests, TypeScript build, Vitest, and `RULES.md` audit → [`.agents/skills/knit-qa-gate/SKILL.md`](.agents/skills/knit-qa-gate/SKILL.md)
- **Version bump, tagging & GitHub Releases:** Release checklist and CI workflow checks → [`.agents/skills/knit-release/SKILL.md`](.agents/skills/knit-release/SKILL.md)

## Cross-Cutting Invariants

- **Bilingual i18n Parity:** Add every user-facing string simultaneously to `src/i18n/types.ts`, `src/i18n/vi.ts` (full Vietnamese diacritics), and `src/i18n/en.ts`. Keep backend technical activity logs in English by default, and keep cancellation matching language-independent (`isJobCancelledError` / `KnitError::Cancelled`).
- **Per-Tool Job Isolation:** Scope busy and conflict locks to the active job or overlapping export paths (`findActiveExportConflicts`) so users can switch to and operate other tools while a background job runs.
- **Documentation Sync:** When adding a tool module or changing IPC schemas or architectural decisions, update `docs/README.md`, `docs/glossary.md`, `docs/specs/*.schema.json`, and `docs/decisions/ADR-*.md` in the same change.
