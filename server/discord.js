import { Client } from '@xhayper/discord-rpc';

const RETRY_MS = 10_000;
const FAST_RETRY_MS = 2_000; // after a dead connection is noticed while sending

// Errors that mean "the connection is gone", as opposed to Discord rejecting the content.
// The library throws these with an empty message, which used to show up as a bare "Discord error:".
function isConnectionError(err) {
  if (!err?.message) return true;
  return /not.?connected|connection (ended|closed|timed out)|timed out/i.test(`${err.name} ${err.message}`);
}

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
      const label = [err?.name, err?.message].filter((part) => part && part !== 'Error').join(': ') || String(err);
      log(`Discord error: ${label}`);
      if (isConnectionError(err)) connectionLost(label);
    }
  }

  function scheduleRetry(delay = retryMs) {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  // The socket died without a "disconnected" event (Discord restarted, laptop slept). Without this
  // the server believed it was connected and every update failed until it was restarted by hand.
  function connectionLost(why) {
    if (!ready) return;
    ready = false;
    generation += 1; // ignore anything the dead client still emits
    const dead = client;
    client = null;
    dead?.destroy().catch(() => {});
    log(`Discord connection lost (${why}), reconnecting`);
    scheduleRetry(Math.min(retryMs, FAST_RETRY_MS));
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
