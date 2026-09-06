import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../module/src/main/resources/META-INF/resources/webjars/play-webmcp/0.1.0/play-webmcp.js';

// These are API contract tests with doubles, not tests of native browser/agent support.
const tool = (changes = {}) => ({
  name: 'search_products', description: 'Search the product catalogue', handler: 'search',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  ...changes
});
const handlers = { search: input => ({ items: [input.query] }) };
function documentFor(specs = [tool()], modelContext) {
  return {
    modelContext,
    querySelectorAll(selector) {
      assert.equal(selector, 'script[type="application/json"][data-play-webmcp]');
      return specs.map(spec => ({ textContent: typeof spec === 'string' ? spec : JSON.stringify(spec) }));
    }
  };
}
function nativeContext() {
  const tools = new Map();
  return {
    tools,
    async registerTool(definition, { signal }) {
      assert.equal(this.tools, tools, 'preserves the API receiver');
      if (tools.has(definition.name)) throw new Error('Already registered');
      tools.set(definition.name, definition);
      signal.addEventListener('abort', () => tools.delete(definition.name), { once: true });
    }
  };
}

test('missing API is a safe no-op, including outside a browser', async () => {
  const report = await registerTools(null, { document: undefined, navigator: undefined });
  assert.equal(report.supported, false);
  assert.equal(report.api, null);
  assert.deepEqual(report.registered, []);
  assert.deepEqual(await report.dispose(), { remaining: [], errors: [] });
  const noRead = { querySelectorAll() { throw new Error('Must not read metadata'); } };
  assert.equal((await registerTools({}, { document: noRead, navigator: {} })).supported, false);
});

test('prefers document API, preserves structured results, annotations and execution cancellation', async () => {
  const context = nativeContext();
  const result = { content: [{ type: 'text', text: 'Found one' }], structuredContent: { count: 1 } };
  const input = { query: 'pen' };
  const execution = { signal: new AbortController().signal };
  const report = await registerTools({ search: async (actualInput, actualExecution) => {
    assert.equal(actualInput, input);
    assert.equal(actualExecution, execution);
    return result;
  } }, {
    document: documentFor([tool({ annotations: { readOnlyHint: true } })], context),
    navigator: { modelContext: { registerTool() { assert.fail('Must prefer document API'); } } }
  });
  assert.equal(report.supported, true);
  assert.equal(report.api, 'document.modelContext');
  assert.deepEqual(report.registered, ['search_products']);
  const definition = context.tools.get('search_products');
  assert.deepEqual(definition.annotations, { readOnlyHint: true });
  assert.equal(await definition.execute(input, execution), result);
  assert.deepEqual(await report.dispose(), { remaining: [], errors: [] });
  assert.equal(context.tools.size, 0);
  assert.deepEqual(report.registered, []);
  assert.deepEqual(await report.dispose(), { remaining: [], errors: [] });
});

test('legacy navigator API is explicitly reported and cleaned up by name', async () => {
  const tools = new Map();
  const context = {
    registerTool(definition) { tools.set(definition.name, definition); },
    unregisterTool(name) { tools.delete(name); }
  };
  const report = await registerTools(handlers, { document: documentFor(), navigator: { modelContext: context } });
  assert.equal(report.api, 'navigator.modelContext');
  assert.deepEqual(await tools.get('search_products').execute({ query: 'pen' }), { items: ['pen'] });
  await report.dispose();
  assert.equal(tools.size, 0);
});

test('validates the complete metadata batch before registration', async t => {
  const invalid = [
    ['malformed JSON', '{invalid'],
    ['non-object metadata', 'null'],
    ['missing description', tool({ name: 'second', description: '' })],
    ['unknown handler', tool({ name: 'second', handler: 'missing' })],
    ['inherited handler', tool({ name: 'second', handler: 'toString' })],
    ['duplicate names', tool()],
    ['invalid root schema', tool({ name: 'second', inputSchema: { type: 'array' } })],
    ['invalid properties', tool({ name: 'second', inputSchema: { type: 'object', properties: [] } })],
    ['invalid property schema', tool({ name: 'second', inputSchema: { type: 'object', properties: { q: 1 } } })],
    ['invalid required', tool({ name: 'second', inputSchema: { type: 'object', required: ['q', 'q'] } })],
    ['invalid annotations', tool({ name: 'second', annotations: { readOnlyHint: 'true' } })]
  ];
  for (const [label, second] of invalid) {
    await t.test(label, async () => {
      let called = false;
      const document = documentFor([tool(), second], { registerTool() { called = true; } });
      await assert.rejects(registerTools(handlers, { document, navigator: {} }), TypeError);
      assert.equal(called, false);
    });
  }
});

