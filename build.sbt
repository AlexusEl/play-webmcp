ThisBuild / organization := "io.github.alexusel"
ThisBuild / version := "0.5.0"
ThisBuild / scalaVersion := "2.13.18"
ThisBuild / crossScalaVersions := Seq("2.13.18", "3.3.6")
ThisBuild / homepage := Some(url("https://github.com/HackInvent/play-webmcp"))
ThisBuild / licenses := Seq("MIT" -> url("https://opensource.org/licenses/MIT"))
ThisBuild / scmInfo := Some(ScmInfo(url("https://github.com/HackInvent/play-webmcp"), "scm:git:git@github.com:HackInvent/play-webmcp.git"))
ThisBuild / developers := List(Developer("AlexusEl", "Alexandre EL", "", url("https://github.com/AlexusEl")))
ThisBuild / javacOptions ++= Seq("--release", "11", "-Xlint:unchecked")

val playVersion = sys.props.getOrElse("play.version", "3.0.10")

lazy val root = (project in file("."))
  .aggregate(webmcp, javaExample, scalaExample)
  .settings(name := "play-webmcp-root", publish / skip := true)

// Each Play line gets its own binary artifact, while sharing every source and test.
// The consuming application provides Play, Twirl, and its existing Scala runtime.
def webMcpModule(id: String, directory: String, artifact: String,
    playGroup: String, baseline: String, scalaVersions: Seq[String], javaRelease: String): Project =
  Project(id, file(directory)).settings(
    name := artifact,
    scalaVersion := scalaVersions.head,
    crossScalaVersions := scalaVersions,
    javacOptions := Seq("--release", javaRelease, "-Xlint:unchecked"),
    scalacOptions += (if (javaRelease == "8") "-target:jvm-1.8" else "-release:" + javaRelease),
    Compile / unmanagedSourceDirectories := Seq(
      (LocalRootProject / baseDirectory).value / "module/src/main/java",
      (LocalRootProject / baseDirectory).value / "module/src/main/scala"
    ),
    Test / unmanagedSourceDirectories := Seq(
      (LocalRootProject / baseDirectory).value / "module/src/test/scala"
    ),
    Compile / resourceGenerators += Def.task {
      // Keep the same public asset URL whichever Play artifact the site installs.
      val runtime = (Compile / resourceManaged).value / "META-INF" / "resources" /
        "webjars" / "play-webmcp" / version.value / "play-webmcp.js"
      val source = (LocalRootProject / baseDirectory).value / "module/src/main/assets/play-webmcp.js"
      IO.copyFile(source, runtime)
      // Both entry points come from the same implementation; consumers do not need Node.js.
      val classic = runtime.getParentFile / "play-webmcp.global.js"
      val code = IO.read(source)
      val declaration = "export async function registerTools"
      require(code.sliding(declaration.length).count(_ == declaration) == 1,
        "Update the classic entry point when the runtime exports change")
      IO.write(classic, "(function () {\n'use strict';\n" +
        code.replace(declaration, "async function registerTools") +
        "\nglobalThis.PlayWebMcp = Object.freeze({ registerTools });\n})();\n")
      Seq(runtime, classic)
    }.taskValue,
    Compile / packageSrc / mappings +=
      ((LocalRootProject / baseDirectory).value / "module/src/main/assets/play-webmcp.js") -> "play-webmcp.js",
    libraryDependencies ++= Seq(
      playGroup %% "play" % baseline % Provided,
      "org.scalameta" %% "munit" % "0.7.29" % Test
    ),
    Test / fork := true
  )

lazy val webmcp = webMcpModule("webmcp", "module", "play-webmcp",
  "org.playframework", "3.0.0", Seq("2.13.12", "3.3.1"), "11")

lazy val webmcpPlay29 = webMcpModule("webmcpPlay29", "compat/play29", "play-webmcp-play29",
  "com.typesafe.play", "2.9.0", Seq("2.13.12", "3.3.1"), "11")

lazy val webmcpPlay28 = webMcpModule("webmcpPlay28", "compat/play28", "play-webmcp-play28",
  "com.typesafe.play", "2.8.0", Seq("2.12.10", "2.13.1"), "8")

// Both applications compile their real routes and Twirl templates against the library.
lazy val exampleSettings = Seq(
  publish / skip := true,
  libraryDependencies ++= Seq(
    guice,
    "org.playframework" %% "play-test" % playVersion % Test,
    "org.scalameta" %% "munit" % "1.1.1" % Test
  ),
  Test / fork := true
)

lazy val javaExample = (project in file("examples/java"))
  .enablePlugins(PlayJava)
  .dependsOn(webmcp)
  .settings(exampleSettings)
  .settings(name := "play-webmcp-java-example")

lazy val scalaExample = (project in file("examples/scala"))
  .enablePlugins(PlayScala)
  .dependsOn(webmcp)
  .settings(exampleSettings)
  .settings(name := "play-webmcp-scala-example")
