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
# Gradle and CMake produce large intermediates; monitor free space so the
# Actions worker can still write logs and upload diagnostics on failure.
export CMAKE_BUILD_PARALLEL_LEVEL=2
export CMAKE_JOB_POOLS=compile=2
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.workers.max=2"
echo "Disk before native build:"
df -h .
(
  cd android
  bash ./gradlew --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a assembleProdDebug
) &
build_pid=$!
disk_stop_marker=$(mktemp)
trap 'rm -f "$disk_stop_marker"' EXIT
monitor_disk() {
  while kill -0 "$build_pid" 2>/dev/null; do
    sleep 20
    free_kb=$(df -Pk . | awk 'NR==2 {print $4}')
    if (( free_kb < 2097152 )); then
      echo "::error::Less than 2 GiB free during native compilation; stopping to preserve runner diagnostics." >&2
      df -h . >&2
      du -sh android/.cxx android/app/.cxx android/app/build "$HOME/.gradle" "$HOME/.hexagon-sdk" 2>/dev/null >&2 || true
      echo "disk-limit" > "$disk_stop_marker"
      pkill -TERM -P "$build_pid" 2>/dev/null || true
      kill -TERM "$build_pid" 2>/dev/null || true
      return 1
    fi
  done
}
monitor_disk &
monitor_pid=$!
set +e
wait "$build_pid"
build_result=$?
set -e
kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
if [[ -s "$disk_stop_marker" ]]; then
  echo "::error::Disk safety threshold reached; build stopped early." >&2
  exit 1
fi
if (( build_result != 0 )); then
  echo "::error::Native Gradle build failed (exit $build_result)." >&2
  df -h . >&2
  exit "$build_result"
fi
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