test('native registration failure rolls back earlier tools and preserves the cause', async () => {
  const context = nativeContext();
  const originalRegister = context.registerTool;
  const failure = new Error('Browser rejected the schema');
  context.registerTool = async function (definition, options) {
    if (definition.name === 'second') throw failure;
    return originalRegister.call(this, definition, options);
  };
  await assert.rejects(registerTools(handlers, {
    document: documentFor([tool(), tool({ name: 'second' })], context), navigator: {}
  }), error => {
    assert.equal(error.name, 'PlayWebMcpRegistrationError');
    assert.equal(error.cause, failure);
    assert.deepEqual(error.registered, []);
    assert.deepEqual(error.cleanupErrors, []);
    return true;
  });
  assert.equal(context.tools.size, 0);
});

test('disposal reports legacy cleanup failures and can retry', async () => {
  const context = { registerTool() {} };
  const report = await registerTools(handlers, { document: documentFor(), navigator: { modelContext: context } });
  const cleanup = await report.dispose();
  assert.deepEqual(cleanup.remaining, ['search_products']);
  assert.equal(cleanup.errors.length, 1);
  assert.match(cleanup.errors[0].error.message, /reload this page/);
  assert.equal(report.cleanupErrors.length, 1);
  context.unregisterTool = () => {};
  assert.deepEqual(await report.dispose(), { remaining: [], errors: [] });
});

test('registration error reports any legacy tools which could not be removed', async () => {
  const context = { registerTool(definition) { if (definition.name === 'second') throw new Error('No'); } };
  await assert.rejects(registerTools(handlers, {
    document: documentFor([tool(), tool({ name: 'second' })]), navigator: { modelContext: context }
  }), error => {
    assert.deepEqual(error.registered, ['search_products']);
    assert.equal(error.cleanupErrors.length, 1);
    return true;
  });
});

test('external abort disposes an established registration', async () => {
  const context = nativeContext();
  const controller = new AbortController();
  const report = await registerTools(handlers, {
    document: documentFor([tool()], context), navigator: {}, signal: controller.signal
  });
  controller.abort();
  assert.equal(context.tools.size, 0);
  assert.deepEqual(report.registered, []);
});

test('an already aborted signal causes no registrations', async () => {
  const context = nativeContext();
  const controller = new AbortController();
  const reason = new Error('View is gone');
  controller.abort(reason);
  await assert.rejects(registerTools(handlers, {
    document: documentFor([tool()], context), navigator: {}, signal: controller.signal
  }), error => error === reason);
  assert.equal(context.tools.size, 0);
});

test('abort while an old API registration is pending removes it once completed', async () => {
  const controller = new AbortController();
  const tools = new Set();
  let complete;
  const context = {
    registerTool(definition) {
      return new Promise(resolve => { complete = () => { tools.add(definition.name); resolve(); }; });
    },
    unregisterTool(name) { tools.delete(name); }
  };
  const registering = registerTools(handlers, {
    document: documentFor(), navigator: { modelContext: context }, signal: controller.signal
  });
  controller.abort();
  complete();
  await assert.rejects(registering, error => error.cause.name === 'AbortError');
  assert.equal(tools.size, 0);
});

test('registration never executes application handlers and execution failures reach the caller', async () => {
  const context = nativeContext();
  const failure = new Error('Server rejected this operation');
  let calls = 0;
  const report = await registerTools({ search: async () => { calls++; throw failure; } }, {
    document: documentFor([tool()], context), navigator: {}
  });
  assert.equal(calls, 0);
  await assert.rejects(context.tools.get('search_products').execute({ query: 'pen' }), error => error === failure);
  assert.equal(calls, 1);
  await report.dispose();
});
