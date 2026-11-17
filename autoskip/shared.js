/* Shared config for the content script, popup and background worker. */
(function (root) {
  'use strict';

  const SITES = [
    { id: 'netflix', name: 'Netflix', hosts: ['netflix.com'] },
    {
      id: 'prime',
      name: 'Prime Video',
      hosts: [
        'primevideo.com',
        'amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de',
        'amazon.ca', 'amazon.com.au', 'amazon.co.jp'
      ]
    },
    { id: 'hotstar', name: 'JioHotstar', hosts: ['hotstar.com', 'jiohotstar.com'] },
    { id: 'zee5', name: 'ZEE5', hosts: ['zee5.com'] },
    { id: 'sonyliv', name: 'SonyLIV', hosts: ['sonyliv.com'] }
  ];

  const FEATURES = [
    { id: 'intro', label: 'Skip intro & recap', hint: 'Intros, recaps & openings', toast: 'Skipped intro' },
    { id: 'next', label: 'Next episode', hint: 'Jumps past the end credits', toast: 'Playing next episode' },
    { id: 'ads', label: 'Skip ads', hint: 'As soon as “Skip Ad” is clickable', toast: 'Skipped ad' },
    { id: 'stillWatching', label: '“Still watching?”', hint: 'Keeps playing without asking', toast: 'Kept playing' }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: true,
    features: { intro: true, next: true, ads: true, stillWatching: true },
    sites: { netflix: true, prime: true, hotstar: true, zee5: true, sonyliv: true }
  };

  function siteForHost(host) {
    if (!host) return null;
    host = String(host).toLowerCase();
    return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith('.' + h))) || null;
  }

  // Fill in anything missing from saved settings with defaults, so new
  // features/sites added in later versions start out enabled.
  function mergeSettings(saved) {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!saved || typeof saved !== 'object') return out;
    if (typeof saved.enabled === 'boolean') out.enabled = saved.enabled;
    if (typeof saved.showToast === 'boolean') out.showToast = saved.showToast;
    for (const group of ['features', 'sites']) {
      const src = saved[group] || {};
      for (const key of Object.keys(out[group])) {
        if (typeof src[key] === 'boolean') out[group][key] = src[key];
      }
    }
    return out;
  }

  async function loadSettings() {
    const res = await chrome.storage.sync.get('settings');
    return mergeSettings(res && res.settings);
  }

  function saveSettings(settings) {
    return chrome.storage.sync.set({ settings: mergeSettings(settings) });
  }

  async function loadStats() {
    const res = await chrome.storage.local.get('stats');
    return Object.assign({ intro: 0, next: 0, ads: 0, stillWatching: 0 }, (res && res.stats) || {});
  }

  root.AutoSkip = { SITES, FEATURES, DEFAULT_SETTINGS, siteForHost, mergeSettings, loadSettings, saveSettings, loadStats };
})(typeof self !== 'undefined' ? self : globalThis);
