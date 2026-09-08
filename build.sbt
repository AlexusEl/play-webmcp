ThisBuild / organization := "io.github.alexusel"
ThisBuild / version := "0.4.0"
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

lazy val webmcp = (project in file("module"))
  .settings(
    name := "play-webmcp",
    // Publish against the first stable Play 3.0 APIs and Scala LTS releases.
    // The consuming application supplies Play and keeps its own framework version.
    scalaVersion := "2.13.12",
    crossScalaVersions := Seq("2.13.12", "3.3.1"),
    scalacOptions += "-release:11",
    Compile / resourceGenerators += Def.task {
      val runtime = (Compile / resourceManaged).value / "META-INF" / "resources" /
        "webjars" / "play-webmcp" / version.value / "play-webmcp.js"
      val source = baseDirectory.value / "src" / "main" / "assets" / "play-webmcp.js"
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
      (baseDirectory.value / "src" / "main" / "assets" / "play-webmcp.js") -> "play-webmcp.js",
    libraryDependencies ++= Seq(
      "org.playframework" %% "play" % "3.0.0" % Provided,
      "org.scalameta" %% "munit" % "0.7.29" % Test
    ),
    Test / fork := true
  )

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
