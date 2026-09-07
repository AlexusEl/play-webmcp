#!/usr/bin/env bash
set -euo pipefail

# Run the example applications against a published Maven artifact, outside this build.
# Optional argument (or SCALA_VERSION): a Scala 2.13.x or 3.x version. The default tests both families.
# PLAY_VERSION selects the existing application version; WEBMCP_VERSION selects the published module.
if (( $# > 1 )); then
  echo "Usage: $0 [Scala version]" >&2
  exit 2
fi

task_scala_version=${1:-${SCALA_VERSION:-}}
if [[ -n "$task_scala_version" && ! "$task_scala_version" =~ ^(2\.13|3\.[0-9]+)\.[0-9]+$ ]]; then
  echo "Use a stable Scala 2.13.x or 3.x version" >&2
  exit 2
fi
export SCALA_VERSION="$task_scala_version"
export PLAY_VERSION="${PLAY_VERSION:-3.0.11}"
export WEBMCP_VERSION="${WEBMCP_VERSION:-0.2.0}"

task_repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_consumer_dir=$(mktemp -d "${TMPDIR:-/tmp}/play-webmcp-consumer.XXXXXXXX")
cleanup() {
  rm -rf "$task_consumer_dir"
}
trap cleanup EXIT

export WEBMCP_REPOSITORY="${WEBMCP_REPOSITORY:-https://raw.githubusercontent.com/HackInvent/play-webmcp/maven}"

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
addSbtPlugin("org.playframework" % "sbt-plugin" % sys.env("PLAY_VERSION"))
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
ThisBuild / javacOptions ++= Seq("--release", "11", "-Xlint:unchecked")

lazy val root = (project in file("."))
  .aggregate(javaExample, scalaExample)
  .settings(name := "play-webmcp-consumer-check")

// Resolve the host framework without this module to distinguish Play's own
// Scala runtime requirements from changes introduced by the installed library.
lazy val baseline = (project in file("baseline"))
  .enablePlugins(PlayJava)
  .settings(libraryDependencies += guice)

lazy val checkConsumerDependencies = taskKey[Unit]("Verify that installing the module preserves the application's Play and Scala versions")

lazy val exampleSettings = Seq(
  checkConsumerDependencies := {
    val requestedScala = sys.env.get("SCALA_VERSION").filter(_.nonEmpty).getOrElse(scalaVersion.value)
    require(scalaVersion.value == requestedScala, s"Expected Scala $requestedScala, got ${scalaVersion.value}")
    val modules = (Compile / dependencyClasspath).value.flatMap(_.get(moduleID.key))
    val hostModules = (baseline / Compile / dependencyClasspath).value.flatMap(_.get(moduleID.key))
    def scalaLibraries(dependencies: Seq[ModuleID]) = dependencies
      .filter(m => m.organization == "org.scala-lang" && Set("scala-library", "scala3-library_3").contains(m.name))
      .map(m => m.name -> m.revision).toSet
    require(scalaLibraries(modules) == scalaLibraries(hostModules),
      s"The module changed Scala libraries: ${scalaLibraries(hostModules)} -> ${scalaLibraries(modules)}")
    val expected = Seq(
      ("org.playframework", "play_" + scalaBinaryVersion.value, sys.env("PLAY_VERSION")),
      ("io.github.alexusel", "play-webmcp_" + scalaBinaryVersion.value, sys.env("WEBMCP_VERSION"))
    )
    expected.foreach { case (group, artifact, version) =>
      val resolved = modules.filter(m => m.organization == group && m.name == artifact).map(_.revision).distinct
      require(resolved == Seq(version), s"$artifact: expected $version, resolved $resolved")
    }
    streams.value.log.info("Published module installed without changing the application's Play or Scala version")
  },
  Test / test := ((Test / test) dependsOn checkConsumerDependencies).value,
  libraryDependencies ++= Seq(
    guice,
    "io.github.alexusel" %% "play-webmcp" % sys.env("WEBMCP_VERSION"),
    "org.playframework" %% "play-test" % sys.env("PLAY_VERSION") % Test,
    "org.scalameta" %% "munit" % "0.7.29" % Test
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
  task_sbt_command+=("++$task_scala_version!" test)
else
  task_sbt_command+=(+test)
fi

cd "$task_consumer_dir"
"${task_sbt_command[@]}"
