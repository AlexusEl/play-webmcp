package playwebmcp.javadsl;

import play.twirl.api.Html;
import playwebmcp.Tool;

/** Helpers usable directly from Java controllers and Twirl templates. */
public final class WebMcp {
    private WebMcp() {}

    /** Emits inert JSON; registerTools in an external script supplies the executable handlers. */
    public static Html tool(Tool tool) {
        java.util.Objects.requireNonNull(tool, "tool");
        String json = tool.toJson().toString()
                .replace("&", "\\u0026")
                .replace("<", "\\u003c")
                .replace(">", "\\u003e")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029");
        return new Html("<script type=\"application/json\" data-play-webmcp>" + json + "</script>");
    }

    /** Native declarative WebMCP: the user submits the form by default. */
    public static Html formAttributes(String name, String description) {
        return formAttributes(name, description, false);
    }

    public static Html formAttributes(String name, String description, boolean autoSubmit) {
        Tool.requireName(name);
        Tool.requireText(description, "description");
        return new Html("toolname=\"" + escape(name) + "\" tooldescription=\""
                + escape(description) + "\"" + (autoSubmit ? " toolautosubmit" : ""));
    }

    public static Html paramDescription(String description) {
        Tool.requireText(description, "description");
        return new Html("toolparamdescription=\"" + escape(description) + "\"");
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#x27;");
    }
}
