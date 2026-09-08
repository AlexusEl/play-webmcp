const runtimeUrl = document.getElementById('page-tools').dataset.webmcpRuntime;
const { registerTools } = await import(runtimeUrl);

const searchForm = document.querySelector('#search-form');
const supportForm = document.querySelector('#support-form');
const status = document.querySelector('#webmcp-status');
const supportResult = document.querySelector('#support-result');

let latestSearch = 0;
let latestSupport = 0;

async function searchProducts({ query }, context = {}) {
  context.signal?.throwIfAborted();
  const requestId = ++latestSearch;
  // Set agent-provided input before the request, so a response cannot overwrite a user's draft.
  searchForm.elements.namedItem('query').value = query;
  try {
    const url = new URL(searchForm.dataset.searchUrl, location.href);
    url.searchParams.set('query', query);
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: context.signal
    });
    const result = await response.json();
    context.signal?.throwIfAborted();
    // Each caller receives its own result; only the latest search updates the shared page.
    if (requestId !== latestSearch) return result;
    const list = document.querySelector('#search-results');
    list.replaceChildren();
    for (const product of result.products || []) {
      const item = document.createElement('li');
      item.textContent = product;
      list.append(item);
    }
    if (!response.ok) status.textContent = 'La recherche est invalide.';
    return result;
  } catch (error) {
    if (requestId === latestSearch && !context.signal?.aborted) {
      status.textContent = 'La recherche a échoué. Réessayez.';
    }
    throw error;
  }
}

async function createSupportRequest({ name, message }, context = {}) {
  context.signal?.throwIfAborted();
  const requestId = ++latestSupport;
  supportForm.elements.namedItem('name').value = name;
  supportForm.elements.namedItem('message').value = message;
  try {
    const confirmed = window.confirm(`Valider cette demande de support pour ${name} ?\n\n${message}`);
    context.signal?.throwIfAborted();
    if (!confirmed) {
      supportResult.textContent = 'Demande annulée.';
      return { ok: false, cancelled: true };
    }
    supportResult.textContent = 'Envoi de la demande…';
    // FormData includes the CSRF field rendered by Play; never invent a token.
    const body = new URLSearchParams(new FormData(supportForm));
    const response = await fetch(supportForm.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body,
      signal: context.signal
    });
    context.signal?.throwIfAborted();
    if (!response.headers.get('content-type')?.includes('application/json')) {
      const notice = 'L’envoi n’a pas pu être confirmé. Vérifiez son état avant de réessayer.';
      if (requestId === latestSupport) supportResult.textContent = notice;
      return { ok: false, status: response.status, message: notice };
    }
    const result = await response.json();
    context.signal?.throwIfAborted();
    // Each caller receives its own result; only the latest request owns the visible notice.
    if (requestId === latestSupport) {
      supportResult.textContent = result.ok
        ? result.message
        : `Corrigez votre demande : ${JSON.stringify(result.errors)}`;
    }
    return result;
  } catch (error) {
    if (requestId === latestSupport) {
      supportResult.textContent = context.signal?.aborted
        ? 'Envoi interrompu. Vérifiez l’état de la demande avant de réessayer.'
        : 'L’envoi n’a pas pu être confirmé. Vérifiez son état avant de réessayer.';
    }
    // A failed or cancelled response does not prove that the server rejected the write.
    throw error;
  }
}

// Human search is enhanced by the same handler; native GET remains a fallback.
searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await searchProducts({ query: searchForm.elements.namedItem('query').value });
  } catch {
    // The handler already displayed any error belonging to the current search.
  }
});

try {
  const registration = await registerTools({ searchProducts, createSupportRequest });
  status.textContent = registration.supported
    ? 'Les outils WebMCP sont prêts pour un agent compatible.'
    : 'Ce navigateur ne fournit pas WebMCP. Les formulaires restent disponibles.';
} catch (error) {
  status.textContent = 'Les outils WebMCP n’ont pas pu être enregistrés. Les formulaires restent disponibles.';
  console.error('WebMCP registration failed', error);
}
