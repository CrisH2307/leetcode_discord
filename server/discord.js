import { Client } from '@xhayper/discord-rpc';

const RETRY_MS = 10_000;

/**
 * Wraps the Discord IPC client. Holds the activity we want shown and applies it
 * whenever the connection is (re)established, so callers never deal with connection state.
 */
export function createPresence({ clientId, dryRun, log }) {
  let client = null;
  let ready = false;
  let desired = null;
  let retryTimer = null;

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
    }, RETRY_MS);
  }

  async function connect() {
    if (dryRun) return;
    try {
      await client?.destroy();
    } catch {
      // old client may already be gone
    }
    client = new Client({ clientId });
    client.on('ready', () => {
      ready = true;
      log(`Connected to Discord as ${client.user?.username ?? 'unknown user'}`);
      apply();
    });
    client.on('disconnected', () => {
      ready = false;
      log('Discord disconnected, will retry');
      scheduleRetry();
    });
    try {
      await client.login();
    } catch (err) {
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
