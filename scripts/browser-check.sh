#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

task_context_path=${WEBMCP_TEST_CONTEXT_PATH:-/}
if [[ "$task_context_path" != /* || "$task_context_path" == //* ]]; then
  echo "WEBMCP_TEST_CONTEXT_PATH must be a local path such as / or /shop" >&2
  exit 2
fi
task_test_dir=$(mktemp -d)
java_pid=''
scala_pid=''
cleanup() {
  if [[ -n "$java_pid" ]]; then kill "$java_pid" 2>/dev/null || true; fi
  if [[ -n "$scala_pid" ]]; then kill "$scala_pid" 2>/dev/null || true; fi
  rm -rf "$task_test_dir"
}
trap cleanup EXIT

examples/java/target/universal/stage/bin/play-webmcp-java-example \
  -J-Xms64m -J-Xmx384m -Dhttp.port=19001 -Dplay.http.context="$task_context_path" -Dpidfile.path="$task_test_dir/java.pid" \
  >"$task_test_dir/java.log" 2>&1 &
java_pid=$!
examples/scala/target/universal/stage/bin/play-webmcp-scala-example \
  -J-Xms64m -J-Xmx384m -Dhttp.port=19002 -Dplay.http.context="$task_context_path" -Dpidfile.path="$task_test_dir/scala.pid" \
  >"$task_test_dir/scala.log" 2>&1 &
scala_pid=$!

for port in 19001 19002; do
  ready=false
  for attempt in $(seq 1 90); do
    if curl --fail --silent "http://localhost:$port$task_context_path" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    cat "$task_test_dir/java.log" "$task_test_dir/scala.log"
    exit 1
  fi
  BASE_URL="http://localhost:$port$task_context_path" node tests/browser.mjs
done
