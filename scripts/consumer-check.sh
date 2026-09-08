#!/usr/bin/env bash
set -euo pipefail

# Run the example applications against a published Maven artifact, outside this build.
# Optional argument (or SCALA_VERSION): a compatible Scala version. The default tests both families for the selected Play line.
# PLAY_VERSION and SBT_VERSION select the existing build; WEBMCP_VERSION selects the published module.
if (( $# > 1 )); then
  echo "Usage: $0 [Scala version]" >&2
  exit 2
fi

task_scala_version=${1:-${SCALA_VERSION:-}}
if [[ -n "$task_scala_version" && ! "$task_scala_version" =~ ^(2\.(12|13)|3\.[0-9]+)\.[0-9]+$ ]]; then
  echo "Use a stable Scala 2.12.x, 2.13.x or 3.x version" >&2
  exit 2
fi
export SCALA_VERSION="$task_scala_version"
export PLAY_VERSION="${PLAY_VERSION:-3.0.11}"
export WEBMCP_VERSION="${WEBMCP_VERSION:-0.5.0}"

case "$PLAY_VERSION" in
  2.8.*)
    export WEBMCP_ARTIFACT=play-webmcp-play28 PLAY_GROUP=com.typesafe.play
    export WEBMCP_SCALA_VERSIONS=2.12.20,2.13.18 WEBMCP_JAVA_RELEASE=8
    task_default_sbt=1.5.8
    ;;
  2.9.*)
    export WEBMCP_ARTIFACT=play-webmcp-play29 PLAY_GROUP=com.typesafe.play
    export WEBMCP_SCALA_VERSIONS=2.13.18,3.3.6 WEBMCP_JAVA_RELEASE=11
    task_default_sbt=1.11.7
    ;;
  3.0.*)
    export WEBMCP_ARTIFACT=play-webmcp PLAY_GROUP=org.playframework
    export WEBMCP_SCALA_VERSIONS=2.13.18,3.3.6 WEBMCP_JAVA_RELEASE=11
    task_default_sbt=1.11.7
    ;;
  *) echo "Supported Play lines: 2.8.x, 2.9.x and 3.0.x" >&2; exit 2 ;;
esac
if [[ -n "$task_scala_version" ]]; then
  if [[ "$PLAY_VERSION" == 2.8.* && "$task_scala_version" == 3.* ]] ||
     [[ "$PLAY_VERSION" != 2.8.* && "$task_scala_version" == 2.12.* ]]; then
    echo "Scala $task_scala_version is not supported by Play $PLAY_VERSION" >&2
    exit 2
  fi
fi
if [[ "${WEBMCP_BROWSER_CHECK:-0}" == 1 && -z "$task_scala_version" ]]; then
  echo "Choose one Scala version when enabling WEBMCP_BROWSER_CHECK" >&2
  exit 2
fi

task_sbt_version=${SBT_VERSION:-$task_default_sbt}
if [[ ! "$task_sbt_version" =~ ^1\.[0-9]+\.[0-9]+$ ]]; then
  echo "SBT_VERSION must be a stable sbt 1.x version" >&2
  exit 2
fi

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

printf 'sbt.version=%s\n' "$task_sbt_version" > "$task_consumer_dir/project/build.properties"
cat > "$task_consumer_dir/project/plugins.sbt" <<'PLUGINS'
resolvers += "Maven Central (Apache)" at "https://repo.maven.apache.org/maven2"
addSbtPlugin(sys.env("PLAY_GROUP") % "sbt-plugin" % sys.env("PLAY_VERSION"))
PLUGINS
cat > "$task_consumer_dir/build.sbt" <<'BUILD'
ThisBuild / scalaVersion := sys.env("WEBMCP_SCALA_VERSIONS").split(",").head
ThisBuild / crossScalaVersions := sys.env("WEBMCP_SCALA_VERSIONS").split(",").toSeq
// Exclude Ivy local so a previous publishLocal cannot mask a broken distribution.
ThisBuild / externalResolvers := Seq(
  "WebMCP published artifact" at sys.env("WEBMCP_REPOSITORY"),
  "Maven Central (Apache)" at "https://repo.maven.apache.org/maven2"
)
ThisBuild / publish / skip := true
ThisBuild / javacOptions ++= {
  if (sys.props("java.specification.version") == "1.8") Seq("-source", "8", "-target", "8", "-Xlint:unchecked")
  else Seq("--release", sys.env("WEBMCP_JAVA_RELEASE"), "-Xlint:unchecked")
}

lazy val root = (project in file("."))
  .aggregate(javaExample, scalaExample)
  .settings(name := "play-webmcp-consumer-check")

