package examples.javaexample

import munit.FunSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

final class ExampleSuite extends FunSuite {
  private def withApplication(test: Application => Unit): Unit = {
    val app = new GuiceApplicationBuilder().build()
    running(app)(test(app))
  }

  test("renders tools and a normal HTML form with a CSRF token") {
    withApplication { app =>
      implicit val materializer: org.apache.pekko.stream.Materializer = app.materializer
      val result = route(app, FakeRequest(GET, "/")).get
      assertEquals(status(result), OK)
      val html = contentAsString(result)
      assert(html.contains("data-play-webmcp"))
      assert(html.contains("search_products"))
      assert(html.contains("create_support_request"))
      assert(html.contains("toolname=\"send_support_form\""))
      assert(html.contains("name=\"csrfToken\""))
      assert(!html.contains("toolautosubmit"))
    }
  }

  test("searches through the existing JSON action and serves the packaged runtime") {
    withApplication { app =>
      implicit val materializer: org.apache.pekko.stream.Materializer = app.materializer
      val search = route(app, FakeRequest(GET, "/api/products?query=clav")).get
      assertEquals(status(search), OK)
      assertEquals((contentAsJson(search) \ "products").as[Seq[String]], Seq("Clavier"))
      val invalid = route(app, FakeRequest(GET, "/api/products?query=" + "x" * 101)).get
      assertEquals(status(invalid), BAD_REQUEST)
      for (file <- Seq("play-webmcp.js", "play-webmcp.global.js")) {
        val script = route(app, FakeRequest(GET, "/static/lib/play-webmcp/" + file)).get
        assertEquals(status(script), OK)
        assert(contentAsString(script).contains("registerTools"))
      }
    }
  }

  test("the support action enforces CSRF and server validation for agent and human requests") {
    withApplication { app =>
      implicit val materializer: org.apache.pekko.stream.Materializer = app.materializer
      val page = route(app, FakeRequest(GET, "/")).get
      val token = "name=\"csrfToken\"[^>]*value=\"([^\"]+)\"".r
        .findFirstMatchIn(contentAsString(page)).get.group(1)
      val browserCookie = app.injector.instanceOf[play.api.mvc.SessionCookieBaker].encodeAsCookie(session(page))
      def request(fields: (String, String)*) = FakeRequest(POST, "/support")
        .withCookies(browserCookie)
        .withSession(session(page).data.toSeq: _*)
        .withHeaders(ACCEPT -> "application/json")
        .withFormUrlEncodedBody(fields: _*)

      val invalid = route(app, request("csrfToken" -> token, "name" -> "", "message" -> "")).get
      assertEquals(status(invalid), BAD_REQUEST)
      assertEquals((contentAsJson(invalid) \ "ok").as[Boolean], false)
      assert((contentAsJson(invalid) \ "errors").as[play.api.libs.json.JsObject].keys.contains("name"))

      val valid = route(app, request("csrfToken" -> token, "name" -> "Ada", "message" -> "Bonjour")).get
      assertEquals(status(valid), OK)
      assertEquals((contentAsJson(valid) \ "ok").as[Boolean], true)

      val human = route(app, FakeRequest(POST, "/support")
        .withCookies(browserCookie)
        .withSession(session(page).data.toSeq: _*)
        .withFormUrlEncodedBody("csrfToken" -> token, "name" -> "Ada", "message" -> "Bonjour")).get
      assertEquals(status(human), OK)
      assert(contentAsString(human).contains("Demande validée pour Ada"))
    }
  }
}
