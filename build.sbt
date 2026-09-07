ThisBuild / organization := "io.github.alexusel"
ThisBuild / version := "0.1.0"
ThisBuild / scalaVersion := "2.13.18"
ThisBuild / crossScalaVersions := Seq("2.13.18", "3.3.6")
ThisBuild / homepage := Some(url("https://github.com/HackInvent/play-webmcp"))
ThisBuild / licenses := Seq("MIT" -> url("https://opensource.org/licenses/MIT"))
ThisBuild / scmInfo := Some(ScmInfo(url("https://github.com/HackInvent/play-webmcp"), "scm:git:git@github.com:HackInvent/play-webmcp.git"))
ThisBuild / developers := List(Developer("AlexusEl", "Alexandre EL", "", url("https://github.com/AlexusEl")))
ThisBuild / javacOptions ++= Seq("--release", "17", "-Xlint:unchecked")

val playVersion = sys.props.getOrElse("play.version", "3.0.10")

lazy val root = (project in file("."))
  .aggregate(webmcp, javaExample, scalaExample)
  .settings(name := "play-webmcp-root", publish / skip := true)

lazy val webmcp = (project in file("module"))
  .settings(
    name := "play-webmcp",
    libraryDependencies ++= Seq(
      "org.playframework" %% "play" % playVersion % Provided,
      "org.scalameta" %% "munit" % "1.1.1" % Test
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
