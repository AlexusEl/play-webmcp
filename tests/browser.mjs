import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.BASE_URL || 'http://localhost:9000';
const assetPath = '/assets/lib/play-webmcp/play-webmcp.js';
const browserOptions = process.env.CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
  : { channel: 'chromium' };

async function launch(native) {
  return chromium.launch({
    ...browserOptions,
    headless: true,
    args: native ? [
      '--enable-experimental-web-platform-features',
      '--enable-features=WebMCPTesting',
      '--enable-blink-features=WebMCP,WebMCPTesting'
    ] : ['--disable-blink-features=WebMCP,WebMCPTesting,WebMCPDeclarativeFileInput,WebMCPFormAssociatedCustomElements']
  });
}

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/', { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200, `Sample application must return HTTP 200 at ${baseURL}`);
  assert.match(await page.title(), /^Play WebMCP — exemple (Scala|Java)$/,
    'Refusing to interact: BASE_URL does not identify a Play WebMCP sample application');
  return { page, errors };
}

test('real browser: ordinary forms, packaged module and server validation without WebMCP', { timeout: 90000 }, async t => {
  const browser = await launch(false);
  t.after(() => browser.close());
  t.diagnostic(`Browser ${browser.version()}; sample ${baseURL}; WebMCP disabled using browser flags`);
  const context = await browser.newContext({ baseURL });
  const { page, errors } = await openPage(context);
  assert.equal(await page.evaluate(() =>
    Boolean(document.modelContext?.registerTool || navigator.modelContext?.registerTool)), false);
  assert.match(await page.locator('#webmcp-status').textContent(), /ne fournit pas WebMCP/);

  const asset = await context.request.get(assetPath);
  assert.equal(asset.status(), 200, 'The reusable module asset must be served from its packaged JAR');
  assert.match(asset.headers()['content-type'], /javascript/);
  assert.match(await asset.text(), /export async function registerTools/);
  assert.equal(await page.evaluate(async path => typeof (await import(path)).registerTools, assetPath), 'function');

  await page.locator('#query').fill('souris');
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/products'),
    page.locator('#search-form button').click()
  ]);
  await page.waitForFunction(() => document.querySelector('#search-results')?.textContent.trim() === 'Souris');
  assert.deepEqual(await page.locator('#search-results li').allTextContents(), ['Souris']);

  const token = await page.locator('#support-form input[type="hidden"]').evaluate(element => ({
    name: element.name, value: element.value
  }));
  assert.ok(token.name && token.value, 'Play must render a nonempty CSRF token');
  const post = form => context.request.post('/support', {
    headers: { Accept: 'application/json' }, form
  });
  const invalid = await post({ [token.name]: token.value, name: '', message: '' });
  assert.equal(invalid.status(), 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.ok, false);
  assert.ok(invalidBody.errors.name && invalidBody.errors.message, 'Field errors must reach the caller');
  const valid = await post({ [token.name]: token.value, name: 'Ada', message: 'Besoin d’aide' });
  assert.equal(valid.status(), 200);
  assert.equal((await valid.json()).ok, true);
  const missingToken = await post({ name: 'Ada', message: 'Besoin d’aide' });
  assert.equal(missingToken.status(), 403, 'An existing session must not authorize a tokenless POST');
  const wrongToken = await post({ [token.name]: 'invalid-token', name: 'Ada', message: 'Besoin d’aide' });
  assert.equal(wrongToken.status(), 403, 'Invalid CSRF tokens must be rejected');
  const invalidSearch = await context.request.get(`/api/products?query=${'x'.repeat(101)}`);
  assert.equal(invalidSearch.status(), 400);
  assert.ok((await invalidSearch.json()).errors.query);

  await page.locator('#name').fill('Ada');
  await page.locator('#message').fill('Une demande envoyée depuis le formulaire.');
  await Promise.all([
    page.waitForURL('**/support'),
    page.locator('#support-form button').click()
  ]);
  assert.match(await page.locator('#support-result').textContent(), /Demande validée pour Ada/);
  assert.deepEqual(errors, []);

  // Prove that the existing server-rendered forms also work with JavaScript disabled.
  const plain = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const { page: plainPage } = await openPage(plain);
  await plainPage.locator('#query').fill('clav');
  await Promise.all([
    plainPage.waitForURL('**/?query=clav'),
    plainPage.locator('#search-form button').click()
  ]);
  assert.deepEqual(await plainPage.locator('#search-results li').allTextContents(), ['Clavier']);
  await plainPage.locator('#name').fill('Grace');
  await plainPage.locator('#message').fill('Une demande sans JavaScript.');
  await Promise.all([
    plainPage.waitForURL('**/support'),
    plainPage.locator('#support-form button').click()
  ]);
  assert.match(await plainPage.locator('#support-result').textContent(), /Demande validée pour Grace/);
});

