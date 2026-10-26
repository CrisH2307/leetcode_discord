import { Client } from '@xhayper/discord-rpc';

const RETRY_MS = 10_000;

/**
 * Wraps the Discord IPC client. Holds the activity we want shown and applies it
 * whenever the connection is (re)established, so callers never deal with connection state.
 * `ClientClass` and `retryMs` exist so tests can use a fake client and a short delay.
 */
export function createPresence({ clientId, dryRun, log, ClientClass = Client, retryMs = RETRY_MS }) {
  let client = null;
  let ready = false;
  let desired = null;
  let retryTimer = null;
  // Identifies the client we currently care about. Closing an old client makes it emit a late
  // "disconnected"; without this check that event would schedule a retry which then closes the
  // healthy replacement, and the loop repeats forever.
  let generation = 0;

  async function apply() {
    if (dryRun) {
      log(desired ? `[dry-run] set ${JSON.stringify(desired)}` : '[dry-run] clear');
      return;
    }
    if (!ready || !client?.user) return;
    try {
      if (desired) await client.user.setActivity(desired);
      else await client.user.clearActivity();
    } catch (err) {
      log(`Discord error: ${err.message}`);
    }
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
  }

  async function connect() {
    if (dryRun) return;
    if (ready) return; // never replace a working connection

    const mine = ++generation;
    const old = client;
    const current = new ClientClass({ clientId });
    client = current;
    ready = false;

    if (old) old.destroy().catch(() => {}); // its events no longer matter, see `generation`

    current.on('ready', () => {
      if (mine !== generation) return;
      ready = true;
      log(`Connected to Discord as ${current.user?.username ?? 'unknown user'}`);
      apply();
    });
    current.on('disconnected', () => {
      if (mine !== generation) return;
      ready = false;
      log('Discord disconnected, will retry');
      scheduleRetry();
    });
    current.on('error', (err) => {
      if (mine === generation) log(`Discord client error: ${err?.message ?? err}`);
    });

    try {
      await current.login();
    } catch (err) {
      if (mine !== generation) return;
      ready = false;
      log(`Discord not reachable (${err.message}), will retry`);
      scheduleRetry();
    }
  }

  return {
    connect,
    set(activity) {
      desired = activity;
      return apply();
    },
    clear() {
      desired = null;
      return apply();
    },
    status() {
      if (dryRun) return 'dry-run';
      return ready ? 'connected' : 'connecting';
    },
  };
}
