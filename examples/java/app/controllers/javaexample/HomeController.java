package controllers.javaexample;

import java.util.List;
import java.util.Map;
import java.util.Locale;
import javax.inject.Inject;
import play.data.Form;
import play.data.FormFactory;
import play.data.validation.Constraints;
import play.filters.csrf.AddCSRFToken;
import play.filters.csrf.RequireCSRFCheck;
import play.libs.Json;
import play.mvc.Controller;
import play.mvc.Http;
import play.mvc.Result;
import playwebmcp.Tool;

/** Existing Play actions remain responsible for validation and CSRF protection. */
public final class HomeController extends Controller {
    private static final List<String> PRODUCTS = List.of("Clavier", "Souris", "Écran");
    private final FormFactory forms;

    private static final Tool SEARCH = Tool.create(
        "search_products", "Rechercher les produits de cette boutique.",
        "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"maxLength\":100}},\"required\":[\"query\"],\"additionalProperties\":false}",
        "searchProducts").withReadOnly(true);
    private static final Tool SUPPORT = Tool.create(
        "create_support_request", "Créer une demande de support après confirmation de l’utilisateur.",
        "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":80},\"message\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1000}},\"required\":[\"name\",\"message\"],\"additionalProperties\":false}",
        "createSupportRequest");

    @Inject public HomeController(FormFactory forms) { this.forms = forms; }

    public static final class SupportRequest {
        @Constraints.Required(message = "Indiquez votre nom.")
        @Constraints.MaxLength(value = 80, message = "Le nom doit contenir au maximum 80 caractères.")
        public String name;

        @Constraints.Required(message = "Décrivez votre demande.")
        @Constraints.MaxLength(value = 1000, message = "La demande doit contenir au maximum 1000 caractères.")
        public String message;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
    }

    @AddCSRFToken public Result index(Http.Request request) {
        String query = query(request);
        return ok(views.html.javaIndex.render(SEARCH, SUPPORT, matching(query), query,
            forms.form(SupportRequest.class), "", request.asScala()));
    }

    public Result products(Http.Request request) {
        String query = query(request);
        if (query.length() > 100) {
            return badRequest(Json.toJson(Map.of("ok", false, "errors",
                Map.of("query", "La recherche doit contenir au maximum 100 caractères."))));
        }
        return ok(Json.toJson(Map.of("ok", true, "products", matching(query))));
    }

    @RequireCSRFCheck @AddCSRFToken public Result support(Http.Request request) {
        Form<SupportRequest> form = forms.form(SupportRequest.class).bindFromRequest(request);
        if (form.hasErrors()) {
            if (wantsJson(request)) {
                com.fasterxml.jackson.databind.node.ObjectNode body = Json.newObject().put("ok", false);
                body.set("errors", form.errorsAsJson());
                return badRequest(body);
            }
            return badRequest(views.html.javaIndex.render(SEARCH, SUPPORT, PRODUCTS, "", form,
                "Corrigez les champs du formulaire.", request.asScala()));
        }
        // A real application would persist the request here using its existing service.
        String message = "Demande validée pour " + form.get().name + " (démonstration, sans enregistrement).";
        if (wantsJson(request)) {
            return ok(Json.toJson(Map.of("ok", true, "message", message)));
        }
        return ok(views.html.javaIndex.render(SEARCH, SUPPORT, PRODUCTS, "",
            forms.form(SupportRequest.class), message, request.asScala()));
    }

    private static boolean wantsJson(Http.Request request) {
        return request.getHeaders().get("Accept").orElse("").contains("application/json");
    }

    private static String query(Http.Request request) {
        String value = request.getQueryString("query");
        return value == null ? "" : value;
    }

    private static List<String> matching(String query) {
        String normalized = query.toLowerCase(Locale.ROOT);
        return PRODUCTS.stream().filter(p -> p.toLowerCase(Locale.ROOT).contains(normalized))
            .collect(java.util.stream.Collectors.toList());
    }
}
