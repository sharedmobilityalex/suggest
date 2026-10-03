# Suggest a location

A small map where Alexandria residents can suggest where a Capital Bikeshare
station or a bike and scooter parking corral should go. One page, works on
phones and desktops, no build step. Submissions land in a Google Sheet.

## Running it locally

    python3 -m http.server 8000

Then open http://localhost:8000. With no sheet URL in `config.js` the page runs
as a demo that saves nothing.

## Setup

1. Create a Google Sheet. Open Extensions, Apps Script, paste `tools/sheet.gs`
   over the default file, save, and run `setup` once (approve the permission
   prompt). That creates the `suggestions` and `votes` tabs.
2. Deploy, New deployment, type Web app, execute as yourself, access for
   anyone. Copy the web app URL into `config.js`.
3. `python3 tools/bake_context.py` refreshes the stations, corrals and City
   boundary in `data/context.json` whenever they change.

Only the script's URL is public, and it returns just the type, location and
vote count of each suggestion. The sheet itself stays private to its owner.
To take a suggestion off the map, type TRUE in its `hidden` cell. After
editing the script, publish it again under Deploy, Manage deployments, New
version; the URL stays the same.

## Releasing a change

Browsers keep each file for ten minutes. Raise the `?v=` number on the
stylesheet and script in `index.html`, and on the two imports at the top of
`app.js`, so a reload picks up the new version at once.

## URL parameters

| Parameter | Values | Effect |
|---|---|---|
| `type` | `station`, `corral` | Preselects and hides the type choice |
| `lang` | `en`, `es` | Starting language |
| `src` | `qr`, `web` | Recorded with each suggestion |
