(() => {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  if (globalThis.__captainPageController?.isAlive()) return;
  globalThis.__captainPageController?.dispose();
  // A reloaded extension gets a new isolated context, but the old DOM remains.
  // Tell a previous panel to stop its timers/listeners before replacing it.
  if (chrome.runtime.id) {
    document.dispatchEvent?.(new Event('captain:panel-replaced'));
    document.querySelector('#captain-agent-host')?.remove();
  }
  let connected = true, disposePanel = () => {};
  function runtimeAlive() { try { return connected && !!chrome.runtime.id; } catch { return false; } }
  function dispose() {
    connected = false;
    disposePanel();
    try { chrome.runtime.onMessage.removeListener?.(onMessage); } catch {}
    document.removeEventListener?.('captain:panel-replaced', dispose);
  }
  globalThis.__captainPageController = { isAlive: runtimeAlive, dispose };
  document.addEventListener?.('captain:panel-replaced', dispose, { once: true });
  const REDACTORS = [
    ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ['PHONE', /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g],
    ['CARD', /\b(?:\d[ -]*?){13,19}\b/g],
    ['AADHAAR', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
    ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ];
  const SECRET_HINT = /password|passcode|otp|one.?time|cvv|cc-|card.?number|aadhaar|pan.?number|account.?number/i;
  function sensitiveInputType(el) {
    if (!el) return '';
    const hint = `${el.type || ''} ${el.name || ''} ${el.id || ''} ${el.autocomplete || ''} ${el.getAttribute?.('aria-label') || ''} ${el.labels?.[0]?.innerText || ''}`.toLowerCase();
    if (el.type === 'password' || /password|passcode/.test(hint)) return 'password';
    if (/one.?time|\botp\b/.test(hint)) return 'otp';
    if (/\bcvv\b|security.?code/.test(hint)) return 'cvv';
    if (/card.?number|cc-number/.test(hint)) return 'card';
    if (/\bpin\b/.test(hint)) return 'pin';
    if (/api.?key/.test(hint)) return 'api-key';
    if (/bearer|access.?token|auth.?token|session.?id/.test(hint)) return 'token';
    if (/security.?answer/.test(hint)) return 'security-answer';
    if (/secret|private.?credential|account.?number|aadhaar|pan.?number/.test(hint)) return 'secret';
    return '';
  }

  function redact(value) {
    let text = String(value || '');
    const found = [];
    for (const [kind, regex] of REDACTORS) {
      regex.lastIndex = 0;
      text = text.replace(regex, () => { found.push(kind); return `[REDACTED_${kind}]`; });
    }
    text = text.replace(/\b(name|full name|address|date of birth|dob|passport(?: number)?|account(?: number)?|ifsc)\s*:\s*([^\n|·]{3,80})/gi, (_all, label) => {
      found.push(label.toUpperCase().replaceAll(' ', '_'));
      return `${label}: [REDACTED_PII]`;
    });
    return { text, found };
  }

  function textFindings(value) {
    const text = String(value || ''), findings = [];
    for (const [kind, regex] of REDACTORS) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) findings.push({ kind, index: match.index, length: match[0].length });
    }
    const semantic = /\b(name|full name|address|date of birth|dob|passport(?: number)?|account(?: number)?|ifsc)\s*:\s*([^\n|·]{3,80})/gi;
    for (const match of text.matchAll(semantic)) findings.push({ kind: 'PII', index: match.index, length: match[0].length });
    return findings;
  }

  function sensitiveTextRegions() {
    if (!document.createTreeWalker || typeof NodeFilter === 'undefined' || typeof Range === 'undefined') return [];
    const regions = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, visited = 0;
    while ((node = walker.nextNode()) && visited++ < 1600 && regions.length < 160) {
      const parent = node.parentElement, value = node.nodeValue || '';
      if (!parent || !value.trim() || /^(?:script|style|noscript|template)$/i.test(parent.tagName) || !visible(parent)) continue;
      for (const finding of textFindings(value)) {
        const range = new Range();
        try {
          range.setStart(node, finding.index); range.setEnd(node, finding.index + finding.length);
          for (const rect of range.getClientRects()) if (rect.width > 1 && rect.height > 1) regions.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, kind: finding.kind });
        } catch {}
        if (regions.length >= 160) break;
      }
    }
    return regions;
  }

  function uninspectableVisualRegions() {
    const regions = [], seen = new Set();
    const add = (el, kind) => {
      if (!el || seen.has(el) || !visible(el) || regions.length >= 120) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 3 || rect.height < 3) return;
      seen.add(el); regions.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, kind });
    };
    document.querySelectorAll('img,canvas,video,iframe,embed,object').forEach(el => add(el, 'RASTER_CONTENT'));
    // CSS background images can contain text/identifiers that DOM scanning cannot inspect.
    for (const el of [...document.querySelectorAll('body *')].slice(0, 1600)) {
      if (regions.length >= 120) break;
      try { if (getComputedStyle(el).backgroundImage !== 'none') add(el, 'BACKGROUND_IMAGE'); } catch {}
    }
    return regions;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom >= 0 && r.right >= 0 && r.top <= innerHeight && r.left <= innerWidth;
  }

  function detectHumanChallenge() {
    const title = String(document.title || '');
    const text = String(document.body?.innerText || '').slice(0, 12000);
    const selectors = [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', '[class*="h-captcha"]',
      '[id*="captcha" i]', '[class*="captcha" i]', 'input[name*="captcha" i]',
      'form[action*="captcha" i]', '[data-sitekey]', '[aria-label*="human verification" i]'
    ];
    const selectorHit = selectors.find(selector => { try { return !!document.querySelector(selector); } catch { return false; } });
    const phrases = [
      /verify (?:that )?you(?:'re| are) (?:a )?human/i,
      /complete the (?:security )?check/i,
      /enter the characters you see/i,
      /automated access|unusual traffic|bot verification/i,
      /captcha/i
    ];
    const phrase = phrases.find(pattern => pattern.test(`${title}\n${text}`));
    // A casual article mentioning CAPTCHA is not a challenge. Require a
    // challenge control or a strong verification phrase near the page shell.
    const strongPhrase = phrase && (/verify|security check|characters you see|automated access|unusual traffic|bot verification/i.test(`${title}\n${text.slice(0, 2500)}`));
    const detected = !!selectorHit || !!strongPhrase;
    return detected ? { detected: true, kind: selectorHit?.includes('captcha') || /captcha|characters you see/i.test(phrase?.source || '') ? 'captcha' : 'bot_challenge', confidence: selectorHit && phrase ? 0.99 : 0.93, indicators: [selectorHit ? 'challenge-control' : '', phrase ? 'verification-text' : ''].filter(Boolean) } : { detected: false, kind: '', confidence: 1, indicators: [] };
  }

  const playRequests = new WeakMap();
  const observedTargets = new Map();
  const discoveredLinks = new Map();
  function displayedResultOrigin(el) {
    // Google may use an opaque /goto link. The visible result still includes a
    // cited address: navigate only its complete HTTPS origin, never decode or
    // guess the opaque token, and never turn a shortened hostname into a URL.
    if (location.hostname !== 'www.google.com' || location.pathname !== '/search' || !el.closest?.('#search, #rso') || el.closest?.('#tads, #tadsb, #bottomads, [data-text-ad], [data-ad-client], [aria-label="Ads"], [aria-label="Sponsored"]')) return null;
    const cite = el.querySelector?.('cite'), heading = el.querySelector?.('h3');
    if (!cite || !heading || !visible(cite) || !visible(heading)) return null;
    const match = (cite.innerText || cite.textContent || '').trim().match(/^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})(?=\s|\/|$)/i);
    if (!match) return null;
    try {
      const link = new URL(el.href), address = new URL(`https://${match[1]}/`);
      if (link.origin !== 'https://www.google.com' || link.username || link.password || !['/goto', '/url'].includes(link.pathname) || address.hostname.includes('..')) return null;
      return address;
    } catch { return null; }
  }
  const MEDIA_ERRORS = { 1: 'Media loading was aborted.', 2: 'The player could not download its media.', 3: 'The browser could not decode this media.', 4: 'This media format or source is unavailable.' };
  function mediaError(media) {
    return media?.error ? { code: media.error.code || 0, message: MEDIA_ERRORS[media.error.code] || 'The media player reported an error.' } : null;
  }
  function mediaSource(media) { return media.currentSrc || media.src || media.srcObject || media.querySelector?.('source[src]')?.src || ''; }
  function primaryMedia() {
    const all = [...document.querySelectorAll('video,audio')];
    const onYoutube = /(^|\.)youtube\.com$/.test(location.hostname || '');
    // YouTube keeps empty/hidden player elements around. Observation and actions
    // must agree on the actual main player rather than whichever video is first.
    const main = onYoutube ? all.filter(media => media.closest?.('#movie_player')) : [];
    const candidates = main.length ? main : all;
    return candidates.map(media => ({ media, score: (mediaSource(media) ? 16 : 0) + (visible(media) ? 8 : 0) + (!media.paused ? 2 : 0) + (media.readyState >= 2 ? 1 : 0) }))
      .filter(({ media }) => mediaSource(media) || visible(media))
      .sort((a, b) => b.score - a.score)[0]?.media || null;
  }
  function playControl(media) {
    const player = media.closest?.('#movie_player');
    if (!player) return null;
    return [...player.querySelectorAll('.ytp-play-button, .ytp-large-play-button')].find(button => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''}`;
      return visible(button) && !/\bpause\b/i.test(label) && !button.disabled;
    }) || null;
  }
  function playbackClick(media) {
    const button = playControl(media), box = button?.getBoundingClientRect();
    return box ? { ok: false, requiresPlayClick: { x: box.x + box.width / 2, y: box.y + box.height / 2 } } : { ok: false, error: 'Playback needs a click on the visible page player.' };
  }

  function amazonPrice(root) {
    const labels = [...root.querySelectorAll('.a-price .a-offscreen,.a-price,[data-a-color="price"]')]
      .map(el => el.getAttribute('aria-label') || el.textContent || '');
    for (const label of labels) {
      const match = label.match(/(?:₹|INR\s*)\s*([\d,]+(?:\.\d{1,2})?)/i);
      const value = Number(match?.[1]?.replaceAll(',', ''));
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }
  function amazonDirectLink(card, asin) {
    return [...card.querySelectorAll('a[href]')].find(anchor => {
      try {
        const url = new URL(anchor.href);
        return url.protocol === 'https:' && /(^|\.)amazon\.in$/i.test(url.hostname) && new RegExp(`/(?:dp|gp/product)/${asin}(?:/|$)`, 'i').test(url.pathname);
      } catch { return false; }
    }) || null;
  }
  function amazonProducts(elements) {
    if (!/(^|\.)amazon\.in$/i.test(location.hostname) || location.pathname !== '/s') return [];
    const roots = [...new Set([
      ...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]'),
      ...document.querySelectorAll('[data-asin]:not([data-asin=""])')
    ])];
    const byAsin = new Map();
    let position = 0;
    for (const card of roots) {
      const box = card.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const asin = (card.getAttribute('data-asin') || '').toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const link = amazonDirectLink(card, asin);
      const heading = card.querySelector('h2,[role="heading"]');
      const titleResult = redact(heading?.innerText || link?.innerText || link?.getAttribute('aria-label') || '');
      const title = titleResult.found.length ? '' : titleResult.text.replace(/\s+/g, ' ').trim().slice(0, 240);
      const price = amazonPrice(card);
      const text = card.innerText || '';
      const ratingLabel = [...card.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label') || '').find(value => /[1-5](?:\.\d)?\s+out of 5/i.test(value)) || '';
      const rating = Number(ratingLabel.match(/([1-5](?:\.\d)?)\s+out of 5/i)?.[1]);
      const reviewCountText = ratingLabel.match(/from\s+([\d,]+)\s+(?:ratings|reviews)/i)?.[1]
        || [...card.querySelectorAll('a[href*="customerReviews" i],a[href*="#customerReviews" i],[aria-label*="ratings" i],[aria-label*="reviews" i]')]
          .map(el => el.getAttribute('aria-label') || el.textContent || '').map(value => value.match(/([\d,]+)/)?.[1]).find(Boolean)
        || text.match(/\b([\d,]+)\s+(?:ratings|reviews)\b/i)?.[1] || '';
      const ratingCount = reviewCountText ? Number(reviewCountText.replaceAll(',', '')) : null;
      const sponsored = /\bSponsored\b/i.test(text) || !!card.querySelector('[aria-label*="Sponsored" i],[data-component-type*="sp-sponsored" i],a[href*="adId=" i],a[href*="aax" i]');
      const availabilityResult = redact(card.querySelector('[class*="availability" i],.a-color-success')?.textContent || '');
      let ref = '';
      if (link) {
        ref = [...observedTargets].find(([, element]) => element === link)?.[0] || '';
        if (!ref) {
          ref = `c${elements.length + 1}`;
          observedTargets.set(ref, link); link.dataset.captainRef = ref;
          elements.push({ ref, tag: 'a', role: link.getAttribute('role') || '', type: '', name: title, value: '', placeholder: '', groupText: `${title}\n₹${price || ''}`, href: `https://www.amazon.in/dp/${asin}`, disabled: false, sensitive: false, sensitiveType: '', bbox: { x: box.x, y: box.y, width: box.width, height: box.height }, state: {}, confidence: 1, source: 'AMAZON_SEMANTIC_DOM' });
        }
      }
      position++;
      const evidence = [asin, link, title, price, card.matches('[data-component-type="s-search-result"]')].filter(Boolean).length;
      const candidate = { asin, title, price, currency: price ? 'INR' : '', rating: Number.isFinite(rating) ? rating : null, ratingCount: Number.isFinite(ratingCount) ? ratingCount : null, url: link ? `https://www.amazon.in/dp/${asin}` : '', availability: availabilityResult.found.length ? '' : availabilityResult.text.trim().slice(0, 100), sponsored, position, confidence: Math.min(1, evidence / 5), ref, bbox: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } };
      const previous = byAsin.get(asin);
      if (!previous || candidate.confidence > previous.confidence || (candidate.confidence === previous.confidence && candidate.title.length > previous.title.length)) byAsin.set(asin, candidate);
    }
    return [...byAsin.values()].slice(0, 80);
  }
  function amazonDetail() {
    if (!/(^|\.)amazon\.in$/i.test(location.hostname)) return null;
    const asin = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    if (!asin) return null;
    const titleResult = redact(document.querySelector('#productTitle,h1')?.textContent || '');
    const root = document.querySelector('#centerCol,#dp-container,main') || document;
    const price = amazonPrice(root);
    return { asin, title: titleResult.found.length ? '' : titleResult.text.replace(/\s+/g, ' ').trim().slice(0, 240), price, currency: price ? 'INR' : '', url: `https://www.amazon.in/dp/${asin}` };
  }

  function currentSearchQuery() {
    const params = new URL(location.href).searchParams;
    for (const key of ['search_query', 'q', 'query', 'field-keywords', 'keyword', 'keywords', 'k', 'search']) {
      const value = params.get(key);
      if (value) return redact(value).text;
    }
    return '';
  }

  // This signal never leaves the extension. It lets the service worker wait for
  // a usable page without running a second full extraction/privacy pass.
  function readiness() {
    const cards = [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')];
    const amazonResults = /(^|\.)amazon\.in$/i.test(location.hostname) && location.pathname === '/s';
    return {
      url: `${location.origin}${location.pathname}`,
      searchQuery: currentSearchQuery(),
      documentReadyState: document.readyState,
      meaningfulContent: (document.body?.innerText?.trim().length || 0) > 80,
      amazonResultCards: cards.filter(card => card.getAttribute('data-asin')).length,
      amazonResultSignature: cards.slice(0, 30).map(card => `${card.getAttribute('data-asin')}:${card.querySelector('.a-price .a-offscreen')?.textContent || ''}`).join('|'),
      ready: amazonResults ? cards.length >= 3 : document.readyState !== 'loading'
    };
  }

  async function observe() {
    const observationStarted = now();
    // Amazon paints the result shell before organic cards. Observe only after a
    // bounded local readiness check so the planner does not spend action steps
    // racing the page. A block/CAPTCHA page still returns after this deadline.
    if (/(^|\.)amazon\.in$/i.test(location.hostname) && location.pathname === '/s') {
      const deadline = now() + 3000;
      let previous = '', stableSamples = 0;
      while (now() < deadline) {
        const cards = [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')];
        const signature = cards.slice(0, 30).map(card => `${card.getAttribute('data-asin')}:${card.querySelector('.a-price .a-offscreen')?.textContent || ''}`).join('|');
        // Amazon retains hidden/below-fold spinner nodes after the organic grid
        // is usable. Stable product identities and prices are the stronger signal.
        stableSamples = signature && signature === previous && cards.length >= 3 ? stableSamples + 1 : 0;
        previous = signature;
        if (stableSamples >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const readinessMs = now() - observationStarted;
    const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
    // Large commerce pages put result-card links well after their global header.
    // Keep the normal observation budget small, but allow enough locally-read
    // controls on Amazon for grounded product comparison. Nothing here leaves
    // the device until the redaction pass below has completed.
    const observationLimit = /(^|\.)amazon\.in$/i.test(location.hostname) ? 360 : 180;
    const nodes = [...document.querySelectorAll(selector)].filter(visible).slice(0, observationLimit);
    const privacyStarted = now(), boxes = [];
    const counts = {};
    for (const box of [...sensitiveTextRegions(), ...uninspectableVisualRegions()]) {
      boxes.push(box); counts[box.kind] = (counts[box.kind] || 0) + 1;
    }
    const privacyRegionMs = now() - privacyStarted;
    observedTargets.clear();
    discoveredLinks.clear();
    const elementStarted = now();
    const elements = nodes.map((el, index) => {
      const ref = `c${index + 1}`;
      observedTargets.set(ref, el);
      el.dataset.captainRef = ref;
      const label = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.title || '';
      const raw = [label, el.placeholder, el.innerText, el.value && el.type !== 'password' ? el.value : ''].filter(Boolean).join(' ').trim().slice(0, 240);
      const sensitiveType = sensitiveInputType(el);
      const sensitive = !!sensitiveType || el.type === 'password' || SECRET_HINT.test(`${label} ${el.name} ${el.autocomplete}`);
      const result = sensitive ? { text: '[REDACTED_SECRET]', found: ['SECRET'] } : redact(raw);
      if (result.found.length) {
        const r = el.getBoundingClientRect();
        boxes.push({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, kind: result.found[0] });
        result.found.forEach((kind) => counts[kind] = (counts[kind] || 0) + 1);
      }
      let href = '';
      if (el.href) { try { const u = new URL(el.href); href = `${u.origin}${u.pathname}`; } catch {} }
      // A retained mini-player or recommendation can appear before actual results.
      if (location.hostname === 'www.youtube.com' && location.pathname === '/results' && /\/watch\b/.test(href) && !el.closest('ytd-search')) href = '';
      const rect = el.getBoundingClientRect();
      const group = el.closest('article,[role="listitem"],li,.product,.card,[data-product],[data-component-type="s-search-result"],[data-asin]');
      const groupText = group && group !== el ? redact(group.innerText || '').text.slice(0, 500) : '';
      const publicValue = sensitive ? '[REDACTED_SECRET]' : redact(el.value || '').text;
      const options = el.tagName === 'SELECT' ? [...el.options].slice(0, 60).map(option => ({ text: redact(option.textContent || '').text.trim().slice(0, 120), value: redact(option.value || '').text.slice(0, 180), selected: option.selected })) : undefined;
      return { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.type || '', name: result.text, value: publicValue, placeholder: redact(el.placeholder || '').text, groupText, href, disabled: !!el.disabled, sensitive, sensitiveType: sensitiveType || (sensitive ? 'secret' : ''), bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, state: { checked: !!el.checked, selected: el.selectedIndex ?? null, expanded: el.getAttribute('aria-expanded'), readonly: !!el.readOnly, options }, confidence: 1, source: 'dom' };
    });
    const domExtractionMs = now() - elementStarted;
    const amazonStarted = now(), extractedAmazonProducts = amazonProducts(elements);
    const amazonExtractionMs = now() - amazonStarted;
    const searchResults = [];
    // Discovery uses observed organic result headings, not arbitrary page links
    // or text claiming to be instructions. Keep original links local to refs.
    if (location.hostname === 'www.google.com' && location.pathname === '/search') {
      const seen = new Set();
      for (const [ref, el] of observedTargets) {
        if (el.tagName !== 'A' || !el.closest?.('#search, #rso')) continue;
        if (el.closest?.('#tads, #tadsb, #bottomads, [data-text-ad], [data-ad-client], [aria-label="Ads"], [aria-label="Sponsored"]')) continue;
        const heading = el.querySelector?.('h3');
        if (!heading || !visible(heading)) continue;
        try {
          const direct = new URL(el.href), displayed = displayedResultOrigin(el);
          const url = displayed || direct;
          if (url.protocol !== 'https:' || url.username || url.password || /(^|\.)(?:google\.com|googleadservices\.com|doubleclick\.net|googleusercontent\.com)$/.test(url.hostname)) continue;
          const safeHref = redact(`${url.origin}${url.pathname}`), title = redact(heading.innerText || heading.textContent || '');
          if (safeHref.found.length || redact(decodeURIComponent(url.pathname)).found.length || title.found.length || !title.text.trim() || seen.has(safeHref.text)) continue;
          seen.add(safeHref.text);
          if (displayed) {
            discoveredLinks.set(ref, { originalHref: el.href, origin: displayed.origin });
            elements.find(item => item.ref === ref).href = safeHref.text;
          }
          searchResults.push({ ref, title: title.text.trim().slice(0, 240), href: safeHref.text, ...(displayed ? { source: 'displayed-origin' } : {}) });
        } catch {}
      }
    }
    const textStarted = now(), pageText = redact(document.body?.innerText?.slice(0, 18000) || '');
    pageText.found.forEach((kind) => counts[kind] = (counts[kind] || 0) + 1);
    const media = primaryMedia();
    const textRegions = [...document.querySelectorAll('h1,h2,h3,p,th,td,label,[role="heading"]')].filter(visible).slice(0, 100).map((el, index) => {
      const rect = el.getBoundingClientRect(), result = redact(el.innerText || el.textContent || '');
      return { id: `t${index + 1}`, role: el.getAttribute('role') || (/^H[1-6]$/.test(el.tagName) ? 'heading' : el.tagName === 'LABEL' ? 'label' : 'text'), text: result.text.trim().slice(0, 300), bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, state: {}, confidence: 1, source: 'DOM' };
    }).filter(region => region.text);
    const visualRegions = [...document.querySelectorAll('img,canvas,video,[role="img"],article,[role="dialog"],[role="menu"]')].filter(visible).slice(0, 80).map((el, index) => {
      const rect = el.getBoundingClientRect(), label = redact(el.getAttribute('aria-label') || el.alt || el.getAttribute('role') || el.tagName.toLowerCase());
      const semanticContainer = el.tagName === 'ARTICLE' || ['dialog', 'menu'].includes(el.getAttribute('role'));
      return { id: `v${index + 1}`, role: el.getAttribute('role') || el.tagName.toLowerCase(), text: label.text.slice(0, 160), bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, state: {}, confidence: semanticContainer ? 0.9 : 0.8, source: 'VISION_GEOMETRY' };
    });
    const challenge = detectHumanChallenge();
    const textAndMetadataMs = now() - textStarted;
    const hash = value => { let result = 2166136261; for (const char of String(value)) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, '0'); };
    const pageMetadata = {
      domFingerprint: hash(elements.map(el => `${el.tag}:${el.role}:${el.name}:${Math.round(el.bbox.x)}:${Math.round(el.bbox.y)}`).join('|')),
      visibleTextHash: hash(pageText.text), elementCount: elements.length,
      meaningfulContent: elements.length > 0 || pageText.text.trim().length > 80,
      capturedAt: Date.now()
    };
    return {
      site: location.hostname === 'www.youtube.com' || location.hostname === 'youtube.com' ? 'youtube' : '',
      searchQuery: currentSearchQuery(),
      url: `${location.origin}${location.pathname}`,
      title: redact(document.title).text,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      pageText: pageText.text.slice(0, 9000),
      elements,
      amazonProducts: extractedAmazonProducts,
      amazonProductDetail: amazonDetail(),
      textRegions,
      visualRegions,
      interactiveRegions: elements,
      ocr: { status: 'not-configured', regions: [], cached: false, note: 'No packaged local OCR model is installed.' },
      sensitiveRegions: boxes.map((box, index) => ({ id: `s${index + 1}`, type: box.kind, bbox: { x: box.x, y: box.y, width: box.width, height: box.height }, confidence: 1, source: 'DOM_PRIVACY' })),
      confidence: { dom: 1, geometry: 0.8, ocr: 0 },
      localTiming: { readinessMs: Math.round(readinessMs), privacyRegionMs: Math.round(privacyRegionMs), domExtractionMs: Math.round(domExtractionMs), accessibilityExtractionMs: Math.round(domExtractionMs), amazonExtractionMs: Math.round(amazonExtractionMs), textAndMetadataMs: Math.round(textAndMetadataMs), totalDomObservationMs: Math.round(now() - observationStarted), ocrMs: 0 },
      pageMetadata,
      challenge,
      searchResults: searchResults.slice(0, 12),
      redactionBoxes: boxes,
      piiCounts: counts,
      media: media ? [{ paused: media.paused, ended: media.ended, readyState: media.readyState, networkState: media.networkState, currentTime: Math.round(media.currentTime * 1000) / 1000, visible: visible(media), pageVisible: document.visibilityState === 'visible', error: mediaError(media), primary: true }] : [],
      vision: { interactiveRegions: elements.length, imageCount: [...document.images].filter(visible).length, mediaCount: document.querySelectorAll('video,audio').length, mode: 'DOM+local-visual-geometry' }
    };
  }

  function target(spec = {}, allowObservedOffscreen = false) {
    if (spec.ref) {
      const el = observedTargets.get(spec.ref);
      return el && el.isConnected && (allowObservedOffscreen || visible(el)) ? el : null;
    }
    const needle = (spec.text || spec.name || '').toLowerCase();
    return [...document.querySelectorAll('a,button,input,textarea,select,[role]')].find((el) => `${el.innerText} ${el.value} ${el.placeholder} ${el.ariaLabel}`.toLowerCase().includes(needle));
  }

  function requestLocalInput(el, inputType) {
    return new Promise(resolve => {
      document.querySelector('#captain-secure-input-host')?.remove();
      const host = document.createElement('div'); host.id = 'captain-secure-input-host'; host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>:host{all:initial}.shade{position:fixed;inset:0;background:#050507dd;display:grid;place-items:center;font:15px system-ui;color:#fafafa}.box{width:min(420px,calc(100vw - 32px));background:#121216;border:1px solid #ff435d;border-radius:16px;padding:22px;box-shadow:0 20px 80px #000}.title{font-size:20px;font-weight:800}.note{color:#bbb;line-height:1.45;margin:9px 0 16px}input{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;border:1px solid #555;background:#070709;color:#fff;font:inherit}footer{display:flex;justify-content:flex-end;gap:9px;margin-top:14px}button{padding:10px 15px;border:0;border-radius:9px;font-weight:700}.cancel{background:#2d2d32;color:#fff}.confirm{background:#ff435d;color:#fff}</style><div class="shade"><form class="box"><div class="title">Local secure input</div><div class="note">Enter this ${inputType.replaceAll('-', ' ')} locally. CAPTAIN inserts it without sending it to the server, history, or telemetry.</div><input type="password" autocomplete="off" spellcheck="false" aria-label="Local secure value"><footer><button class="cancel" type="button">Cancel</button><button class="confirm" type="submit">Insert locally</button></footer></form></div>`;
      const input = root.querySelector('input');
      const finish = result => { input.value = ''; host.remove(); resolve(result); };
      root.querySelector('.cancel').onclick = () => finish({ ok: false, error: 'Local secure input was cancelled.' });
      root.querySelector('form').onsubmit = event => {
        event.preventDefault(); const value = input.value; if (!value) return input.focus();
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        setter ? setter.call(el, value) : el.value = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        finish({ ok: true, localOnly: true });
      };
      root.querySelector('.shade').onkeydown = event => { if (event.key === 'Escape') finish({ ok: false, error: 'Local secure input was cancelled.' }); };
      document.documentElement.append(host); input.focus();
    });
  }

  async function execute(action) {
    if (action.type === 'verifyPlayback') {
      const media = primaryMedia();
      const failure = mediaError(media);
      if (failure) return { ok: false, error: failure.message };
      if (!media) return { ok: false, retryable: true, error: 'Waiting for the requested player to appear.' };
      if (document.querySelector('.ad-showing')) return { ok: false, retryable: true, error: 'Waiting for the advertisement to finish before confirming the requested video.' };
      const words = ((action.query || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => !['a','the','by','song','songs','music','video','videos','please'].includes(word));
      const title = document.title.toLowerCase();
      const titleWords = new Set(title.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []);
      if (words.length && !words.every(word => titleWords.has(word))) return { ok: false, error: 'The selected video title does not match the requested song and artist. Playback is not confirmed.' };
      if (media.ended) return { ok: false, error: 'The video ended before playback could be verified.' };
      if (media.paused || media.readyState < 2) return { ok: false, retryable: true, needsResume: media.paused && !!mediaSource(media), error: media.paused ? 'The requested player is paused.' : 'Playback has not started or is buffering.' };
      const before = media.currentTime;
      const source = mediaSource(media);
      const pageUrl = location.href;
      await new Promise(resolve => setTimeout(resolve, 2200));
      return primaryMedia() === media && mediaSource(media) === source && location.href === pageUrl && document.title.toLowerCase() === title && !mediaError(media) && !media.paused && !media.ended && media.currentTime > before + 0.5 && !document.querySelector('.ad-showing') ? { ok: true, verified: true } : { ok: false, retryable: true, error: 'The playback clock is not advancing. The player may be buffering or have changed.' };
    }
    if (action.type === 'media') {
      const media = primaryMedia();
      if (!media) return { ok: false, error: 'No audio or video was found on this page.' };
      try {
        if (action.operation === 'pause') { playRequests.delete(media); media.pause(); }
        else {
          const failure = mediaError(media);
          if (failure) return { ok: false, error: failure.message };
          let request = playRequests.get(media);
          if (request && request.source !== mediaSource(media)) { playRequests.delete(media); request = null; }
          if (!request && !media.paused && !media.ended) return media.readyState >= 2 ? { ok: true } : { ok: true, pending: document.visibilityState === 'hidden' ? 'The player is waiting in a background tab.' : 'Player is buffering; waiting for media data.' };
          if (!request) {
            request = { source: mediaSource(media) };
            request.promise = Promise.resolve(media.play()).then(() => 'playing');
            playRequests.set(media, request);
            const release = () => { if (playRequests.get(media) === request) playRequests.delete(media); };
            request.promise.then(release, release);
          }
          let timer;
          try {
            const outcome = await Promise.race([request.promise, new Promise(resolve => { timer = setTimeout(() => resolve('loading'), 5000); })]);
            if (outcome === 'loading') return { ok: true, pending: 'Player is buffering; verifying on next observation' };
          } finally { clearTimeout(timer); }
        }
      }
      catch (error) {
        if (error.name === 'NotAllowedError') {
          return playbackClick(media);
        }
        if (error.name === 'AbortError') return { ok: true, pending: 'Player is still loading' };
        return { ok: false, error: `Player error: ${error.name}: ${error.message}` };
      }
      return { ok: !media.paused || action.operation === 'pause' };
    }
    if (action.type === 'finish') return { ok: true, done: true, message: action.message };
    if (action.type === 'wait') { await new Promise((r) => setTimeout(r, Math.min(action.ms || 800, 3000))); return { ok: true }; }
    if (action.type === 'navigate') { setTimeout(() => location.assign(action.url), 60); return { ok: true, navigated: true }; }
    if (action.type === 'back') { setTimeout(() => history.back(), 60); return { ok: true, navigated: true }; }
    if (action.type === 'scroll') { scrollBy({ top: action.direction === 'up' ? -(action.amount || 600) : (action.amount || 600), behavior: 'smooth' }); return { ok: true }; }
    const el = target(action.target, !!action.expectedAsin);
    if (!el) return { ok: false, error: 'Target not found' };
    const localSensitiveType = sensitiveInputType(el);
    if (action.type === 'request_local_input') {
      if (!localSensitiveType) return { ok: false, error: 'The selected target is not a sensitive field.' };
      return requestLocalInput(el, action.inputType || localSensitiveType);
    }
    if (localSensitiveType && ['type', 'select', 'press', 'submit'].includes(action.type)) return { ok: false, error: 'Remote control of a sensitive field was blocked. Use local secure input.' };
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (action.type === 'click') {
      const link = el.closest('a[href]');
      if (action.expectedAsin) {
        let destination;
        try { destination = new URL(link?.href); } catch {}
        const actualAsin = destination?.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
        const expectedAsin = String(action.expectedAsin).toUpperCase();
        if (!destination || destination.protocol !== 'https:' || destination.hostname.replace(/^www\./, '') !== 'amazon.in' || actualAsin !== expectedAsin || destination.username || destination.password) return { ok: false, error: 'The Amazon product identity or direct URL changed before selection. No navigation was sent.' };
        const canonical = `https://www.amazon.in/dp/${expectedAsin}`;
        if (action.expectedUrl && action.expectedUrl !== canonical) return { ok: false, error: 'The planned Amazon product URL was not canonical. No navigation was sent.' };
        return { ok: true, navigateUrl: canonical };
      }
      const discovered = discoveredLinks.get(action.target?.ref);
      if (action.expectedHost && discovered) {
        const displayed = displayedResultOrigin(el);
        if (!displayed || !link || link.href !== discovered.originalHref || displayed.origin !== discovered.origin || displayed.hostname !== action.expectedHost) return { ok: false, error: 'The displayed website address changed. No navigation was sent.' };
        return { ok: true, navigateUrl: displayed.href };
      }
      if (action.expectedHost) {
        let destination;
        try { destination = new URL(link?.href); } catch {}
        if (!destination || destination.protocol !== 'https:' || destination.username || destination.password || destination.port || destination.hostname !== action.expectedHost) return { ok: false, error: 'The discovered link changed before it could be opened. No navigation was sent.' };
      }
      if (link && /^https?:/.test(link.href)) {
        const destination = new URL(link.href);
        if (destination.hostname === 'www.youtube.com' && destination.pathname === '/watch') {
          for (const key of [...destination.searchParams.keys()]) if (key !== 'v') destination.searchParams.delete(key);
        }
        return { ok: true, navigateUrl: destination.href };
      }
      el.click(); return { ok: true };
    }
    if (action.type === 'submit') { el.form?.requestSubmit?.(); return { ok: true }; }
    if (action.type === 'press') {
      el.focus();
      if (action.key === 'Enter' && el.form) setTimeout(() => el.form.requestSubmit(), 50);
      else for (const kind of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(kind, { key: action.key, bubbles: true }));
      return { ok: true, navigated: action.key === 'Enter' };
    }
    if (action.type === 'select') { el.value = action.value; el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; }
    if (action.type === 'type') {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter ? setter.call(el, action.value || '') : el.value = action.value || '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: action.value || '' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (action.submit) {
        // A semantic GET search must not depend on fragile page JavaScript. Build
        // a same-origin URL from only the observed search field; hidden form
        // values (tokens, session IDs, account data) deliberately stay local.
        const form = el.form;
        if (form && (form.method || 'get').toLowerCase() === 'get' && el.name) {
          try {
            const destination = new URL(form.action || location.href, location.href);
            if (destination.origin === location.origin) {
              destination.search = '';
              destination.searchParams.set(el.name, action.value || '');
              return { ok: true, navigateUrl: destination.href, expectedSearchValue: action.value || '' };
            }
          } catch {}
        }
        setTimeout(() => form?.requestSubmit?.(), 80);
      }
      return { ok: true, navigated: !!action.submit };
    }
    return { ok: false, error: 'Unsupported action' };
  }

  async function sanitizeScreenshot(dataUrl, boxes, viewport) {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const sx = canvas.width / viewport.width, sy = canvas.height / viewport.height;
    for (const box of boxes || []) {
      const x = box.x * sx, y = box.y * sy, w = box.width * sx, h = box.height * sy;
      ctx.fillStyle = '#09090b'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ef4444'; ctx.font = `${Math.max(10, Math.min(18, h * .3))}px sans-serif`;
      ctx.fillText(`REDACTED ${box.kind}`, x + 4, y + Math.min(h - 3, 18));
    }
    if ('FaceDetector' in window) {
      try {
        const faces = await new FaceDetector({ fastMode: true }).detect(canvas);
        for (const face of faces) {
          const b = face.boundingBox, tiny = document.createElement('canvas');
          tiny.width = Math.max(1, Math.round(b.width / 14)); tiny.height = Math.max(1, Math.round(b.height / 14));
          tiny.getContext('2d').drawImage(canvas, b.x, b.y, b.width, b.height, 0, 0, tiny.width, tiny.height);
          ctx.imageSmoothingEnabled = false; ctx.drawImage(tiny, b.x, b.y, b.width, b.height); ctx.imageSmoothingEnabled = true;
        }
      } catch {}
    }
    return canvas.toDataURL('image/jpeg', .62);
  }

  function onMessage(message, _sender, respond) {
    if (message.type === 'OBSERVE') { observe().then(respond, error => respond({ error: error.message || String(error) })); return true; }
    if (message.type === 'READINESS') { respond(readiness()); return false; }
    if (message.type === 'EXECUTE') { execute(message.action).then(respond).catch(error => respond({ ok: false, error: error.message })); return true; }
    if (message.type === 'SANITIZE_SCREENSHOT') { sanitizeScreenshot(message.dataUrl, message.boxes, message.viewport).then((screenshot) => respond({ screenshot })); return true; }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function mountCaptain() {
    if (document.querySelector('#captain-agent-host') || !document.documentElement) return;
    const host = document.createElement('div'); host.id = 'captain-agent-host';
    host.dataset.captainBuild = '0.5.0';
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;display:block;color-scheme:dark';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{font:13px system-ui,sans-serif}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}[hidden]{display:none!important}
      .card{width:min(366px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;color:#f4f4f5;background:#0c0b0e;border:1px solid #543137;border-radius:18px;box-shadow:0 20px 70px #0009;font:13px system-ui,sans-serif}
      .head{display:flex;align-items:center;gap:10px;padding:11px 13px;border-bottom:1px solid #302329;cursor:grab;touch-action:none;user-select:none}.head.dragging{cursor:grabbing}
      .logo{display:grid;place-items:center;flex-shrink:0;width:30px;height:30px;border:1px solid #ff4c61;border-radius:50%;color:#ff6779;font-weight:900;box-shadow:0 0 15px #f4354930}.head b{letter-spacing:.12em;font-size:13px}.drag-hint{font-size:10px;color:#a19097;line-height:1.5}.tools{margin-left:auto;display:flex;gap:3px}
      .tools button{background:transparent;color:#bdaab1;border:0;border-radius:6px;width:28px;height:30px;font-size:18px}.tools button:hover{background:#38242b}button:focus-visible,input:focus-visible,.head:focus-visible{outline:2px solid #ff6477;outline-offset:2px}
      .body{padding:12px}.row{display:flex;gap:6px}.task{min-width:0;flex:1;padding:10px;border:1px solid #494044;border-radius:9px;background:#1b181b;color:#fff}.go,.mic{border:0;border-radius:9px;padding:0 11px;font-weight:700}.go{background:#ff4c61;color:#fff}.mic{background:#30242a;color:#ffb6c0;font-size:17px}
      .status{display:flex;gap:8px;align-items:flex-start;margin-top:10px;padding:9px 10px;border-radius:8px;background:#1b161a;color:#c4bac0;line-height:1.4;max-height:90px;overflow:auto}.dot{flex-shrink:0;width:7px;height:7px;margin-top:5px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399}.card.stale .dot{background:#fbbf24;box-shadow:none}
      .voice-help{font-size:11px;color:#ad9da5;margin:9px 0 0;line-height:1.45}.meta{display:flex;justify-content:space-between;margin-top:9px;color:#9e8e96;font-size:10px}.recovery{font-size:11px;color:#ffd4a4;line-height:1.5;margin-top:9px}.reload{background:#392821;color:#ffdda9;border:1px solid #715039;border-radius:6px;padding:5px 9px;margin-top:5px}.handoff{width:100%;margin-top:8px;padding:9px;border:1px solid #ff5368;border-radius:8px;background:#a81429;color:#fff;font-weight:800}
      .card.collapsed{width:228px}.card.collapsed .body{display:none}.card.collapsed .head{border-bottom:0}
    </style><section class="card" aria-label="CAPTAIN browser controls">
      <header class="head" tabindex="0" title="Drag to move. Arrow keys move; Home resets position." aria-label="Move CAPTAIN panel. Use arrow keys or drag."><span class="logo">C</span><div><b>CAPTAIN</b><div class="drag-hint">Drag to move · 0.5.0</div></div><div class="tools"><button class="reset" title="Reset position" aria-label="Reset panel position">⌖</button><button class="collapse" title="Minimize panel" aria-label="Minimize panel" aria-expanded="true">−</button></div></header>
      <div class="body"><div class="row"><input class="task" aria-label="Browser command" placeholder="Open YouTube, search, play…"><button class="mic" title="Open voice controller — enable Speak once" aria-label="Open voice controller">🎙</button><button class="go">RUN</button></div>
      <div class="status" role="status" aria-live="polite"><i class="dot"></i><span class="phase">Connecting to CAPTAIN…</span></div>
      <button class="handoff" hidden>Resume CAPTAIN</button>
      <p class="voice-help">Voice: open 🎙, enable Speak once, then say “Hey Captain”. Keep the voice tab open.</p>
      <div class="recovery" hidden>Save any unfinished form first. Reload this page if the launcher has not reconnected the panel.<br><button class="reload">Reload page</button></div>
      <div class="meta"><span class="pii">0 PII matches</span><span class="steps">0 steps</span><span>Images withheld</span></div></div>
    </section>`;
    document.documentElement.appendChild(host);
    const input = root.querySelector('.task'), phase = root.querySelector('.phase'), card = root.querySelector('.card'), head = root.querySelector('.head');
    const go = root.querySelector('.go'), mic = root.querySelector('.mic'), collapse = root.querySelector('.collapse'), handoff = root.querySelector('.handoff');
    let pollTimer, pending = false, stale = false, userMoved = false, drag;
    const layoutKey = 'captainPanelLayout';
    let layout = { x: 1, y: 1, collapsed: false };
    function bounds() {
      const box = host.getBoundingClientRect();
      return { maxX: Math.max(8, innerWidth - box.width - 8), maxY: Math.max(8, innerHeight - box.height - 8) };
    }
    function move(x, y) {
      const { maxX, maxY } = bounds();
      const left = Math.max(8, Math.min(maxX, x)), top = Math.max(8, Math.min(maxY, y));
      host.style.left = `${left}px`; host.style.top = `${top}px`; host.style.right = 'auto'; host.style.bottom = 'auto';
      layout.x = maxX > 8 ? (left - 8) / (maxX - 8) : 0;
      layout.y = maxY > 8 ? (top - 8) / (maxY - 8) : 0;
    }
    function place() {
      card.classList.toggle('collapsed', layout.collapsed);
      collapse.textContent = layout.collapsed ? '+' : '−';
      collapse.title = layout.collapsed ? 'Expand panel' : 'Minimize panel';
      collapse.setAttribute('aria-label', collapse.title);
      collapse.setAttribute('aria-expanded', String(!layout.collapsed));
      const { maxX, maxY } = bounds();
      move(8 + layout.x * (maxX - 8), 8 + layout.y * (maxY - 8));
    }
    async function persist() {
      userMoved = true;
      // Only geometry is saved: never commands, page contents or transcripts.
      try { if (runtimeAlive()) await chrome.storage.local.set({ [layoutKey]: { ...layout } }); } catch {}
    }
    head.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const box = host.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
      userMoved = true; head.setPointerCapture(event.pointerId); head.classList.add('dragging'); event.preventDefault();
    });
    head.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      move(event.clientX - drag.dx, event.clientY - drag.dy);
    });
    function endDrag(event) {
      if (drag?.id !== event.pointerId) return;
      drag = null; head.classList.remove('dragging');
      if (head.hasPointerCapture(event.pointerId)) head.releasePointerCapture(event.pointerId);
      persist();
    }
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) head.addEventListener(name, endDrag);
    function reset() { layout = { x: 1, y: 1, collapsed: layout.collapsed }; place(); persist(); }
    head.addEventListener('keydown', event => {
      if (event.target !== head) return;
      if (event.key === 'Home') { event.preventDefault(); reset(); return; }
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault(); const box = host.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
      move(box.left + delta[0] * step, box.top + delta[1] * step); persist();
    });
    root.querySelector('.reset').onclick = reset;
    collapse.onclick = () => { layout.collapsed = !layout.collapsed; place(); persist(); };
    addEventListener('resize', place);
    place();
    chrome.storage.local.get(layoutKey).then(saved => {
      const value = saved[layoutKey];
      if (!userMoved && connected && value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
        layout = { x: Math.min(1, Math.max(0, value.x)), y: Math.min(1, Math.max(0, value.y)), collapsed: value.collapsed === true }; place();
      }
    }).catch(() => {});
    function disconnected() {
      stale = true; clearInterval(pollTimer); go.disabled = mic.disabled = true; card.classList.add('stale');
      phase.textContent = 'CAPTAIN was updated or disconnected. Reopen it from the launcher to reconnect.';
      root.querySelector('.recovery').hidden = false;
    }
    async function message(payload) {
      if (!runtimeAlive()) { disconnected(); throw new Error('CAPTAIN is disconnected.'); }
      try { return await chrome.runtime.sendMessage(payload); }
      catch (error) {
        if (!runtimeAlive() || /extension context invalidated|receiving end does not exist|could not establish connection/i.test(error.message)) disconnected();
        throw error;
      }
    }
    root.querySelector('.reload').onclick = () => location.reload();
    go.onclick = async () => {
      const task = input.value.trim(); if (!task) return input.focus();
      if (pending || stale) return;
      pending = true; go.disabled = true;
      phase.textContent = 'Starting private perception…';
      try {
        const result = await message({ type: 'START_TASK', task });
        if (!result.ok) phase.textContent = result.error;
        else speechSynthesis.speak(new SpeechSynthesisUtterance('Okay, sir.'));
      } catch (error) { if (!stale) phase.textContent = error.message; }
      finally { pending = false; if (!stale) go.disabled = false; }
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && !go.disabled) { event.preventDefault(); go.onclick(); } });
    mic.onclick = async () => {
      try {
        const result = await message({ type: 'OPEN_VOICE' });
        if (!result.ok) phase.textContent = result.error;
      } catch (error) { if (!stale) phase.textContent = error.message; }
    };
    handoff.onclick = async () => {
      handoff.disabled = true; phase.textContent = 'Checking locally that verification is cleared…';
      try { const result = await message({ type: 'RESUME_TASK' }); phase.textContent = result.ok ? 'Verification cleared. Resuming…' : result.error; }
      catch (error) { if (!stale) phase.textContent = error.message; }
      finally { handoff.disabled = false; }
    };
    let polling = false;
    async function refreshPanel() {
      if (polling || stale || !connected) return;
      polling = true;
      try {
        const s = await message({ type: 'GET_STATE' });
        if (!connected || stale) return;
        if (!pending) phase.textContent = s.message || s.phase || 'Ready — type a command or open voice';
        go.disabled = pending || s.status === 'running';
        handoff.hidden = s.status !== 'waiting_human';
        go.disabled = pending || ['running', 'waiting_human'].includes(s.status);
        root.querySelector('.pii').textContent = `${s.piiDetected || 0} PII matches`;
        root.querySelector('.steps').textContent = `${s.step || 0} steps`;
      } catch (error) { if (!stale) phase.textContent = `Connection error: ${error.message}`; }
      finally { polling = false; }
    }
    pollTimer = setInterval(refreshPanel, 1000);
    refreshPanel();
    disposePanel = () => { clearInterval(pollTimer); removeEventListener('resize', place); host.remove(); };
  }
  mountCaptain();
  if (location.origin === 'http://127.0.0.1:4317' && new URL(location.href).searchParams.get('voice') === '1') {
    chrome.runtime.sendMessage({ type: 'OPEN_VOICE' }).catch(() => {});
  }
})();
