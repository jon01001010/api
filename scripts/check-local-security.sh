#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js --runInBand --coverage=false \
  src/components/HtmlPreviewBubble/__tests__/HtmlPreviewBubble.test.tsx \
  src/services/__tests__/hubRunLink.test.ts \
  src/services/talents/__tests__/CalculateEngine.test.ts \
  src/services/talents/__tests__/safeMath.test.ts \
  src/services/localApi/__tests__/service.test.ts \
  src/services/downloads/__tests__/DownloadManager.test.ts \
  src/store/__tests__/HFStore.test.ts \
  src/services/iap/__tests__/freeBuild.test.ts
security_tmp=$(mktemp -d)
trap 'rm -rf "$security_tmp"' EXIT
java com.sun.tools.javac.Main -d "$security_tmp" \
  android/app/src/main/java/com/pocketagent/localapi/LoopbackServer.java \
  tests/security/LoopbackServerTest.java
java -cp "$security_tmp" LoopbackServerTest
node node_modules/typescript/bin/tsc src/services/localApi/protocol.ts \
  --outDir "$security_tmp" --target es2020 --module commonjs --strict --skipLibCheck
node tests/security/protocol.cjs "$security_tmp/protocol.js"
node tests/security/dependencies.cjs
node scripts/check-phonemize-bundle.cjs
