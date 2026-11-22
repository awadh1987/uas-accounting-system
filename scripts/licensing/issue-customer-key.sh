#!/usr/bin/env bash
set -euo pipefail

SLUG="${1:?Usage: $0 <tenant-slug> <company-name> [admin-email] [plan] [expires-at]}"
COMPANY_NAME="${2:?Usage: $0 <tenant-slug> <company-name> [admin-email] [plan] [expires-at]}"
ADMIN_EMAIL="${3:-admin@${SLUG}.qat.world}"
PLAN="${4:-enterprise}"
EXPIRES_AT="${5:-2027-12-31}"

cd /var/www/uas-qat

node scripts/licensing/issue-license.mjs \
  --slug "$SLUG" \
  --company "$COMPANY_NAME" \
  --admin-email "$ADMIN_EMAIL" \
  --plan "$PLAN" \
  --expires "$EXPIRES_AT"

if [ -d "/var/www/uas-qat/.next/standalone/data/licenses" ]; then
  mkdir -p "/var/www/uas-qat/.next/standalone/data/licenses/$SLUG"
  cp -f "/var/www/uas-qat/data/licenses/$SLUG/"* "/var/www/uas-qat/.next/standalone/data/licenses/$SLUG/" 2>/dev/null || true
  chown -R uas:uas "/var/www/uas-qat/data/licenses/$SLUG" "/var/www/uas-qat/.next/standalone/data/licenses/$SLUG"
fi

echo "=== Issued files for $SLUG ==="
ls -la "/var/www/uas-qat/data/licenses/$SLUG"
cat "/var/www/uas-qat/data/licenses/$SLUG/$SLUG.uaskey.txt"
