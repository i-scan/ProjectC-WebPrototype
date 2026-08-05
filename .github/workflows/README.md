# Workflow notes

- `cleanup-merged-agent-branches.yml` deletes only same-repository `agent/*` branches that have no open pull request and have at least one merged pull request targeting `main`.
- Unmerged branches and branches still referenced by an open pull request are retained.
