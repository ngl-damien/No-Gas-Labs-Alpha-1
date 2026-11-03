#!/usr/bin/env bash
# Manual rollback for ChatGPT Codex Ralph Loop

set -euo pipefail

echo "Available rollback points:"
git tag -l "rollback-iter-*" | sort -Vr | head -20

echo ""
echo "Enter iteration number to rollback:"
read -r ITER

TAG="rollback-iter-$ITER"
if ! git tag -l | grep -q "^$TAG$"; then
  echo "❌ Tag not found: $TAG"
  exit 1
fi

echo "⚠️  Rolling back to iteration $ITER"
echo "Type 'ROLLBACK' to confirm:"
read -r CONFIRM

if [ "$CONFIRM" != "ROLLBACK" ]; then
  echo "❌ Cancelled"
  exit 0
fi

# Create emergency backup
BACKUP_TAG="emergency-backup-$(date +%Y%m%d-%H%M%S)"
git tag "$BACKUP_TAG"
echo "✅ Emergency backup: $BACKUP_TAG"

# Rollback
git reset --hard "$TAG"
git push origin mirror --force-with-lease

echo "✅ Rolled back to iteration $ITER"
echo "To resume: restart ralph-codex-loop.sh"
