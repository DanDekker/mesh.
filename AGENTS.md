- Keep commit messages brief.
- Author commits using neutral project contributor attribution.
- Do not add co-author trailers or tool attribution to commits.
- Keep the project dependency-free and run `bun run check` before committing.

## Standing privacy rule

Keep the operator's personal name, email, and identifying handles out of source,
documentation, embedded prompts, fixtures, generated artifacts, logs, process
arguments, service labels, and future commit attribution. Use project-owned
identifiers and neutral project contributor attribution. Scrub existing personal
references when found, including generated and installed copies; update their
source so a rebuild or reinstall cannot restore them. Do not repeat removed
identifiers in migration constants, tests, or cleanup notes. Preserve unrelated
work, log destructive changes, and verify changed code and installed runtimes.

Use repository-relative documentation links and configured repository information
instead of hardcoded personal accounts. Authentication identities and Git remote
addresses must remain valid; do not fabricate replacement accounts or rewrite
existing Git history as part of an ordinary source cleanup.
