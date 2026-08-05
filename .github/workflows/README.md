# Workflow notes

- `cleanup-merged-agent-branches.yml` deletes only same-repository `agent/*` branches that have no open pull request and have at least one merged pull request targeting `main`.
- `agent-apply-card-feedback-fix.yml` is a one-time bootstrap workflow. It creates the implementation branch for the failed-card feedback fix and removes itself in that implementation branch.
