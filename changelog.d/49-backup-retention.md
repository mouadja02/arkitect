### Changed

- **Rebuilding a diagram no longer piles up backups beside it** (#49). Every
  build over an existing file wrote a sibling `<name>.backup-<stamp>.<ext>` and
  none was ever removed, so an agent's build, look, fix loop left ten or twenty
  in the user's project, where they end up in commits. Both builders still write
  a backup before every overwrite; once the new file is written they now keep the
  newest five backups of that file plus the oldest (usually the version from
  before the agent started), delete the rest and list them under `pruned` in the
  build report. `--keep-backups N` sets how many (`0` keeps all). Only names the
  builder writes for that exact file are ever deleted, ordered by their stamp and
  collision counter rather than as text, and nothing is pruned when a spec is
  refused or a flag is malformed. Within one second the collision counter now
  continues from the highest one used instead of filling a gap, so a counter
  freed by pruning is never reused and the newest backup can never sort among
  the oldest. `pruneBackups()` is exported by both engines.
  The docs suggest `*.backup-*` for a project's `.gitignore`.
