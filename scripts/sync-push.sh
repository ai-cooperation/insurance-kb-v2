#!/bin/bash
# Safe push for this repo: the daily crawl advances origin/main every few
# hours and the working tree usually carries WIP files, so a naive
# `git push` fails on non-fast-forward and a naive `git pull --rebase`
# refuses on the dirty tree. This got fumbled 4+ times on 2026-07-31
# (each fumble also risks dispatching workflows against stale code).
#
# Usage: bash scripts/sync-push.sh
# Stashes dirty tracked files -> fetch -> rebase -> pop -> push (with the
# ai-cooperation account) -> switches back to AlanChen75.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DIRTY=$(git status --porcelain | awk '$1=="M"{print $2}')
if [ -n "$DIRTY" ]; then
  git stash push -m "sync-push wip" $DIRTY
fi

git fetch origin main
git rebase origin/main

if [ -n "$DIRTY" ]; then
  git stash pop
fi

gh auth switch -u ai-cooperation
git push origin main
gh auth switch -u AlanChen75
echo "sync-push done: $(git log --oneline -1)"
