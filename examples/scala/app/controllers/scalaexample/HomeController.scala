package controllers.scalaexample

import javax.inject.Inject
import java.util.Locale
import play.api.data.Form
import play.api.data.Forms._
import play.api.libs.json.Json
import play.api.i18n.Messages
import play.api.mvc._
import play.filters.csrf.{CSRFAddToken, CSRFCheck}

final class HomeController @Inject()(cc: ControllerComponents, addToken: CSRFAddToken, checkToken: CSRFCheck)
    extends AbstractController(cc) {
  private val allProducts = Seq("Clavier", "Souris", "Écran")
  private val supportForm = Form(tuple(
    "name" -> nonEmptyText(maxLength = 80),
    "message" -> nonEmptyText(maxLength = 1000)
  ))

  def index: Action[AnyContent] = addToken(Action { implicit request =>
    implicit val messages: Messages = messagesApi.preferred(request)
    val query = request.getQueryString("query").getOrElse("")
    Ok(views.html.scalaIndex(matching(query), query, supportForm, ""))
  })

  def products: Action[AnyContent] = Action { request =>
    val query = request.getQueryString("query").getOrElse("")
    if (query.length > 100) BadRequest(Json.obj("ok" -> false, "errors" -> Json.obj(
      "query" -> "La recherche doit contenir au maximum 100 caractères."
    )))
    else Ok(Json.obj("ok" -> true, "products" -> matching(query)))
  }

  def support: Action[AnyContent] = checkToken(addToken(Action { implicit request =>
    implicit val messages: Messages = messagesApi.preferred(request)
    val wantsJson = request.headers.get(ACCEPT).exists(_.contains("application/json"))
    supportForm.bindFromRequest().fold(
      invalid => {
        if (wantsJson) BadRequest(Json.obj("ok" -> false, "errors" -> invalid.errors.groupMap(_.key)(error => messages(error.message, error.args: _*))))
        else BadRequest(views.html.scalaIndex(allProducts, "", invalid, "Corrigez les champs du formulaire."))
      },
      value => {
        // A real application would persist the request here using its existing service.
        val message = s"Demande validée pour ${value._1} (démonstration, sans enregistrement)."
        if (wantsJson) Ok(Json.obj("ok" -> true, "message" -> message))
        else Ok(views.html.scalaIndex(allProducts, "", supportForm, message))
      }
    )
  }))

  private def matching(query: String): Seq[String] =
    allProducts.filter(_.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT)))
}
