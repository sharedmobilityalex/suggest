# Suggest a location

A small map where Alexandria residents can suggest where a Capital Bikeshare
station or a bike and scooter parking corral should go. One page, works on
phones and desktops, no build step.

## Running it locally

    python3 -m http.server 8000

Then open http://localhost:8000. Without a Firebase config the page runs in
demo mode and keeps suggestions in memory.

## Setup

1. **Firebase.** Create a project, enable Anonymous sign-in under
   Authentication, create a Firestore database, publish `firestore.rules`,
   and paste the web app config into `config.js`.
2. **Staff access.** Notes are kept off the map. To read them in the console
   or in a future admin page, add a document to the `staff` collection whose
   id is the staff member's user id.
3. **Context data.** `python3 tools/bake_context.py` refreshes the stations,
   corrals and City boundary in `data/context.json`.

## Basemaps

Streets come from OpenFreeMap's Positron style (vector, no key); the satellite
view is Esri World Imagery with Esri's transportation labels. Neither needs an
account.

## URL parameters

| Parameter | Values | Effect |
|---|---|---|
| `type` | `station`, `corral` | Preselects and hides the type choice |
| `lang` | `en`, `es` | Starting language |
| `src` | `qr`, `web` | Recorded with each suggestion |

## Data

Suggestions are stored as `suggestions` (public: type, location, vote count),
`notes` (kept off the map) and `votes` (one per person per suggestion). Setting
`hidden` to true on a suggestion removes it from the map.
