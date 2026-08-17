import createApp from '../src/app.js';
import { resetStore } from '../src/store/index.js';

/**
 * Boots the API on an ephemeral port and returns a tiny fetch wrapper.
 * The store is process-local, and `node --test` runs each file in its own
 * process, so test files cannot see each other's writes.
 */
export async function startTestServer(seedOptions = {}) {
  resetStore(seedOptions);

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };

  return {
    request,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
