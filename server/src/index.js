import 'dotenv/config';
import createApp from './app.js';
import { resetStore, store } from './store/index.js';
import { formatMinor } from './lib/money.js';

const port = Number(process.env.PORT) || 4000;

const meta = resetStore({
  months: Number(process.env.SEED_MONTHS) || undefined,
  scale: Number(process.env.SEED_SCALE) || undefined,
});

const app = createApp();

app.listen(port, () => {
  const total = [...store.accounts.values()]
    .filter((account) => account.currency === 'CAD')
    .reduce((sum, account) => sum + account.openingBalance, 0);

  console.log(`
  Personal Finance Manager API
  http://localhost:${port}/api

  ${store.transactions.size} transactions across ${store.accounts.size} accounts,
  ${meta.options.historyStart} to ${meta.options.anchorDate} (opening CAD position ${formatMinor(total)}).

  In-memory only — restart or POST /api/dev/reset to start over.
`);
});
