# Suggest a location

A small map where Alexandria residents can suggest where a Capital Bikeshare
station or a bike and scooter parking corral should go, and vote for spots
others suggested. One page, works on phones and desktops, no build step.
Suggestions are stored in Firebase Firestore.

## Running it locally

    python3 -m http.server 8000

Then open http://localhost:8000. With no apiKey in `config.js` the page runs
as a demo that saves nothing.

## Setup

1. Create a Firebase project, then a Firestore database (Standard edition).
2. Paste `firestore.rules` into the database's Rules tab and publish.
3. Register a web app under Project settings and copy its apiKey, authDomain,
   projectId and appId into `config.js`. These values are public by design.
4. `python3 tools/bake_context.py` refreshes the stations, corrals and City
   boundary in `data/context.json` whenever they change.

## Data

| Collection | Holds | Read by the page |
|---|---|---|
| `suggestions` | type, location, vote count, `hidden`, time | yes |
| `details` | note, language, link source, device, time | no |
| `votes` | one entry per vote: suggestion, device, time | no |

To take a suggestion off the map, set its `hidden` field to `true` in the
Firebase console. There are no per-device limits on pins or votes.

## Releasing a change

Browsers keep each file for ten minutes. Raise the `?v=` number on the
stylesheet and script in `index.html`, and on the two imports at the top of
`app.js`, so a reload picks up the new version at once.

## URL parameters

| Parameter | Values | Effect |
|---|---|---|
| `type` | `station`, `corral` | Preselects and hides the type choice |
| `lang` | `en`, `es`, `am`, `ar` | Starting language |
| `src` | `qr`, `web` | Recorded with each suggestion |
