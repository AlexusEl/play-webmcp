package playwebmcp

import munit.FunSuite
import play.api.libs.json.Json
import playwebmcp.javadsl.WebMcp

class WebMcpSuite extends FunSuite {
  private val schema = """{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}"""

  test("Java metadata survives rendering without allowing script termination") {
    val description = "Search </script><script>alert(1)</script> & \u2028 \u2029"
    val tool = Tool.create("search_products", description, schema, "searchProducts").withReadOnly(true)
    val html = WebMcp.tool(tool).body
    assertEquals("</script>".r.findAllIn(html).length, 1)
    assert(!html.contains("<script>alert"))
    val payload = html.substring(html.indexOf('>') + 1, html.lastIndexOf("</script>"))
    val parsed = Json.parse(payload)
    assertEquals((parsed \ "description").as[String], description)
    assertEquals((parsed \ "annotations" \ "readOnlyHint").as[Boolean], true)
    assertEquals((parsed \ "inputSchema").get, Json.parse(schema))
  }

  test("metadata and fluent modifications do not share mutable JSON") {
    val original = Tool.create("search", "Search products", schema, "search")
    val changed = original.withReadOnly(true)
    changed.toJson().put("name", "other")
    assertEquals(changed.toJson().path("name").asText(), "search")
    assert(!original.toJson().has("annotations"))
  }

  test("form attributes escape HTML and default to human submission") {
    val html = WebMcp.formAttributes("search", "Find \"products\" <here> & 'there'").body
    assert(html.contains("&quot;products&quot;"))
    assert(html.contains("&lt;here&gt; &amp; &#x27;there&#x27;"))
    assert(!html.contains("toolautosubmit"))
    assert(WebMcp.formAttributes("search", "Search", true).body.endsWith(" toolautosubmit"))
    assertEquals(WebMcp.paramDescription("a\"b").body, "toolparamdescription=\"a&quot;b\"")
  }

  test("invalid tool definitions fail before reaching the browser") {
    for (name <- Seq("", "a\"onclick=", "a b", "x" * 129)) {
      intercept[IllegalArgumentException](Tool.create(name, "Search", schema, "search"))
    }
    for (json <- Seq("no json", "null", "[]", "{}", """{"type":"object","properties":[]}""",
        """{"type":"object","properties":{"x":{}},"required":["x","x"]}""")) {
      intercept[IllegalArgumentException](Tool.create("search", "Search", json, "search"))
    }
    intercept[IllegalArgumentException](Tool.create("search", " ", schema, "search"))
    intercept[IllegalArgumentException](Tool.create("search", "Search", schema, ""))
  }

  test("Scala API produces the same tool contract as Java") {
    val javaHtml = WebMcp.tool(Tool.create("search", "Search", schema, "search").withReadOnly(true)).body
    val scalaHtml = scaladsl.WebMcp.tool("search", "Search", Json.parse(schema).as[play.api.libs.json.JsObject], "search", true).body
    assertEquals(scalaHtml, javaHtml)
  }
}