// Resolve the host framework without this module to distinguish Play's own
// Scala runtime requirements from changes introduced by the installed library.
lazy val baselineJava = (project in file("baseline-java"))
  .enablePlugins(PlayJava)
  .settings(libraryDependencies += guice)

lazy val baselineScala = (project in file("baseline-scala"))
  .enablePlugins(PlayScala)
  .settings(libraryDependencies += guice)

lazy val checkConsumerDependencies = taskKey[Unit]("Verify that installing the module preserves the application's Play and Scala versions")
lazy val checkConsumerTests = taskKey[Unit]("Require the consumer test suite to be discovered, including on older sbt")

def exampleSettings(host: ProjectReference) = Seq(
  // Older sbt releases do not include MUnit in their default framework list.
  Test / testFrameworks := Seq(new TestFramework("munit.Framework")),
  checkConsumerTests := {
    require((Test / definedTests).value.exists(_.name.endsWith(".ExampleSuite")),
      "The consumer test suite was not discovered")
  },
  checkConsumerDependencies := {
    val requestedScala = sys.env.get("SCALA_VERSION").filter(_.nonEmpty).getOrElse(scalaVersion.value)
    require(scalaVersion.value == requestedScala, s"Expected Scala $requestedScala, got ${scalaVersion.value}")
    val modules = (Compile / dependencyClasspath).value.flatMap(_.get(moduleID.key))
    val hostModules = (host / Compile / dependencyClasspath).value.flatMap(_.get(moduleID.key))
    def scalaLibraries(dependencies: Seq[ModuleID]) = dependencies
      .filter(m => m.organization == "org.scala-lang" && Set("scala-library", "scala3-library_3").contains(m.name))
      .map(m => m.name -> m.revision).toSet
    require(scalaLibraries(modules) == scalaLibraries(hostModules),
      s"The module changed Scala libraries: ${scalaLibraries(hostModules)} -> ${scalaLibraries(modules)}")
    // A module must never bring the other Play generation, or change its JSON,
    // Twirl, Akka/Pekko dependencies as a side effect of installation.
    def hostRuntime(dependencies: Seq[ModuleID]) = dependencies.filter { m =>
      Set("com.typesafe.play", "org.playframework", "org.playframework.twirl", "com.typesafe.akka",
        "org.apache.pekko").contains(m.organization) || m.organization.startsWith("com.fasterxml.jackson")
    }.map(m => (m.organization, m.name, m.revision)).toSet
    require(hostRuntime(modules) == hostRuntime(hostModules),
      s"Installing the module changed the host runtime: added ${hostRuntime(modules) -- hostRuntime(hostModules)}, removed ${hostRuntime(hostModules) -- hostRuntime(modules)}")
    val expected = Seq(
      (sys.env("PLAY_GROUP"), "play_" + scalaBinaryVersion.value, sys.env("PLAY_VERSION")),
      ("io.github.alexusel", sys.env("WEBMCP_ARTIFACT") + "_" + scalaBinaryVersion.value, sys.env("WEBMCP_VERSION"))
    )
    expected.foreach { case (group, artifact, version) =>
      val resolved = modules.filter(m => m.organization == group && m.name == artifact).map(_.revision).distinct
      require(resolved == Seq(version), s"$artifact: expected $version, resolved $resolved")
    }
    streams.value.log.info("Published module installed without changing the application's Play or Scala version")
  },
  Test / test := ((Test / test) dependsOn (checkConsumerDependencies, checkConsumerTests)).value,
  libraryDependencies ++= Seq(
    guice,
    "io.github.alexusel" %% sys.env("WEBMCP_ARTIFACT") % sys.env("WEBMCP_VERSION"),
    sys.env("PLAY_GROUP") %% "play-test" % sys.env("PLAY_VERSION") % Test,
    "org.scalameta" %% "munit" % "0.7.29" % Test
  ),
  Test / fork := true
)

lazy val javaExample = (project in file("examples/java"))
  .enablePlugins(PlayJava)
  .settings(exampleSettings(baselineJava))
  .settings(name := "play-webmcp-java-example")

lazy val scalaExample = (project in file("examples/scala"))
  .enablePlugins(PlayScala)
  .settings(exampleSettings(baselineScala))
  .settings(name := "play-webmcp-scala-example")
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

if [[ "${WEBMCP_BROWSER_CHECK:-0}" == 1 ]]; then
  task_sbt_command+=(javaExample/stage scalaExample/stage)
fi
cd "$task_consumer_dir"
"${task_sbt_command[@]}"
if [[ "${WEBMCP_BROWSER_CHECK:-0}" == 1 ]]; then
  WEBMCP_EXAMPLES_DIR="$task_consumer_dir/examples" bash "$task_repository_root/scripts/browser-check.sh"
fi
