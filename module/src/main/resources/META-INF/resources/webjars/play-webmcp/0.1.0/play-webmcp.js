const selector = 'script[type="application/json"][data-play-webmcp]';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireMetadata(condition, message) {
  if (!condition) throw new TypeError(`play-webmcp: ${message}`);
}

function readTools(document, handlers) {
  requireMetadata(isObject(handlers), 'handlers must be an object of named functions');
  const names = new Set();
  return Array.from(document.querySelectorAll(selector), (element, index) => {
    let spec;
    try {
      spec = JSON.parse(element.textContent);
    } catch (cause) {
      throw new TypeError(`play-webmcp: invalid JSON in tool metadata ${index + 1}`, { cause });
    }
    requireMetadata(isObject(spec), `tool metadata ${index + 1} must be an object`);
    for (const field of ['name', 'description', 'handler']) {
      requireMetadata(typeof spec[field] === 'string' && spec[field].trim().length > 0,
        `tool metadata ${index + 1} needs a nonempty ${field}`);
    }
    requireMetadata(!names.has(spec.name), `duplicate tool name: ${spec.name}`);
    names.add(spec.name);
    requireMetadata(Object.hasOwn(handlers, spec.handler) && typeof handlers[spec.handler] === 'function',
      `unknown handler for tool ${spec.name}: ${spec.handler}`);
    const schema = spec.inputSchema;
    requireMetadata(isObject(schema) && schema.type === 'object',
      `inputSchema for ${spec.name} must have type "object"`);
    requireMetadata(schema.properties === undefined || isObject(schema.properties),
      `properties for ${spec.name} must be an object`);
    if (schema.properties) {
      requireMetadata(Object.values(schema.properties).every(value => isObject(value) || typeof value === 'boolean'),
        `property schemas for ${spec.name} must be objects or booleans`);
    }
    if (schema.required !== undefined) {
      requireMetadata(Array.isArray(schema.required) &&
        schema.required.every(value => typeof value === 'string') &&
        new Set(schema.required).size === schema.required.length,
      `required for ${spec.name} must be an array of unique strings`);
    }
    if (spec.annotations !== undefined) {
      requireMetadata(isObject(spec.annotations) &&
        Object.values(spec.annotations).every(value => typeof value === 'boolean'),
      `annotations for ${spec.name} must be an object of boolean hints`);
    }
    const handler = handlers[spec.handler];
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: schema,
      ...(spec.annotations === undefined ? {} : { annotations: spec.annotations }),
      execute: (input, ...context) => handler(input, ...context)
    };
  });
}

/**
 * Register the JSON metadata rendered by the Play helpers with a browser's WebMCP API.
 * This module does not install an agent, call a model, or make network requests.
 * Schema checks are structural; the browser remains responsible for full JSON Schema support.
 * Await dispose() when replacing views. Its result reports cleanup failures on older APIs.
 */
export async function registerTools(handlers, {
  document = globalThis.document,
  navigator = globalThis.navigator,
  signal
} = {}) {
  const current = document?.modelContext;
  const legacy = navigator?.modelContext;
  const api = typeof current?.registerTool === 'function' ? 'document.modelContext'
    : typeof legacy?.registerTool === 'function' ? 'navigator.modelContext' : null;
  const context = api === 'document.modelContext' ? current : legacy;
  if (!api) {
    return {
      supported: false, api: null, registered: [], cleanupErrors: [],
      dispose: async () => ({ remaining: [], errors: [] })
    };
  }

  // Validate every definition before registering the first tool.
  requireMetadata(typeof document?.querySelectorAll === 'function', 'a document is required');
  const definitions = readTools(document, handlers);
  requireMetadata(signal === undefined ||
    (typeof signal?.aborted === 'boolean' && typeof signal.addEventListener === 'function' &&
      typeof signal.removeEventListener === 'function'), 'signal must be an AbortSignal');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Registration aborted', 'AbortError');

  const controller = new AbortController();
  const registered = new Set();
  let cleanupErrors = [];
  let registrationComplete = false;
  let disposing;

  const onAbort = () => {
    controller.abort(signal.reason);
    if (registrationComplete) void dispose();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  function dispose() {
    if (disposing) return disposing;
    disposing = (async () => {
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
      cleanupErrors = [];
      if (api === 'document.modelContext') {
        // The current specification uses AbortSignal for tool unregistration.
        registered.clear();
      } else {
        for (const name of registered) {
          try {
            if (typeof context.unregisterTool !== 'function') {
              throw new Error('Legacy API has no unregisterTool; reload this page to remove its tools');
            }
            await context.unregisterTool(name);
            registered.delete(name);
          } catch (error) {
            cleanupErrors.push({ name, error });
          }
        }
      }
      return { remaining: [...registered], errors: [...cleanupErrors] };
    })().finally(() => { disposing = undefined; });
    return disposing;
  }

  try {
    for (const definition of definitions) {
      if (controller.signal.aborted) throw controller.signal.reason;
      await context.registerTool(definition, { signal: controller.signal });
      registered.add(definition.name);
      if (controller.signal.aborted) throw controller.signal.reason;
    }
    registrationComplete = true;
  } catch (cause) {
    const cleanup = await dispose();
    const error = new Error('play-webmcp: tool registration failed', { cause });
    error.name = 'PlayWebMcpRegistrationError';
    error.registered = cleanup.remaining;
    error.cleanupErrors = cleanup.errors;
    throw error;
  }

  return {
    supported: true,
    api,
    get registered() { return [...registered]; },
    get cleanupErrors() { return [...cleanupErrors]; },
    dispose
  };
}
