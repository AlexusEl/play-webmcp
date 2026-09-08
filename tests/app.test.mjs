import test from 'node:test';
import assert from 'node:assert/strict';

// Application handler tests with DOM/HTTP doubles. Native integration is covered in browser.mjs.
let instance = 0;
async function application(t, language) {
  const definitions = new Map();
  const fields = Object.fromEntries(['name', 'message', 'query'].map(name => [name, { value: `draft ${name}` }]));
  const supportResult = { textContent: 'Previous request succeeded.' };
  const status = { textContent: '' };
  const supportForm = { action: 'https://example.test/shop/support', elements: { namedItem: name => fields[name] } };
  const searchForm = { elements: supportForm.elements, addEventListener() {} };
  const elements = { '#support-form': supportForm, '#search-form': searchForm,
    '#support-result': supportResult, '#webmcp-status': status };
  const replacements = {
    document: {
      modelContext: { registerTool(definition) { definitions.set(definition.name, definition); } },
      getElementById: () => ({ dataset: { webmcpRuntime: new URL('../module/src/main/assets/play-webmcp.js', import.meta.url).href } }),
      querySelector: selector => elements[selector],
      querySelectorAll: () => ['searchProducts', 'createSupportRequest'].map(handler => ({
        textContent: JSON.stringify({ name: handler, handler, description: handler, inputSchema: { type: 'object' } })
      }))
    },
    window: { confirm: () => true },
    FormData: class {
      constructor(form) {
        assert.equal(form, supportForm);
        return new Map([['csrfToken', 'existing-token'], ['name', fields.name.value], ['message', fields.message.value]]);
      }
    },
    fetch: async () => { throw new Error('Unexpected HTTP request'); }
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  await import(new URL(`../examples/${language}/public/javascripts/app.js?test=${++instance}`, import.meta.url));
  return { execute: definitions.get('createSupportRequest').execute, fields, supportResult };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

for (const language of ['java', 'scala']) {
  test(`${language}: an older support response cannot replace the latest request's outcome`, async t => {
    const app = await application(t, language);
    for (const oldResponse of [
      jsonResponse({ ok: true, message: 'Old request succeeded.' }),
      new Response('Server error', { status: 500, headers: { 'Content-Type': 'text/html' } })
    ]) {
      const old = deferred();
      const latest = { ok: true, message: 'Latest request succeeded.' };
      let requests = 0;
      globalThis.fetch = async (url, options) => {
        assert.equal(options.body.get('csrfToken'), 'existing-token');
        assert.equal(options.body.get('name'), requests === 0 ? 'Old' : 'Latest');
        return requests++ === 0 ? old.promise : jsonResponse(latest);
      };
      const first = app.execute({ name: 'Old', message: 'Old request' });
      try {
        assert.deepEqual(await app.execute({ name: 'Latest', message: 'Latest request' }), latest);
      } finally {
        old.resolve(oldResponse);
      }
      const oldResult = await first;
      assert.equal(oldResult.ok, oldResponse.ok, 'Each caller still receives its own result');
      assert.equal(app.supportResult.textContent, latest.message, 'A delayed result must preserve the latest visible outcome');
      assert.equal(app.fields.name.value, 'Latest');
      assert.equal(requests, 2);
    }
  });

  test(`${language}: a cancelled newer request keeps its notice when an older request finishes`, async t => {
    const app = await application(t, language);
    const old = deferred();
    globalThis.fetch = () => old.promise;
    const first = app.execute({ name: 'Old', message: 'Old request' });
    window.confirm = () => false;
    assert.deepEqual(await app.execute({ name: 'New', message: 'Cancelled request' }), { ok: false, cancelled: true });
    const cancellationNotice = app.supportResult.textContent;
    old.resolve(jsonResponse({ ok: true, message: 'Old request succeeded.' }));
    await first;
    assert.equal(app.supportResult.textContent, cancellationNotice);
  });
}
