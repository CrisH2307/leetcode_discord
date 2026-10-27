// Runs on every leetcode.com page. LeetCode is a single page app, so the URL is polled
// instead of read once. Only /problems/<slug>/ pages produce a presence (contest pages
// live under /contest/ and are deliberately ignored).
(() => {
  const SLUG_RE = /^\/problems\/([a-z0-9-]+)(?:\/|$)/;
  const HEARTBEAT_MS = 20_000;
  const RETRY_META_MS = 10_000;
  // The first query also asks for topic tags. If LeetCode ever rejects that field, the second one
  // keeps the card working (without topics) instead of breaking it.
  const QUERY_WITH_TOPICS =
    'query q($titleSlug: String!) { question(titleSlug: $titleSlug) { questionFrontendId title difficulty topicTags { name } } }';
  const QUERY_BASIC =
    'query q($titleSlug: String!) { question(titleSlug: $titleSlug) { questionFrontendId title difficulty } }';

  const metaCache = new Map();
  let current = null; // { slug, startedAt, meta, lastSent, metaFailedAt }
  let busy = false;

  const slugFromLocation = () => location.pathname.match(SLUG_RE)?.[1] ?? null;

  function startTimeFor(slug) {
    const key = `lcrpc:start:${slug}`;
    try {
      const saved = Number(sessionStorage.getItem(key));
      if (saved > 0) return saved;
      const now = Date.now();
      sessionStorage.setItem(key, String(now));
      return now;
    } catch {
      return Date.now();
    }
  }

  async function queryQuestion(query, slug) {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { titleSlug: slug } }),
    });
    if (!res.ok) throw new Error(`graphql ${res.status}`);
    return (await res.json())?.data?.question ?? null;
  }

  async function fetchMeta(slug) {
    if (metaCache.has(slug)) return metaCache.get(slug);
    let question = null;
    try {
      question = await queryQuestion(QUERY_WITH_TOPICS, slug);
    } catch {
      // fall through to the basic query
    }
    if (!question) question = await queryQuestion(QUERY_BASIC, slug);
    if (!question) throw new Error('question not found');
    const meta = {
      number: Number(question.questionFrontendId),
      title: question.title,
      difficulty: question.difficulty,
      topics: Array.isArray(question.topicTags) ? question.topicTags.map((t) => t?.name).filter(Boolean) : [],
    };
    metaCache.set(slug, meta);
    return meta;
  }

  function send(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // extension was reloaded; this page needs a refresh
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const slug = slugFromLocation();
      if (!slug) {
        if (current) {
          current = null;
          send({ type: 'clear' });
        }
        return;
      }

      if (!current || current.slug !== slug) {
        current = { slug, startedAt: startTimeFor(slug), meta: null, lastSent: 0, metaFailedAt: 0 };
      }

      if (!current.meta) {
        if (Date.now() - current.metaFailedAt < RETRY_META_MS) return;
        try {
          current.meta = await fetchMeta(slug);
        } catch (err) {
          current.metaFailedAt = Date.now();
          console.warn('[leetcode-rpc] metadata fetch failed:', err.message);
          return;
        }
        if (slugFromLocation() !== slug) return; // navigated away while fetching
      }

      if (document.visibilityState !== 'visible') return;
      if (Date.now() - current.lastSent < HEARTBEAT_MS) return;

      if (current.lastSent === 0) {
        console.log(`[leetcode-rpc] tracking ${current.meta.number}. ${current.meta.title} (${current.meta.difficulty}) [${current.meta.topics.join(', ')}]`);
      }
      current.lastSent = Date.now();
      send({
        type: 'presence',
        slug,
        number: current.meta.number,
        title: current.meta.title,
        difficulty: current.meta.difficulty,
        topics: current.meta.topics,
        startedAt: current.startedAt,
        url: `https://leetcode.com/problems/${slug}/`,
      });
    } finally {
      busy = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current) current.lastSent = 0;
  });
  window.addEventListener('pagehide', () => send({ type: 'clear' }));

  setInterval(tick, 1000);
  tick();
})();
