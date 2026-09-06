ThisBuild / organization := "io.github.alexusel"
ThisBuild / version := "0.1.0"
ThisBuild / scalaVersion := "2.13.16"
ThisBuild / crossScalaVersions := Seq("2.13.16", "3.3.6")
ThisBuild / homepage := Some(url("https://github.com/AlexusEl/play-webmcp"))
ThisBuild / licenses := Seq("MIT" -> url("https://opensource.org/licenses/MIT"))
ThisBuild / scmInfo := Some(ScmInfo(url("https://github.com/AlexusEl/play-webmcp"), "scm:git:git@github.com:AlexusEl/play-webmcp.git"))
ThisBuild / developers := List(Developer("AlexusEl", "Alexandre EL", "", url("https://github.com/AlexusEl")))
ThisBuild / javacOptions ++= Seq("--release", "17", "-Xlint:unchecked")

lazy val root = (project in file("."))
  .aggregate(webmcp)
  .settings(name := "play-webmcp-root", publish / skip := true)

lazy val webmcp = (project in file("module"))
  .settings(
    name := "play-webmcp",
    libraryDependencies ++= Seq(
      "org.playframework" %% "play-java" % "3.0.10" % Provided,
      "org.scalameta" %% "munit" % "1.1.1" % Test
    ),
    Test / fork := true
  )
