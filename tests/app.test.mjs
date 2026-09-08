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

for (const language of ['java', 'scala']) {
  test(`${language}: an already cancelled support call has no form, dialog or HTTP effects`, async t => {
    const app = await application(t, language);
    const controller = new AbortController();
    const reason = new Error('The agent cancelled this call');
    controller.abort(reason);
    let dialogs = 0;
    let requests = 0;
    window.confirm = () => { dialogs++; return true; };
    globalThis.fetch = async (url, { signal }) => { requests++; signal.throwIfAborted(); };
    const notice = app.supportResult.textContent;
    await assert.rejects(app.execute({ name: 'Agent', message: 'Cancelled' }, { signal: controller.signal }), error => error === reason);
    assert.equal(dialogs, 0);
    assert.equal(requests, 0);
    assert.equal(app.fields.name.value, 'draft name');
    assert.equal(app.fields.message.value, 'draft message');
    assert.equal(app.supportResult.textContent, notice);
  });

  test(`${language}: cancellation during confirmation prevents the HTTP request`, async t => {
    const app = await application(t, language);
    const controller = new AbortController();
    const reason = new Error('Cancelled during confirmation');
    let requests = 0;
    window.confirm = () => { controller.abort(reason); return true; };
    globalThis.fetch = async (url, { signal }) => { requests++; signal.throwIfAborted(); };
    await assert.rejects(app.execute({ name: 'Agent', message: 'Cancelled' }, { signal: controller.signal }), error => error === reason);
    assert.equal(requests, 0, 'Check cancellation again after confirmation, before starting fetch');
  });

  test(`${language}: network and malformed JSON failures replace an old success without retrying`, async t => {
    const app = await application(t, language);
    for (const failure of [new TypeError('Network failed'), new SyntaxError('Invalid server JSON')]) {
      const gate = deferred();
      const previous = 'Previous request succeeded.';
      app.supportResult.textContent = previous;
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        await gate.promise;
        if (failure instanceof TypeError) throw failure;
        return { headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => { throw failure; } };
      };
      const call = app.execute({ name: 'Agent', message: 'New request' });
      const outcome = assert.rejects(call, error => error === failure);
      const pendingNotice = app.supportResult.textContent;
      gate.resolve();
      await outcome;
      assert.notEqual(pendingNotice, previous, 'The old success must not remain visible while another request is pending');
      assert.match(app.supportResult.textContent, /n’a pas pu être confirmé/);
      assert.equal(requests, 1, 'Never retry a write operation automatically');
    }
  });

  test(`${language}: cancellation after receiving JSON cannot display success`, async t => {
    const app = await application(t, language);
    const controller = new AbortController();
    const reason = new Error('Cancelled while reading the response');
    globalThis.fetch = async () => ({
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        controller.abort(reason);
        return { ok: true, message: 'A stale success' };
      }
    });
    await assert.rejects(app.execute({ name: 'Agent', message: 'New request' }, { signal: controller.signal }), error => error === reason);
    assert.match(app.supportResult.textContent, /interrompu/);
    assert.notEqual(app.supportResult.textContent, 'A stale success');
  });

  test(`${language}: an older network failure preserves a newer success`, async t => {
    const app = await application(t, language);
    const gate = deferred();
    const failure = new TypeError('Old connection failed');
    let requests = 0;
    globalThis.fetch = async () => {
      if (requests++ === 0) { await gate.promise; throw failure; }
      return jsonResponse({ ok: true, message: 'New request succeeded.' });
    };
    const old = app.execute({ name: 'Old', message: 'Old request' });
    const failed = assert.rejects(old, error => error === failure);
    try {
      await app.execute({ name: 'New', message: 'New request' });
    } finally {
      gate.resolve();
    }
    await failed;
    assert.equal(app.supportResult.textContent, 'New request succeeded.');
  });
}