async function nativeInterface(page) {
  return page.evaluate(async () => {
    const native = fn => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
    if (native(document.modelContext?.registerTool) && native(document.modelContext?.getTools) &&
        native(document.modelContext?.executeTool)) {
      const tool = (await document.modelContext.getTools()).find(tool => tool.name === 'search_products');
      // Chromium 153 exposes both schema and invocation arguments as JSON strings.
      // The current draft exposes both as objects. Inspect this interface before execution.
      // https://chromium.googlesource.com/chromium/src/+/153.0.8010.12/third_party/blink/renderer/core/script_tools/model_context.idl
      if (typeof tool?.inputSchema === 'string') return { name: 'document.modelContext', arguments: 'json-string' };
      if (tool?.inputSchema && typeof tool.inputSchema === 'object') return { name: 'document.modelContext', arguments: 'object' };
      return null;
    }
    for (const [name, testing] of [
      ['document.modelContextTesting', document.modelContextTesting],
      ['navigator.modelContextTesting', navigator.modelContextTesting]
    ]) {
      if (native(document.modelContext?.registerTool || navigator.modelContext?.registerTool) &&
          native(testing?.listTools) && native(testing?.executeTool)) return { name, arguments: 'json-string' };
    }
    return null;
  });
}

async function listTools(page, api) {
  return page.evaluate(async api => {
    const context = api.name === 'document.modelContext' ? document.modelContext
      : api.name === 'document.modelContextTesting' ? document.modelContextTesting : navigator.modelContextTesting;
    const tools = await (api.name === 'document.modelContext' ? context.getTools() : context.listTools());
    return tools.map(tool => ({ name: tool.name, description: tool.description }));
  }, api);
}

async function executeTool(page, api, name, input) {
  const result = await page.evaluate(async ({ api, name, input }) => {
    if (api.name === 'document.modelContext') {
      const context = document.modelContext;
      const tool = (await context.getTools()).find(tool => tool.name === name);
      if (!tool) throw new Error(`Native tool not found: ${name}`);
      return context.executeTool(tool, api.arguments === 'json-string' ? JSON.stringify(input) : input);
    }
    // Older Chromium testing IDL: executeTool(DOMString name, DOMString inputArguments).
    // Select the known interface before invocation; never retry a mutation with another signature.
    const testing = api.name === 'document.modelContextTesting'
      ? document.modelContextTesting : navigator.modelContextTesting;
    return testing.executeTool(name, JSON.stringify(input));
  }, { api, name, input });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

test('real browser: native WebMCP discovers and executes the application tools', { timeout: 90000 }, async t => {
  const browser = await launch(true);
  t.after(() => browser.close());
  const context = await browser.newContext({ baseURL });
  const { page, errors } = await openPage(context);
  const api = await nativeInterface(page);
  assert.ok(api, `Chromium ${browser.version()} does not expose native WebMCP registration and invocation on ${baseURL}. ` +
    'Install the pinned Playwright Chromium with npx playwright install chromium. No shim or skipped test is used.');
  t.diagnostic(`Browser ${browser.version()}; native interface ${api.name}; arguments ${api.arguments}; sample ${baseURL}`);
  assert.match(await page.locator('#webmcp-status').textContent(), /outils WebMCP sont prêts/);
  const tools = await listTools(page, api);
  for (const name of ['search_products', 'create_support_request', 'send_support_form']) {
    assert.ok(tools.some(tool => tool.name === name), `The browser must discover ${name}`);
  }
  t.diagnostic(`Discovered native tools: ${tools.map(tool => tool.name).join(', ')}`);

  const result = await executeTool(page, api, 'search_products', { query: 'clav' });
  assert.deepEqual(result, { ok: true, products: ['Clavier'] });
  assert.equal(await page.locator('#query').inputValue(), 'clav');
  assert.deepEqual(await page.locator('#search-results li').allTextContents(), ['Clavier']);

  let supportRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/support') supportRequests++;
  });
  page.once('dialog', dialog => dialog.dismiss());
  const cancelled = await executeTool(page, api, 'create_support_request', { name: 'Ada', message: 'Annuler cette demande.' });
  assert.deepEqual(cancelled, { ok: false, cancelled: true });
  assert.equal(supportRequests, 0, 'Dismissing confirmation must not contact the mutation endpoint');
  assert.match(await page.locator('#support-result').textContent(), /Demande annulée/);

  page.once('dialog', dialog => dialog.accept());
  const created = await executeTool(page, api, 'create_support_request', { name: 'Ada', message: 'Besoin d’aide.' });
  assert.equal(created.ok, true, 'A native tool must submit the real Play CSRF token and pass server validation');
  assert.equal(supportRequests, 1, 'The confirmed native tool executes its POST exactly once');
  assert.match(created.message, /Demande validée pour Ada/);
  assert.equal(await page.locator('#support-result').textContent(), created.message);
  assert.deepEqual(errors, []);
});
