/* AutoSkip background worker: badge state, click stats, toast relay. */
importScripts('shared.js');

async function refreshBadge() {
  const s = await AutoSkip.loadSettings();
  await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  await chrome.action.setBadgeText({ text: s.enabled ? '' : 'OFF' });
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) refreshBadge();
});

// Stats are counted here (one writer) so clicks from several frames at once
// don't overwrite each other.
let statsQueue = Promise.resolve();
function bumpStat(feature) {
  statsQueue = statsQueue.then(async () => {
    const stats = await AutoSkip.loadStats();
    stats[feature] = (stats[feature] || 0) + 1;
    await chrome.storage.local.set({ stats });
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'autoskip:clicked') return;
  bumpStat(msg.feature);
  // Show the notice in the tab's top frame, even if the click happened
  // inside an ad iframe.
  if (sender.tab && sender.tab.id != null) {
    chrome.tabs
      .sendMessage(sender.tab.id, { type: 'autoskip:toast', feature: msg.feature }, { frameId: 0 })
      .catch(() => {});
  }
});
