#!/usr/bin/env python3
"""Render the workflow gallery into the viewer's docroot.

    publish.py <source-dir> <output-dir>

The files in <source-dir> are verbatim n8n exports from the real rover. The
landing page they end up on is public, so nothing is copied through unchanged:

  * every literal in gallery.json's `redactions` is substituted, and
  * every instance-local identifier — the n8n instance fingerprint, workflow and
    version ids, webhook ids and paths, credential ids — is pseudonymised.

Pseudonymisation is a keyed hash rather than a fresh random value, so an id that
appears in two places still appears in two places afterwards. That matters here:
Maintenance Task reuses one webhook id across four Wait nodes, and losing that
would misrepresent the workflow. The key is fixed, so re-running produces the
same output and the docroot does not churn on every container restart.

Webhook ids are worth the trouble. On the production instance a form trigger
URL starts a real drill or a real arm move, and the id is the only thing
standing between a passer-by and that.

Alongside the redacted workflows this writes index.json: the curated blurbs from
gallery.json plus, derived from each export, the node/connection counts, the
sticky-note headings that label each phase, the ROS interfaces touched, and a
laid-out graph for the preview. Doing that here keeps the page from having to
download 200 kB of workflow JSON just to draw a thumbnail.
"""

import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

# Not a secret: it only has to be stable and not be the empty string. Changing
# it changes every pseudonym, which is a no-op for the reader but rewrites every
# file in the docroot.
SALT = "fhnw-rover-gallery"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _digest(*parts: str) -> bytes:
    return hashlib.sha256((SALT + "\0" + "\0".join(parts)).encode()).digest()


def fake_uuid(original: str) -> str:
    """A stable stand-in UUID. Same input, same output; no way back."""
    return str(uuid.UUID(bytes=_digest("uuid", original)[:16], version=4))


