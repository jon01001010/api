#!/usr/bin/env bash
# Diagnostic APK: debug signing only; never a release or publishing command.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${HEXAGON_SDK_ROOT:?Set HEXAGON_SDK_ROOT to the pinned SDK}"
: "${HEXAGON_TOOLS_ROOT:?Set HEXAGON_TOOLS_ROOT to the pinned tools}"
if [[ ! -d "$HEXAGON_SDK_ROOT/incs" || ! -d "$HEXAGON_TOOLS_ROOT" ]]; then
  echo 'Hexagon SDK/tools paths are required; refusing a CPU-only APK.' >&2
  exit 1
fi
# Directory presence is not SDK authenticity; use the pinned setup workflow.
export ORG_GRADLE_PROJECT_rnllamaBuildFromSource=true
ORG_GRADLE_PROJECT_rnllamaVariants=$(node scripts/verify-android-payload.js --print-variants)
export ORG_GRADLE_PROJECT_rnllamaVariants
# Reduce peak native build disk use; do not run several heavy C++ compiles at once.
export CMAKE_BUILD_PARALLEL_LEVEL=2
echo "Disk before native build:"
df -h .
(cd android && bash ./gradlew --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a assembleProdDebug)
echo "Disk after native build:"
df -h .
payload_manifest=$(mktemp)
trap 'rm -f "$payload_manifest"' EXIT
node scripts/arm64-payload-manifest.cjs "$payload_manifest"
node scripts/verify-android-payload.js \
  --manifest "$payload_manifest" \
  --apk android/app/build/outputs/apk/prod/debug/app-prod-debug.apk \
  --report android/app/build/outputs/api-helper-npu-payload.txt
printf '%s\n' 'Payload check passed. Installation and measured NPU offload still require device testing.'
