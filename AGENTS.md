# Repository Agent Instructions

- Do not stage changes unless the user explicitly asks you to stage them.
- Preserve the existing Git index. When editing a file that already has staged changes, leave the agent's edits unstaged on top of the user's staged version.
- Preserve user-authored comments exactly when moving or editing code. Do not delete or rewrite them unless the user explicitly asks.
- Keep README files focused on purpose and usage; do not duplicate implementation details already defined by source code or configuration.
- Prefer concrete implementations for MVP work. Do not introduce interfaces, adapters, dependency injection, duplicated shape types, or optional test hooks unless current production requirements include multiple implementations or persistent lifecycle state makes the abstraction necessary.
