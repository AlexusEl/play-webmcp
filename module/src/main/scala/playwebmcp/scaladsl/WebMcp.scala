package playwebmcp.scaladsl

import play.api.libs.json.{JsObject, Json}
import play.twirl.api.Html
import playwebmcp.Tool

/** Scala-friendly helpers; the same metadata and runtime are used by the Java API. */
object WebMcp {
  def tool(
      name: String,
      description: String,
      inputSchema: JsObject,
      handler: String,
      readOnly: Boolean = false
  ): Html = playwebmcp.javadsl.WebMcp.tool(
    Tool.create(name, description, Json.stringify(inputSchema), handler).withReadOnly(readOnly)
  )

  def formAttributes(name: String, description: String, autoSubmit: Boolean = false): Html =
    playwebmcp.javadsl.WebMcp.formAttributes(name, description, autoSubmit)

  def paramDescription(description: String): Html =
    playwebmcp.javadsl.WebMcp.paramDescription(description)
}
