/**
 * Starting point, on purpose almost empty.
 *
 * The API is already running at http://localhost:4000/api and the Vite dev
 * server proxies `/api` to it (see vite.config.js), so `fetch('/api/accounts')`
 * works from here with no CORS setup.
 *
 * Replace all of this: pick your own state management, routing, data fetching and
 * design system, and switch to TypeScript if you want it — nothing here is load
 * bearing.
 */
export default function App() {
  return (
    <main className="app">
      <h1>Personal Finance Manager</h1>
      <p>
        Frontend starting point. The API is at <code>/api</code> — see{' '}
        <code>docs/API.md</code> for the contract.
      </p>
    </main>
  );
}
