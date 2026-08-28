# Workflow gallery

Real n8n workflows exported from the machine that drives the physical FHNW
rover. They are shown on the demo's landing page as a gallery — read them,
download them, copy the patterns.

**Nothing here is imported into n8n.** `setup.sh` and `reset.sh` only ever import
`../workflows`, and this folder is not mounted into the n8n container at all.
That is deliberate: these workflows name real hardware — a drill, a load cell, a
tool changer, a manipulator — that the simulated rover does not have, and they
ship `active: true` from the instance they came off. Importing them would
activate triggers against interfaces that are not there.

## Layout

| File | What it is |
|---|---|
| `gallery.json` | The curated index: title, blurb and highlights per workflow, plus the redaction rules |
| `publish.py` | Renders the gallery into the viewer's docroot |
| `*.json` | The exports themselves, verbatim apart from their filenames |

## How it reaches the page

`docker-compose.yml` mounts this folder read-only into the ros2 container at
`/demo-gallery`, and `ros2/entrypoint.sh` runs `publish.py` before websockify
starts, writing to `/usr/share/novnc/gallery/`. The landing page fetches
`gallery/index.json` and draws a card per workflow; if the index is missing it
hides the section, so a bare `docker run` of the image is still fine.

Editing a blurb only costs a `docker compose restart ros2` — the workflows are
mounted, not baked into the image.

## Redaction

The landing page is public, so `publish.py` never copies these through
unchanged. It substitutes the literals listed under `redactions` in
`gallery.json` — an internal camera host, the Asana workspace and project gids —
and pseudonymises every instance-local identifier: the n8n instance fingerprint,
workflow and version ids, webhook ids and UUID webhook paths, and credential
ids.

Webhook ids are the ones that matter. On the production instance a form trigger
URL starts a real drill or a real arm move, and the id is the only thing
standing between a passer-by and that.

Pseudonyms are a keyed hash of the original rather than a fresh random value, so
an id used twice is still the same id afterwards — Maintenance Task reuses one
webhook id across four Wait nodes, and the workflows call each other by id.
Re-running produces identical output, so the docroot does not churn on restart.

`publish.py` refuses to write a file if any of it survives, because publishing a
half-redacted export is worse than publishing none: the page says these have
been sanitised.

Credentials themselves were never at risk — an n8n export references credentials
by id and name only, and carries no secret material.

## Adding one

1. Drop the export in as `<slug>.json`.
2. Add an entry to `gallery.json` with a matching `slug`, plus `title`,
   `subtitle`, `blurb` and `highlights`.
3. Check it for anything that should not be public and add `redactions` entries
   for whatever the identifier rules above do not already cover — hostnames,
   third-party account ids, customer names, absolute paths.
4. `docker compose restart ros2`.

The node counts, phase labels, ROS interface names and the preview graph are all
derived from the export, so there is nothing to keep in sync by hand.
