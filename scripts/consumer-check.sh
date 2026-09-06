#!/usr/bin/env bash
set -euo pipefail

# Run the example applications against a published Maven artifact, outside this build.
# Optional argument (or SCALA_VERSION): 2.13.18 or 3.3.6. The default tests both.
if (( $# > 1 )); then
  echo "Usage: $0 [2.13.18|3.3.6]" >&2
  exit 2
fi

task_scala_version=${1:-${SCALA_VERSION:-}}
case "$task_scala_version" in
  ''|2.13.18|3.3.6) ;;
  *) echo "Supported Scala versions: 2.13.18 or 3.3.6" >&2; exit 2 ;;
esac

task_repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_consumer_dir=$(mktemp -d "${TMPDIR:-/tmp}/play-webmcp-consumer.XXXXXXXX")
cleanup() {
  rm -rf "$task_consumer_dir"
}
trap cleanup EXIT

export WEBMCP_REPOSITORY="${WEBMCP_REPOSITORY:-https://raw.githubusercontent.com/AlexusEl/play-webmcp/maven}"

for task_language in java scala; do
  mkdir -p "$task_consumer_dir/examples/$task_language"
  for task_directory in app conf public test; do
    cp -R "$task_repository_root/examples/$task_language/$task_directory" \
      "$task_consumer_dir/examples/$task_language/"
  done
done
mkdir -p "$task_consumer_dir/project"

cat > "$task_consumer_dir/project/build.properties" <<'BUILD_PROPERTIES'
sbt.version=1.11.7
BUILD_PROPERTIES
cat > "$task_consumer_dir/project/plugins.sbt" <<'PLUGINS'
addSbtPlugin("org.playframework" % "sbt-plugin" % "3.0.10")
PLUGINS
cat > "$task_consumer_dir/build.sbt" <<'BUILD'
ThisBuild / scalaVersion := "2.13.18"
ThisBuild / crossScalaVersions := Seq("2.13.18", "3.3.6")
// Exclude Ivy local so a previous publishLocal cannot mask a broken distribution.
ThisBuild / externalResolvers := Seq(
  "WebMCP published artifact" at sys.env("WEBMCP_REPOSITORY"),
  Resolver.mavenCentral
)
ThisBuild / publish / skip := true
ThisBuild / javacOptions ++= Seq("--release", "17", "-Xlint:unchecked")

lazy val root = (project in file("."))
  .aggregate(javaExample, scalaExample)
  .settings(name := "play-webmcp-consumer-check")

lazy val exampleSettings = Seq(
  libraryDependencies ++= Seq(
    guice,
    "io.github.alexusel" %% "play-webmcp" % "0.1.0",
    "org.playframework" %% "play-test" % "3.0.10" % Test,
    "org.scalameta" %% "munit" % "1.1.1" % Test
  ),
  Test / fork := true
)

lazy val javaExample = (project in file("examples/java"))
  .enablePlugins(PlayJava)
  .settings(exampleSettings)
  .settings(name := "play-webmcp-java-consumer")

lazy val scalaExample = (project in file("examples/scala"))
  .enablePlugins(PlayScala)
  .settings(exampleSettings)
  .settings(name := "play-webmcp-scala-consumer")
BUILD

task_sbt_command=(sbt -batch)
if [[ -n "${JAVA_HOME:-}" ]]; then
  task_sbt_command+=(-java-home "$JAVA_HOME")
fi
if [[ -n "$task_scala_version" ]]; then
  task_sbt_command+=("++$task_scala_version" test)
else
  task_sbt_command+=(+test)
fi

cd "$task_consumer_dir"
"${task_sbt_command[@]}"
