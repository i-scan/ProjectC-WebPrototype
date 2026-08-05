# Branch cleanup convention

Code changes use temporary `agent/*` branches and pull requests. After a pull request is merged into `main`, the cleanup workflow deletes its branch when no open pull request still references it. Unmerged branches are retained.
