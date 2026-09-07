package playwebmcp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import play.libs.Json;

/** A page tool's metadata. Its handler is supplied by the application's JavaScript. */
public final class Tool {
    private final ObjectNode definition;

    private Tool(ObjectNode definition) {
        this.definition = definition.deepCopy();
    }

    public static Tool create(String name, String description, String inputSchemaJson, String handler) {
        requireName(name);
        requireText(description, "description");
        requireText(handler, "handler");
        requireText(inputSchemaJson, "inputSchemaJson");
        JsonNode schema;
        try {
            schema = Json.mapper().readerFor(JsonNode.class)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(inputSchemaJson);
        } catch (JsonProcessingException | RuntimeException error) {
            throw new IllegalArgumentException("inputSchemaJson must be valid JSON", error);
        }
        if (!schema.isObject() || !"object".equals(schema.path("type").asText())) {
            throw new IllegalArgumentException("inputSchemaJson must describe an object (type: object)");
        }
        if (schema.has("properties") && !schema.get("properties").isObject()) {
            throw new IllegalArgumentException("inputSchema properties must be an object");
        }
        if (schema.has("properties")) {
            for (JsonNode property : schema.get("properties")) {
                if (!property.isObject() && !property.isBoolean()) {
                    throw new IllegalArgumentException("property schemas must be objects or booleans");
                }
            }
        }
        if (schema.has("required")) {
            JsonNode required = schema.get("required");
            if (!required.isArray()) {
                throw new IllegalArgumentException("inputSchema required must be an array");
            }
            java.util.Set<String> names = new java.util.HashSet<>();
            for (JsonNode entry : required) {
                if (!entry.isTextual() || !names.add(entry.asText())) {
                    throw new IllegalArgumentException("required must contain unique string names");
                }
            }
        }
        ObjectNode value = Json.newObject();
        value.put("name", name);
        value.put("description", description);
        value.set("inputSchema", schema);
        value.put("handler", handler);
        return new Tool(value);
    }

    /** This is a hint to the agent, never an authorization check. */
    public Tool withReadOnly(boolean readOnly) {
        ObjectNode value = definition.deepCopy();
        value.putObject("annotations").put("readOnlyHint", readOnly);
        return new Tool(value);
    }

    /** Returns an independent copy so callers cannot change a tool accidentally. */
    public ObjectNode toJson() {
        return definition.deepCopy();
    }

    public static void requireName(String name) {
        if (name == null || !name.matches("[A-Za-z0-9_.-]{1,128}")) {
            throw new IllegalArgumentException("name must contain 1-128 letters, digits, underscores, dots or hyphens");
        }
    }

    public static void requireText(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }
}