def fake_id(original: str, length: int = 16) -> str:
    """A stable stand-in for n8n's short base-62-ish object ids."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    digest = _digest("id", original)
    return "".join(alphabet[b % len(alphabet)] for b in digest[:length])


# How each node type is drawn in the preview. Longest prefix wins, so the ROS2
# *Tool* nodes have to be tested before the plain ROS2 nodes.
KINDS = [
    ("@fhnw-rover/n8n-nodes-ros2.rosApiTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.rosServiceCallTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.rosTopicNextMessageTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.rosTopicCaptureImageTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.rosTopicPublishTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.rosActionTool", "rostool"),
    ("@fhnw-rover/n8n-nodes-ros2.", "ros"),
    ("@n8n/n8n-nodes-langchain.", "ai"),
    ("n8n-nodes-base.formTrigger", "human"),
    ("n8n-nodes-base.form", "human"),
    ("n8n-nodes-base.asana", "ext"),
    ("n8n-nodes-base.httpRequest", "ext"),
    ("n8n-nodes-base.executeWorkflow", "sub"),
]


def kind_of(node_type: str) -> str:
    for prefix, kind in KINDS:
        if node_type.startswith(prefix):
            return kind
    return "flow"


def workflow_ids(workflows: list) -> dict:
    """Every n8n workflow id mentioned anywhere, mapped to its stand-in.

    These have to be substituted as text across the whole set rather than field
    by field: the workflows call each other, so an id appears as a top-level
    `id` in one file and inside an Execute Workflow node's `workflowId` (and the
    `cachedResultUrl` beside it) in another. Rewriting only the field we happen
    to know about would leave the id sitting in the other file and would also
    break the link between them. `fake_id` is a pure function of the original,
    so both ends land on the same stand-in without any bookkeeping.
    """
    found = set()
    for wf in workflows:
        if wf.get("id"):
            found.add(wf["id"])
        for node in wf.get("nodes", []):
            if "executeWorkflow" not in node.get("type", ""):
                continue
            reference = node.get("parameters", {}).get("workflowId")
            if isinstance(reference, dict) and isinstance(reference.get("value"), str):
                found.add(reference["value"])
    return {original: fake_id(original) for original in found if original}


def redact(workflow: dict, literals: list, ids: dict) -> dict:
    """Substitute the configured literals, then pseudonymise every identifier."""
    text = json.dumps(workflow)
    for rule in literals:
        text = text.replace(rule["find"], rule["replace"])
    # Longest first, so no id that is a prefix of another corrupts it.
    for original in sorted(ids, key=len, reverse=True):
        text = text.replace(original, ids[original])
    wf = json.loads(text)

    if wf.get("versionId"):
        wf["versionId"] = fake_uuid(wf["versionId"])

    meta = wf.get("meta")
    if isinstance(meta, dict) and meta.get("instanceId"):
        meta["instanceId"] = _digest("instance", meta["instanceId"]).hex()

    for node in wf.get("nodes", []):
        if node.get("webhookId"):
            node["webhookId"] = fake_uuid(node["webhookId"])
        # A webhook's `path` is the public half of the same URL. n8n defaults it
        # to a UUID; a hand-written path like "rover-chat" is not an identifier
        # and is left alone.
        path = node.get("parameters", {}).get("path")
        if isinstance(path, str) and UUID_RE.match(path):
            node["parameters"]["path"] = fake_uuid(path)
        for cred in (node.get("credentials") or {}).values():
            if isinstance(cred, dict) and cred.get("id"):
                cred["id"] = fake_id(cred["id"])

    return wf


def leaks(text: str, literals: list, originals: dict, ids: dict) -> list:
    """Anything from the source that must not have survived redaction."""
    found = [r["find"] for r in literals if r["find"] in text]
    found += [v for v in originals.values() if v and v in text]
    found += [i for i in ids if i in text]
    return sorted(set(found))


def interfaces_of(wf: dict) -> dict:
    """The ROS names this workflow touches, by kind, in first-seen order."""
    buckets = {"services": [], "topics": [], "actions": []}
    bucket_for = {
        "rosServiceCall": "services",
        "rosTopicPublish": "topics",
        "rosTopicNextMessage": "topics",
        "rosTopicCaptureImage": "topics",
        "rosAction": "actions",
    }
    for node in wf.get("nodes", []):
        short = node.get("type", "").rsplit(".", 1)[-1]
        bucket = bucket_for.get(short)
        if not bucket:
            continue
        for key in ("serviceName", "topicName", "actionName"):
            value = node.get("parameters", {}).get(key)
            if isinstance(value, dict):
                value = value.get("value")
            # Skip the ones an expression fills in at runtime; a raw
            # "={{ $fromAI(...) }}" means nothing to a reader.
            if isinstance(value, str) and value and not value.startswith("="):
                if value not in buckets[bucket]:
                    buckets[bucket].append(value)
    return {k: v for k, v in buckets.items() if v}


def graph_of(wf: dict) -> dict:
    """A compact node/edge list for the preview, in editor coordinates.

    Sticky notes are dropped: they are background rectangles sized to cover
    other nodes, and drawing them would bury the graph they annotate. Their
    headings are surfaced separately as the phase list.
    """
    nodes, index = [], {}
    for node in wf.get("nodes", []):
        if node.get("type", "").endswith("stickyNote"):
            continue
        position = node.get("position") or [0, 0]
        index[node.get("name")] = len(nodes)
        nodes.append(
            {
                "x": round(position[0]),
                "y": round(position[1]),
                "k": kind_of(node.get("type", "")),
                "n": node.get("name", ""),
            }
        )

    edges = []
    for source, outputs in (wf.get("connections") or {}).items():
        if source not in index:
            continue
        for channel, slots in (outputs or {}).items():
            for slot in slots or []:
                for link in slot or []:
                    target = link.get("node")
                    if target in index:
                        edges.append([index[source], index[target], channel])
    return {"nodes": nodes, "edges": edges}


def phases_of(wf: dict) -> list:
    """Sticky-note headings, which is how these workflows label their phases."""
    phases = []
    for node in wf.get("nodes", []):
        if not node.get("type", "").endswith("stickyNote"):
            continue
        for line in (node.get("parameters", {}).get("content") or "").splitlines():
            line = line.strip()
            if line.startswith("#"):
                heading = line.lstrip("#").strip()
                if heading and heading not in phases:
                    phases.append(heading)
    return phases


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    source, output = Path(sys.argv[1]), Path(sys.argv[2])

    manifest_path = source / "gallery.json"
    if not manifest_path.is_file():
        # Not an error: the gallery is a bind mount, and a bare `docker run` of
        # this image has no reason to carry one. The page hides the section.
        print(f"[gallery] no manifest at {manifest_path}, publishing an empty gallery")
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.json").write_text(json.dumps({"workflows": []}))
        return 0

    manifest = json.loads(manifest_path.read_text())
    literals = manifest.get("redactions", [])
    output.mkdir(parents=True, exist_ok=True)

    # The container keeps its docroot across restarts, so clear the previous run
    # out first. Otherwise a workflow dropped from the manifest, or one that
    # fails the redaction check below, would stay downloadable from the last
    # time it succeeded.
    for stale in output.glob("*.json"):
        stale.unlink()

    # Load the whole set before redacting any of it: the id map has to cover
    # every workflow so the cross-references between them stay joined up.
    loaded = []
    for entry in manifest.get("workflows", []):
        path = source / f"{entry['slug']}.json"
        if not path.is_file():
            print(f"[gallery] missing {path.name}, skipping", file=sys.stderr)
            continue
        loaded.append((entry, path, json.loads(path.read_text())))

    ids = workflow_ids([wf for _, _, wf in loaded])

    published = []
    for entry, path, original in loaded:
        originals = {
            "instanceId": (original.get("meta") or {}).get("instanceId"),
            "versionId": original.get("versionId"),
        }
        for node in original.get("nodes", []):
            if node.get("webhookId"):
                originals[f"webhook:{node['webhookId']}"] = node["webhookId"]

        redacted = redact(original, literals, ids)
        text = json.dumps(redacted, indent=2)

        remaining = leaks(text, literals, originals, ids)
        if remaining:
            # Publishing a half-redacted file is worse than publishing none:
            # the page would claim it was sanitised.
            print(f"[gallery] REFUSING {path.name}: {remaining} survived redaction", file=sys.stderr)
            return 1

        (output / path.name).write_text(text)
        published.append(
            {
                **{k: v for k, v in entry.items() if not k.startswith("_")},
                "file": path.name,
                "bytes": len(text),
                "stats": {
                    "nodes": len([n for n in redacted.get("nodes", []) if not n.get("type", "").endswith("stickyNote")]),
                    "ros": len([n for n in redacted.get("nodes", []) if "n8n-nodes-ros2" in n.get("type", "")]),
                },
                "phases": phases_of(redacted),
                "interfaces": interfaces_of(redacted),
                "graph": graph_of(redacted),
            }
        )

    (output / "index.json").write_text(json.dumps({"workflows": published}, indent=2))
    print(f"[gallery] published {len(published)} workflow(s) to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
