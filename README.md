# AutoSkip

A small Chrome / Brave / Edge extension that clicks the buttons you'd otherwise click yourself while binge-watching:

- **Skip Intro / Skip Recap**
- **Next Episode** (and "Skip Credits")
- **Skip Ad**, as soon as the countdown ends
- **"Are you still watching?" → Continue**

Works on:

| Site | Domains |
|---|---|
| Netflix | netflix.com |
| Prime Video | primevideo.com, amazon.com / .in / .co.uk / .de / .ca / .com.au / .co.jp |
| JioHotstar | hotstar.com, jiohotstar.com |
| ZEE5 | zee5.com |
| SonyLIV | sonyliv.com |

Everything is on by default. The toolbar popup lets you turn each action and each site on or off, shows how
many times each one fired, and has a master switch (the icon shows **OFF** when paused). A small notice such
as "Skipped intro" appears on the video when it clicks something; you can turn that off too.

No data leaves your browser. The extension has no analytics and makes no network requests; it only stores
your settings and click counts in Chrome's extension storage.

## Install

AutoSkip isn't on the Chrome Web Store, so you load it as an unpacked extension. It takes about a minute.

1. **Get the code**: click **Code → Download ZIP** on this page and unzip it, or run
   ```bash
   git clone https://github.com/akashdahad11/autoskip-extension.git
   ```
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the **`autoskip`** folder *inside* the project.
   (Picking the top-level folder gives "Manifest file is missing or unreadable".)
5. Pin AutoSkip from the puzzle-piece menu so the popup is one click away.

**Updating:** pull or re-download the code, then press the reload ↻ button on the AutoSkip card in the
extensions page and refresh any open streaming tabs.

## How it finds buttons

`autoskip/content.js` runs on the sites above (including their iframes) and re-checks the page whenever it
changes (at most every 250 ms, plus a 1 s fallback). It looks in three layers:

1. **Known selectors**: Netflix `data-uia="player-skip-*"`, `next-episode-seamless-button`,
   `interrupt-autoplay-continue`; Prime Video `atvwebplayersdk-skipelement-button`,
   `atvwebplayersdk-nextupcard-button`; Google IMA `videoAdUiSkipButton`.
2. **Class names** such as `skip-intro`, `skipIntro`, `skip-ad-button`.
3. **Button text**: "Skip Intro/Recap/Opening/Credits", "Skip Ad(s)", "Next Episode", "Play/Watch Next",
   plus Hindi (इंट्रो छोड़ें, विज्ञापन छोड़ें, अगला एपिसोड).

Netflix and Prime Video use layer 1, so they're the most reliable. JioHotstar, ZEE5 and SonyLIV rely mostly
on layer 3, which also keeps things working when a site renames its classes.

### Safeguards against wrong clicks

- A **"Next Episode"** button found by text alone is only clicked in the last 5 minutes **and** last 20% of
  the video. Icon-only control-bar "next" buttons are never clicked, so it can't jump you out of an episode
  you're in the middle of.
- A bare **"Skip"** button only counts as Skip Ad inside an ad container or while Prime Video's ad timer is
  showing.
- "Skip Ad in 5" countdowns are ignored until they turn into "Skip Ad".
- "Skip forward 10s" buttons and the "Continue Watching" row on home pages are ignored.
- The same button is clicked at most once every 5 s, and Next Episode at most once every 12 s, so it can't
  skip two episodes in a row.
- On amazon.* it does nothing unless the Prime Video player is open.

### Known limits

- Some ad players ignore clicks made by scripts. Where that happens no extension can press Skip Ad, and
  you'll have to click it yourself.
- Ads that have no skip button (for example Netflix's ad tier) can't be skipped.
- Streaming sites change their player markup now and then. If a button stops being clicked, see below.

## A button isn't being clicked?

1. On the player, right-click the button → **Inspect**.
2. Note its text and its `class` / `data-*` attributes.
3. Either [open an issue](https://github.com/akashdahad11/autoskip-extension/issues) with that info and the
   site name, or add the selector to `SITE_SELECTORS` (or the text to `TEXT_RULES`) in
   `autoskip/content.js` and send a pull request.

Every click is logged to the DevTools console at the **Verbose** level as
`[AutoSkip] clicked <feature> <element>`, which helps when debugging.

## Project layout

```
autoskip/                  ← the extension (load this folder)
  manifest.json            Manifest V3
  shared.js                sites, features, default settings
  content.js               detection, clicking, on-screen notice
  background.js            badge, click counts, relays the notice from ad iframes
  popup/                   toolbar popup
  icons/
test/harness.html          mock-page tests for the detection rules (28 cases)
test/popup-preview.html    renders the popup with a fake chrome.* API
tools/make_icons.py        regenerates the icons (needs Pillow)
```

### Running the tests

Serve the project root and open the harness:

```bash
python3 -m http.server 8791
```

Then visit `http://localhost:8791/test/harness.html`. The page title shows `PASS 28/28` or lists the cases
that failed.

## Disclaimer

AutoSkip is an independent project and isn't affiliated with or endorsed by Netflix, Amazon, JioStar, ZEE5
or Sony Pictures Networks. All trademarks belong to their owners.

## License

[MIT](LICENSE)
