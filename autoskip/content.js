/*
 * AutoSkip content script.
 *
 * Finds "Skip Intro / Skip Recap", "Next Episode", "Skip Ad" and
 * "Are you still watching?" buttons and clicks them.
 *
 * Detection runs in three layers, most trusted first:
 *   1. Known selectors per site (Netflix data-uia, Prime Video SDK classes).
 *   2. Class-name heuristics (e.g. class="skip-intro-btn").
 *   3. Visible button text ("Skip Intro", "Skip Ad", "Next Episode", ...).
 * Layer 3 is what keeps working on JioHotstar / ZEE5 / SonyLIV and when a
 * site renames its classes. Text-matched "Next Episode" buttons are only
 * clicked near the end of the video, so a control-bar "next" button can't
 * skip an episode you're in the middle of.
 */
(() => {
  'use strict';

  if (window.__autoskipActive) return;
  window.__autoskipActive = true;

  const AS = self.AutoSkip;
  if (!AS) return;

  const IS_TOP = window === window.top;
  const FRAME_HOST = location.hostname;
  const IS_IMA_FRAME = /(^|\.)imasdk\.googleapis\.com$/i.test(FRAME_HOST);

  function topHostname() {
    if (IS_TOP) return FRAME_HOST;
    try { return window.top.location.hostname; } catch (_) { /* cross-origin */ }
    const ao = location.ancestorOrigins;
    if (ao && ao.length) {
      try { return new URL(ao[ao.length - 1]).hostname; } catch (_) { /* ignore */ }
    }
    try { if (document.referrer) return new URL(document.referrer).hostname; } catch (_) { /* ignore */ }
    return '';
  }

  // AUTOSKIP_TEST_HOST only exists in the local test harness; a real page
  // can't set globals inside the extension's isolated world.
  let TOP_HOST = globalThis.AUTOSKIP_TEST_HOST || topHostname();
  let SITE = AS.siteForHost(TOP_HOST);
  if (!SITE) return;

  // ---------------------------------------------------------------------
  // Detection rules
  // ---------------------------------------------------------------------

  const PRIORITY = ['stillWatching', 'ads', 'intro', 'next'];

  const SITE_SELECTORS = {
    netflix: {
      intro: [
        'button[data-uia^="player-skip"]', // skip-intro, skip-recap, skip-preplay
        '.watch-video--skip-content-button',
        '.skip-credits > a'
      ],
      next: [
        'button[data-uia="next-episode-seamless-button"]',
        'button[data-uia="next-episode-seamless-button-draining"]'
      ],
      stillWatching: ['button[data-uia="interrupt-autoplay-continue"]']
    },
    prime: {
      intro: ['.atvwebplayersdk-skipelement-button'],
      next: ['.atvwebplayersdk-nextupcard-button']
    }
  };

  // If one of these is on screen, the whole player is showing an ad, so a
  // bare "Skip" button counts as "Skip Ad".
  const AD_INDICATORS = {
    prime: ['[class*="atvwebplayersdk-ad-timer"]', '[class*="atvwebplayersdk-adtimeindicator"]']
  };

  const CLASS_SELECTORS = {
    intro: [
      '[class*="skip-intro" i]', '[class*="skipintro" i]', '[class*="skip_intro" i]',
      '[class*="skip-recap" i]', '[class*="skiprecap" i]',
      '[id*="skip-intro" i]', '[id*="skipintro" i]',
      '[data-testid*="skip-intro" i]', '[data-testid*="skipintro" i]'
    ],
    ads: [
      '.videoAdUiSkipButton', // Google IMA (used by many Indian OTT apps)
      '[class*="skip-ad-button" i]', '[class*="skipadbutton" i]',
      '[class*="skip-ad-btn" i]', '[class*="skipadbtn" i]',
      '[data-testid*="skip-ad" i]'
    ]
  };

  const NUKTA_DA = 'ड़'; // ड़ (decomposed — text is NFD-normalised)
  const TEXT_RULES = [
    { feature: 'ads', re: /^skip (this |the )?(ad|ads|advert|adverts|advertisement|advertisements)\b/, noCountdown: true },
    { feature: 'ads', re: /^(skip|skip now)$/, adContextOnly: true },
    { feature: 'ads', re: new RegExp('^विज्ञापन (को )?(छो' + NUKTA_DA + '|स्किप)'), noCountdown: true },
    {
      feature: 'intro',
      re: /^skip (the )?(intro|intros|recap|recaps|opening|opening credits|summary|title sequence|titles|theme song|song|previously on|prologue|preview|intro and recap|intro & recap|recap and intro|recap & intro)\b/
    },
    { feature: 'intro', re: new RegExp('^(इंट्रो|रीकैप|परिचय|सारांश) (को )?(छो' + NUKTA_DA + '|स्किप)') },
    { feature: 'next', re: /^skip (the )?(end |closing )?credits\b/ },
    { feature: 'next', re: /^(play |watch |start )?next (episode|ep)\b/, nearEnd: true, textOnly: true },
    { feature: 'next', re: /^(अगला|अगले) (एपिसोड|भाग)/, nearEnd: true, textOnly: true }
  ];

  const COUNTDOWN = /\b(in|after)\s*\d|\d\s*(s|sec|secs|seconds)\b|^\d+$/;
  const STILL_PROMPT = /\b(are you still (watching|there)|still watching|still there)\b/;
  const CONTINUE_BTN = /^(yes|yes i'?m (still )?(here|watching)|i'?m (still )?(here|watching)|continue|continue watching|continue playing|keep watching|keep playing|resume|resume watching|still watching)\b/;
  const TEXT_PREFILTER = /skip|next|still|छो|अगल|विज्ञापन|इंट्रो|रीकैप/i;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION', 'TITLE']);
  const CLICKABLE = 'button, [role="button"], a[href], input[type="button"], input[type="submit"], [tabindex]:not([tabindex="-1"]), [onclick]';
  const AD_CLASS = /(?:^|[\s_-])(?:ads?|advert\w*|preroll|midroll|postroll|commercial)(?:[\s_-]|$)|(?:^|[\s_-])[aA]ds?(?=[A-Z])|[a-z]Ad(?:s|Ui|Container|Overlay|Player|Skip|Break)/;
  const PRIME_PLAYER = '.webPlayerSDKContainer, #dv-web-player, [class*="atvwebplayersdk"]';

  const COOLDOWN_MS = { intro: 2000, ads: 1200, next: 12000, stillWatching: 5000 };
  const SAME_ELEMENT_MS = 5000;
  const SCAN_GAP_MS = 250;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  const qsa = (sel, root = document) => {
    try { return root.querySelectorAll(sel); } catch (_) { return []; }
  };

  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^\p{L}\p{M}\p{N}\s'&]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelOf(el) {
    return norm(el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title'));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ visibilityProperty: true });
    }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function resolveClickable(el) {
    if (el.matches(CLICKABLE)) return el;
    return el.querySelector('button, [role="button"], a[href]') || el;
  }

  function resolveTextTarget(el) {
    if (el.matches(CLICKABLE)) return el;
    const up = el.closest(CLICKABLE);
    if (up && norm(up.textContent).length <= 120) return up;
    return el.querySelector('button, [role="button"], a[href]') || el;
  }

  function classString(n) {
    const c = typeof n.className === 'string' ? n.className : (n.getAttribute && n.getAttribute('class')) || '';
    return c + ' ' + (n.id || '') + ' ' + ((n.getAttribute && n.getAttribute('data-testid')) || '');
  }

  function adIndicatorShowing() {
    for (const sel of AD_INDICATORS[SITE.id] || []) {
      for (const el of qsa(sel)) if (isVisible(el)) return true;
    }
    return false;
  }

  function inAdContext(el) {
    if (IS_IMA_FRAME) return true;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 12; n = n.parentElement, i++) {
      if (AD_CLASS.test(classString(n))) return true;
    }
    return adIndicatorShowing();
  }

  function mainVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of qsa('video')) {
      if (!Number.isFinite(v.duration) || v.duration <= 0) continue;
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area >= bestArea) { best = v; bestArea = area; }
    }
    return best;
  }

  // "Next episode" matched by text alone is only trusted in the last
  // 5 minutes AND last 20% of the video.
  function nearEnd() {
    const v = mainVideo();
    if (!v) return false;
    const d = v.duration;
    const t = v.currentTime;
    return d > 60 && d - t <= 300 && t / d >= 0.8;
  }

  // Which features may be found by heuristics in this frame:
  // 'all', 'ads' (ad-only iframes) or null (only exact site selectors).
  function genericScope() {
    if (IS_IMA_FRAME) return 'ads';
    if (/(^|\.)amazon\./.test(TOP_HOST) && IS_TOP && !document.querySelector(PRIME_PLAYER)) return null;
    if (document.querySelector('video')) return 'all';
    return IS_TOP ? null : 'ads';
  }

  // ---------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------

  let settings = AS.mergeSettings(null);

  function featureOn(f) {
    return settings.enabled && settings.sites[SITE.id] && settings.features[f];
  }

  function ruleAllows(rule, el, scope, fromAria) {
    if (!featureOn(rule.feature)) return false;
    if (scope === 'ads' && rule.feature !== 'ads') return false;
    if (fromAria && rule.textOnly) return false;
    if (rule.adContextOnly && !inAdContext(el)) return false;
    if (rule.nearEnd && !nearEnd()) return false;
    return true;
  }

  function matchText(text, el, scope, fromAria) {
    for (const rule of TEXT_RULES) {
      if (!rule.re.test(text)) continue;
      if (rule.noCountdown && COUNTDOWN.test(text)) continue;
      if (ruleAllows(rule, el, scope, fromAria)) return rule;
    }
    return null;
  }

  function collect() {
    const found = new Map(); // element -> feature
    const add = (el, f) => { if (el && !found.has(el)) found.set(el, f); };

    // 1. Exact selectors for this site.
    const siteSel = SITE_SELECTORS[SITE.id] || {};
    for (const f of PRIORITY) {
      if (!featureOn(f)) continue;
      for (const sel of siteSel[f] || []) for (const el of qsa(sel)) add(resolveClickable(el), f);
    }

    const scope = genericScope();
    if (!scope) return found;

    // 2. Class-name heuristics.
    for (const f of ['ads', 'intro']) {
      if (!featureOn(f) || (scope === 'ads' && f !== 'ads')) continue;
      for (const sel of CLASS_SELECTORS[f]) {
        for (const el of qsa(sel)) {
          const t = labelOf(el);
          if (t.length > 60) continue;
          if (t && !/skip|छो|स्किप/.test(t)) continue;
          if (f === 'ads' && COUNTDOWN.test(t)) continue;
          add(resolveClickable(el), f);
        }
      }
    }

    // 3a. aria-label / title ("Skip Intro" icon buttons). Never used for
    //     "next episode" — control bars label their next button that way.
    for (const el of qsa('[aria-label*="skip" i], [title*="skip" i]')) {
      const t = norm(el.getAttribute('aria-label') || el.getAttribute('title'));
      const rule = matchText(t, el, scope, true);
      if (rule) add(resolveClickable(el), rule.feature);
    }

    // 3b. Visible text.
    const prompts = [];
    const root = document.body || document.documentElement;
    if (!root) return found;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let budget = 15000;
    let node;
    while ((node = walker.nextNode()) && budget-- > 0) {
      const data = node.data;
      if (data.length > 80 || !TEXT_PREFILTER.test(data)) continue;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) continue;

      // Climb a few levels so text split across spans ("Skip" + "Intro")
      // is still read as one label.
      let el = parent;
      for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
        const t = norm(el.textContent);
        if (t.length > 80) break;
        if (STILL_PROMPT.test(t)) {
          if (scope === 'all' && featureOn('stillWatching')) prompts.push(el);
          break;
        }
        const rule = matchText(t, el, scope, false);
        if (rule) { add(resolveTextTarget(el), rule.feature); break; }
      }
    }

    // "Are you still watching?" → find the continue button next to it.
    for (const prompt of prompts) {
      let box = prompt;
      for (let i = 0; box && i < 8; i++, box = box.parentElement) {
        if (norm(box.textContent).length > 400) break;
        let hit = null;
        for (const b of qsa(CLICKABLE, box)) {
          if (CONTINUE_BTN.test(labelOf(b)) && isVisible(b)) { hit = b; break; }
        }
        if (hit) { add(hit, 'stillWatching'); break; }
      }
    }

    return found;
  }

  // ---------------------------------------------------------------------
  // Clicking
  // ---------------------------------------------------------------------

  const lastFeatureClick = {};
  let clickedAt = new WeakMap();

  function fireClick(el) {
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0
    };
    const ptr = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, base);
    try { el.dispatchEvent(new PointerEvent('pointerdown', ptr)); } catch (_) { /* ignore */ }
    el.dispatchEvent(new MouseEvent('mousedown', base));
    try { el.dispatchEvent(new PointerEvent('pointerup', ptr)); } catch (_) { /* ignore */ }
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  function tryClick(el, feature) {
    const now = Date.now();
    if (now - (lastFeatureClick[feature] || 0) < COOLDOWN_MS[feature]) return false;
    if (now - (clickedAt.get(el) || 0) < SAME_ELEMENT_MS) return false;
    if (!isVisible(el)) return false;

    lastFeatureClick[feature] = now;
    clickedAt.set(el, now);
    fireClick(el);
    console.debug('[AutoSkip] clicked', feature, el);
    notify(feature);
    return true;
  }

  function scan() {
    if (!alive()) return teardown();
    if (!settings.enabled || !settings.sites[SITE.id]) return;

    const found = collect();
    if (!found.size) return;

    const byFeature = {};
    for (const [el, f] of found) (byFeature[f] = byFeature[f] || []).push(el);
    for (const f of PRIORITY) {
      for (const el of byFeature[f] || []) {
        if (tryClick(el, f)) break; // at most one click per feature per scan
      }
    }
  }

  // ---------------------------------------------------------------------
  // Feedback: stats + on-screen notice (shown in the top frame only)
  // ---------------------------------------------------------------------

  function notify(feature) {
    try {
      const p = chrome.runtime.sendMessage({ type: 'autoskip:clicked', feature });
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* extension reloaded */ }
  }

  let toastHost = null;
  let toastTimer = 0;

  function showToast(feature) {
    if (!IS_TOP || !settings.showToast) return;
    const meta = AS.FEATURES.find((f) => f.id === feature);
    if (!meta) return;

    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.setAttribute('data-autoskip-toast', '');
      const shadow = toastHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .t {
            position: fixed; top: 24px; right: 24px; z-index: 2147483647;
            display: flex; align-items: center; gap: 8px;
            padding: 9px 14px 9px 10px; border-radius: 999px;
            background: rgba(17, 17, 27, .82); color: #fff;
            font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 6px 24px rgba(0,0,0,.35);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            pointer-events: none; opacity: 0; transform: translateY(-6px);
            transition: opacity .18s ease, transform .18s ease;
          }
          .t.show { opacity: 1; transform: none; }
          .i {
            width: 20px; height: 20px; border-radius: 50%;
            display: grid; place-items: center;
            background: linear-gradient(135deg, #6366f1, #a855f7);
          }
          svg { width: 11px; height: 11px; fill: #fff; }
        </style>
        <div class="t"><span class="i"><svg viewBox="0 0 24 24"><path d="M3 5l9 7-9 7zM12 5l9 7-9 7z"/></svg></span><span class="m"></span></div>`;
    }

    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (toastHost.parentNode !== parent) parent.appendChild(toastHost);

    const box = toastHost.shadowRoot.querySelector('.t');
    toastHost.shadowRoot.querySelector('.m').textContent = meta.toast;
    requestAnimationFrame(() => box.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 1800);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  let observer = null;
  let interval = 0;
  let timer = 0;
  let lastScan = 0;

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }

  function schedule() {
    if (timer) return;
    const wait = Math.max(0, SCAN_GAP_MS - (Date.now() - lastScan));
    timer = setTimeout(() => {
      timer = 0;
      lastScan = Date.now();
      try { scan(); } catch (e) { console.debug('[AutoSkip] scan error', e); }
    }, wait);
  }

  function teardown() {
    if (observer) observer.disconnect();
    clearInterval(interval);
    clearTimeout(timer);
    observer = null;
  }

  function boot() {
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled']
    });
    interval = setInterval(schedule, 1000);
    schedule();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      settings = AS.mergeSettings(changes.settings.newValue);
      schedule();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'autoskip:toast') showToast(msg.feature);
  });

  AS.loadSettings()
    .then((s) => { settings = s; })
    .catch(() => {})
    .finally(boot);

  // Hooks for test/harness.html only (see AUTOSKIP_TEST_HOST above).
  if (globalThis.AUTOSKIP_TEST_HOST) {
    globalThis.__autoskipTest = {
      setHost(h) { TOP_HOST = h; SITE = AS.siteForHost(h); },
      reset() { for (const k of Object.keys(lastFeatureClick)) delete lastFeatureClick[k]; clickedAt = new WeakMap(); },
      scanNow: scan
    };
  }
})();
