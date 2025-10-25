
# Toledo Traffic Cameras (ODOT / OHGO) — Static Viewer

A tiny static website that lists **Toledo, Ohio** traffic cameras from the **ODOT OHGO Public API** and **auto‑refreshes** each snapshot on a timer.

> ⚠️ You must supply your own OHGO API key.

---

## Quick Start

1. Go to the OHGO API docs and register for a key: https://publicapi.ohgo.com/docs/registration  
   (How keys work: https://publicapi.ohgo.com/docs/api-key)
2. Open `index.html` in a modern browser.
3. Paste your API key at the top and click **Save**.
4. Cameras will load for the **Toledo** region and the images will refresh on the interval you choose.

> The API returns camera **snapshot URLs** that update approximately **every 5 seconds**. This viewer busts the cache by appending a timestamp to the URL on each refresh. See: https://publicapi.ohgo.com/docs/v1/cameras

## Files

- `index.html` — markup and UI
- `styles.css` — lightweight dark theme
- `app.js` — fetches cameras (`region=toledo&page-all=true`), renders a grid of views, and auto‑refreshes images
- `README.md` — this file

## Notes / Tips

- Use the **Size** toggle to switch between the API's `SmallUrl` and `LargeUrl` images.
- Use the search box to filter by route or intersection.
- Your API key is **stored locally** in your browser's `localStorage` (never sent anywhere except directly to the OHGO API when the page loads cameras).

## Legal / Attribution

- Data and images © **Ohio Department of Transportation** (ODOT) / **OHGO**.
- Follow the OHGO API **Terms & Conditions** and rate limits.
- This viewer is for convenience; availability of cameras may change, and some cameras may be temporarily offline.

