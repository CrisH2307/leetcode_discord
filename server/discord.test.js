// Models the real @xhayper/discord-rpc behavior that matters for reconnecting:
// - destroy() on a client whose connection is open closes it, and closing emits "disconnected"
// - destroy() rejects a login that is still in progress with "Connection ended"
// - a login can time out while the connection is still open
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresence } from './discord.js';

function makeFakeClient({ failFirst = 0, timeoutFirst = 0, deadSends = 0, rejectSends = 0 } = {}) {
  const instances = [];
  let failures = failFirst;
  let timeouts = timeoutFirst;
  let dead = deadSends; // sends that fail like a silently dead socket (empty message)
  let rejected = rejectSends; // sends Discord rejects with a real message

  class FakeClient extends EventEmitter {
    constructor() {
      super();
      this.open = false;
      this.loginPending = null;
      this.activities = [];
      this.user = {
        username: 'me',
        setActivity: async (a) => {
          if (dead > 0) {
            dead -= 1;
            throw Object.assign(new Error(''), { name: 'NOT_CONNECTED' });
          }
          if (rejected > 0) {
            rejected -= 1;
            throw new Error('Invalid payload');
          }
          this.activities.push(a);
        },
        clearActivity: async () => this.activities.push(null),
      };
      instances.push(this);
    }

    login() {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('Unable to find any Discord client'));
      }
      this.open = true;
      if (timeouts > 0) {
        timeouts -= 1; // handshake never completes, but the socket stays open
        return new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 5));
      }
      return new Promise((resolve, reject) => {
        this.loginPending = { reject };
        setTimeout(() => {
          if (!this.loginPending) return;
          this.loginPending = null;
          this.emit('ready');
          resolve();
        }, 5);
      });
    }

    async destroy() {
      this.loginPending?.reject(new Error('Connection ended'));
      this.loginPending = null;
      const wasOpen = this.open;
      this.open = false;
      if (wasOpen) this.emit('disconnected');
    }
  }

  return { FakeClient, instances };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quietLog = () => {};
const make = (options, retryMs = 20) => {
  const fake = makeFakeClient(options);
  const presence = createPresence({ clientId: '1', dryRun: false, log: quietLog, ClientClass: fake.FakeClient, retryMs });
  return { ...fake, presence };
};

test('a successful connection after a failed attempt stays connected', async () => {
  const { presence, instances } = make({ failFirst: 1 });
  await presence.connect();
  await wait(400);
  assert.equal(presence.status(), 'connected');
  assert.equal(instances.length, 2);
});

test('a lost connection reconnects once and then stays up', async () => {
  const { presence, instances } = make();
  await presence.connect();
  await wait(50);
  assert.equal(presence.status(), 'connected');

  instances[0].open = false; // Discord closed the socket
  instances[0].emit('disconnected');
  await wait(400);

  assert.equal(presence.status(), 'connected');
  assert.equal(instances.length, 2);
});

test('a login timeout with the socket left open does not cause endless reconnecting', async () => {
  const { presence, instances } = make({ timeoutFirst: 1 });
  await presence.connect(); // times out, retry scheduled
  await wait(600); // about 30 retry intervals

  assert.equal(presence.status(), 'connected');
  assert.equal(instances.length, 2, `expected 2 clients but made ${instances.length}`);
});

test('the wanted activity is applied after reconnecting', async () => {
  const { presence, instances } = make({ failFirst: 1 });
  await presence.connect();
  await presence.set({ details: '1. Two Sum' });
  await wait(200);
  assert.deepEqual(instances.at(-1).activities.at(-1), { details: '1. Two Sum' });
});

test('the wanted activity survives a timeout and reconnect', async () => {
  const { presence, instances } = make({ timeoutFirst: 1 });
  await presence.connect();
  await presence.set({ details: '218. The Skyline Problem' });
  await wait(300);
  assert.deepEqual(instances.at(-1).activities.at(-1), { details: '218. The Skyline Problem' });
});

test('a silently dead connection is replaced and the activity is applied again', async () => {
  const { presence, instances } = make({ deadSends: 1 });
  await presence.connect();
  await wait(50);
  await presence.set({ details: '45. Jump Game II' }); // fails: socket is dead
  await wait(300);
  assert.equal(presence.status(), 'connected');
  assert.equal(instances.length, 2);
  assert.deepEqual(instances.at(-1).activities.at(-1), { details: '45. Jump Game II' });
});

test('a rejected payload does not drop the connection', async () => {
  const { presence, instances } = make({ rejectSends: 1 });
  await presence.connect();
  await wait(50);
  await presence.set({ details: 'x' }); // Discord says no
  await wait(100);
  assert.equal(presence.status(), 'connected');
  assert.equal(instances.length, 1);
});

test('repeated dead sends reconnect one at a time, not in a storm', async () => {
  const { presence, instances } = make({ deadSends: 3 });
  await presence.connect();
  await wait(50);
  await presence.set({ details: 'a' });
  await wait(600);
  assert.equal(presence.status(), 'connected');
  assert.ok(instances.length <= 5, `made ${instances.length} clients`);
  assert.deepEqual(instances.at(-1).activities.at(-1), { details: 'a' });
});
