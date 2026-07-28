#!/usr/bin/env bash
# Millionaires' Row — step 4: dump the finished `mrow` database to
# data/seed/mrow.dump (pg_dump custom format) for production seeding.
# Idempotent: overwrites the dump each run.
#
# Restore with:  pg_restore -d mrow --no-owner --no-acl data/seed/mrow.dump
#
# Usage: scripts/dump_seed.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
OUT=data/seed/mrow.dump

mkdir -p data/seed

echo "==> pg_dump -Fc $DB -> $OUT"
docker exec -i "$CONTAINER" pg_dump -U mrow -d "$DB" -Fc --no-owner --no-acl \
  > "${OUT}.part"
mv "${OUT}.part" "$OUT"

SIZE_H=$(du -h "$OUT" | cut -f1)
SIZE_B=$(wc -c < "$OUT" | tr -d ' ')
echo "==> wrote $OUT ($SIZE_H / $SIZE_B bytes)"

echo "==> verifying dump"
# pg_restore needs a seekable file, so stage it inside the container.
docker exec -i "$CONTAINER" sh -c \
  'cat > /tmp/mrow_verify.dump && pg_restore -l /tmp/mrow_verify.dump; rc=$?; rm -f /tmp/mrow_verify.dump; exit $rc' \
  < "$OUT" | grep -E 'TABLE DATA|INDEX'
