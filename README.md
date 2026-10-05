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
3. To republish right after each save, create a fine-grained GitHub token for
   this repository only with Contents: Read and write, add it in Apps Script
   under Project Settings, Script Properties, as `GITHUB_TOKEN`, then run
   `testPublish` once from the editor. It should log 204. When the token
   expires, the hourly refresh keeps working until it is replaced.
4. `python3 tools/bake_context.py` refreshes the stations, corrals and City
   boundary in `data/context.json` whenever they change.

Only the script's URL is public, and it returns just the type, location and
vote count of each suggestion. The sheet itself stays private to its owner.
The script caps how many pins and votes arrive in an hour overall; the
numbers are in `LIMITS` at the top of the script. There are no per-device
limits on pins or votes. To take a suggestion off the map, type TRUE in its `hidden` cell. After
editing the script, publish it again under Deploy, Manage deployments, New
version; the URL stays the same.

## Publishing

`.github/workflows/publish.yml` publishes the site on every push, whenever the
sheet script reports a new pin or vote, and hourly. Each run copies the public suggestions from the sheet into
`data/suggestions.json`, so the map shows its dots at once and then refreshes
them from the sheet. GitHub pauses scheduled runs after 60 days without a
commit, so the workflow adds an empty commit whenever the last one is 45 days
old. If the schedule is ever paused anyway, re-enable it under Actions. Pages must be set
to build from GitHub Actions, not from a branch.

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
