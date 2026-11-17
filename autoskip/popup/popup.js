/* AutoSkip popup */
(async () => {
  'use strict';
  const AS = window.AutoSkip;
  const $ = (id) => document.getElementById(id);

  const GLYPHS = {
    intro: '<svg viewBox="0 0 24 24"><path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7zM16 5h3v14h-3z"/></svg>',
    ads: '<svg viewBox="0 0 24 24"><path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    stillWatching: '<svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>'
  };

  let settings = await AS.loadSettings();
  let stats = await AS.loadStats();

  let currentSite = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) currentSite = AS.siteForHost(new URL(tab.url).hostname);
  } catch (_) { /* no access to the tab URL */ }

  const save = () => AS.saveSettings(settings);

  // Feature rows
  const tpl = $('featureRow');
  const counts = {};
  for (const f of AS.FEATURES) {
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.querySelector('.glyph').innerHTML = GLYPHS[f.id] || '';
    row.querySelector('.label').textContent = f.label;
    row.querySelector('.hint').textContent = f.hint;
    const input = row.querySelector('input');
    input.setAttribute('aria-label', f.label);
    input.checked = settings.features[f.id];
    input.addEventListener('change', () => { settings.features[f.id] = input.checked; save(); });
    counts[f.id] = row.querySelector('.count');
    $('features').appendChild(row);
  }

  // Site chips
  for (const s of AS.SITES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (currentSite && currentSite.id === s.id ? ' current' : '');
    chip.textContent = s.name;
    chip.setAttribute('aria-pressed', String(settings.sites[s.id]));
    chip.title = `Auto-click on ${s.name}`;
    chip.addEventListener('click', () => {
      settings.sites[s.id] = !settings.sites[s.id];
      chip.setAttribute('aria-pressed', String(settings.sites[s.id]));
      save();
      renderStatus();
    });
    $('sites').appendChild(chip);
  }

  // Master + notice switches
  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', (e) => {
    settings.enabled = e.target.checked;
    save();
    renderStatus();
  });
  $('showToast').checked = settings.showToast;
  $('showToast').addEventListener('change', (e) => { settings.showToast = e.target.checked; save(); });

  $('reset').addEventListener('click', async () => {
    await chrome.storage.local.set({ stats: {} });
  });

  function renderStatus() {
    const el = $('status');
    let text;
    let active = false;
    if (!settings.enabled) text = 'Paused everywhere';
    else if (!currentSite) text = 'Open a supported streaming site';
    else if (!settings.sites[currentSite.id]) text = `Off on ${currentSite.name}`;
    else { text = `Active on ${currentSite.name}`; active = true; }
    $('statusText').textContent = text;
    el.classList.toggle('active', active);
    $('body').classList.toggle('disabled', !settings.enabled);
  }

  function renderStats() {
    let total = 0;
    for (const f of AS.FEATURES) {
      const n = stats[f.id] || 0;
      total += n;
      counts[f.id].textContent = n.toLocaleString();
    }
    $('total').textContent = `${total.toLocaleString()} ${total === 1 ? 'skip' : 'skips'} so far`;
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.stats) {
      stats = await AS.loadStats();
      renderStats();
    }
  });

  renderStatus();
  renderStats();
})();
