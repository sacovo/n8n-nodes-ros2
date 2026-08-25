# Public demo: a virtual rover driven by n8n

A self-contained showcase for this node package. It runs a simulated rover that
offers real ROS 2 topics, services and actions, drives it from n8n workflows,
and puts the whole thing on the web: the n8n editor behind TLS, and a
**read-only** live view of the robot that anyone can open.

```
                     ┌─ https://n8n.example.org    → n8n editor (owner login)
Internet ─── Caddy ──┤
   (TLS)             └─ https://robot.example.org  → live view, read-only, public

internal network
  n8n ──ws──▶ ros2 container
                ├─ rosbridge + rosapi   (:9090, not exposed publicly)
                ├─ turtlesim on Xvfb    (the robot you see)
                ├─ x11vnc -viewonly ──▶ noVNC (:6080)
                ├─ rover_node.py        (services, actions, battery, waypoints)
                └─ camera_node.py       (publishes the screen as a camera topic)
```

## Quick start

Locally, no domains needed:

```bash
./setup.sh
```

Then open <http://localhost:5678> for the editor and <http://localhost:6080>
for the live view. The first visit to the editor asks you to create the owner
account.

On your server:

```bash
cp .env.example .env      # fill in your two domains and an ACME email
./setup.sh --public
```

Both domains need A/AAAA records pointing at the server before you run this, and
ports 80 and 443 must be free — Caddy fetches Let's Encrypt certificates on
first start.

`setup.sh` is safe to re-run; it overwrites the demo credentials and workflows
with the copies in this folder.

## The robot

`rover_node.py` wraps turtlesim in a rover-shaped interface. Everything it does
shows up on the live view, and the trail colour is the status LED.

**Actions**

| Action | Type | What it does |
|---|---|---|
| `/rover/navigate_to` | `rover_interfaces/action/NavigateTo` | Drives to one point, feedback with distance remaining, cancellable |
| `/rover/patrol` | `rover_interfaces/action/Patrol` | Visits named waypoints in order, feedback per waypoint, optional looping |

**Services**

| Service | Type | What it does |
|---|---|---|
| `/rover/set_led` | `rover_interfaces/srv/SetLed` | Sets the LED and the trail colour |
| `/rover/dock` | `std_srvs/srv/Trigger` | Drives home and starts charging; preempts a running mission |
| `/rover/emergency_stop` | `std_srvs/srv/SetBool` | Engages or releases the e-stop |
| `/rover/reset_battery` | `std_srvs/srv/Trigger` | Refills the battery, for when a demo needs a reset |
| `/rover/reset_demo` | `std_srvs/srv/Trigger` | Full reset: battery, e-stop, trail, back to the centre |

**Topics**

| Topic | Type | Rate |
|---|---|---|
| `/rover/status` | `rover_interfaces/msg/RoverStatus` | 2 Hz |
| `/rover/battery` | `rover_interfaces/msg/BatteryState` | 1 Hz |
| `/rover/events` | `std_msgs/String` (JSON) | on every event |
| `/rover/camera/compressed` | `sensor_msgs/msg/CompressedImage` | 2 Hz |

### The map

The map has landmarks drawn on it — a lake, a tree, a house, a mountain and a
charging dock — so a demo can talk about *places* rather than coordinates:

| Place | Where | Drawn as |
|---|---|---|
| `lake` | top left | blue pool with a ripple |
| `tree` | top right | green fir with a trunk |
| `house` | bottom right | orange walls, roof and door |
| `mountain` | bottom left | grey peak with a snow line |
| `dock` | bottom centre | yellow charging pad |
| `center` | middle | where the rover starts |

turtlesim cannot draw images, so the map is drawn with the pen: a teleport with
the pen down leaves an instant straight line, and the whole map appears in about
a second. It is drawn at startup and again after every reset, because `/clear`
erases the landmarks along with the trail.

A second, temporary turtle named `cartographer` does the drawing and is killed
afterwards, leaving its lines behind. That matters: teleporting the *rover*
around to draw would look exactly like the robot glitching across the screen,
once an hour, in front of whoever is watching.

`/rover/landmarks` is a latched topic listing the places and their coordinates,
so a form or an agent can offer destinations without hardcoding them.

`nw`, `ne`, `sw` and `se` still exist as plain corner waypoints. The map runs
from 0 to 11.08 on both axes.

The battery drains about 0.9 %/s while driving and recharges at 6 %/s on the
dock, so a patrol costs roughly a quarter of the pack. That is deliberate — it
makes the battery watchdog fire during a demo instead of an hour later.

### Two things worth pointing at during a demo

**Custom types, discovered at runtime.** `rover_interfaces` is a real ROS 2
interface package with nested custom messages (`RoverStatus` embeds
`BatteryState` and `Waypoint`, which embeds a `geometry_msgs/Pose2D`). Run
`ROS2 API` → Topic → Get Definition on `/rover/status` and it expands the whole
tree. Nothing about these types is hardcoded in n8n.

**Self-documenting interfaces.** Every interface publishes a latched
`<name>/desc` topic describing what it is for. `ROS2 API` → Get Type with
*Include Description* reads them back, and the `.msg` files carry comments about
units and allowed values that *Include Raw Definition* surfaces.

### Where rosbridge comes from

The image builds `rosapi` from the FHNW fork
(`sacovo/rosbridge_suite`, branch `fhnw/rosapi-fixes`), so the demo exercises the
same rosapi the real rover deployment runs. It carries fixes for three rosapi
crashes that stock Jazzy has, each of which kills `rosapi_node` outright — and
because it spins bare, that takes every in-flight `/rosapi/*` call down with it,
which looks like a discovery bug in the n8n nodes when it is not:

- `objectutils._type_name` asserting on non-message instances, which happens
  while expanding `type_description_interfaces/srv/GetTypeDescription` — a
  built-in service on every node from Jazzy on, so expanding *any* node trips it.
- `/rosapi/action_type` calling a ros2cli-only method, so looking an action up by
  name never answers.
- the parameter client cache crashing the node.

Only `rosapi` is overlaid. The fork's `rosbridge_library` targets a newer ROS 2
than Jazzy — it imports `rosidl_pycommon.interface_base_classes`, which Jazzy
does not ship — so everything else still comes from `ros-jazzy-rosbridge-suite`.
The fork's rosapi only needs `ROSMessage` from
`rosbridge_library.internal.type_support`, which Jazzy's copy provides.

rosbridge is launched through its launch file rather than `ros2 run`, because the
launch file sets `call_services_in_new_thread` and
`send_action_goals_in_new_thread` to true while the node defaults are false. With
them false rosbridge serialises every service call, so the concurrent rosapi
fan-out behind "Get Definition" times out. `respawn:=true` restarts rosapi or
rosbridge individually if either dies.

**Per-node action detection still does not work**, and cannot without a rosapi
change: `NodeDetails.srv` has no actions field at all, and `get_node_services`
filters out the hidden `<action>/_action/*` services that action detection infers
from. So `Node → Get Definition` reports no actions. Workflow 10 works around it
with the global `Action → List`, expanding each action separately.

## The workflows

| # | Workflow | Shows off |
|---|---|---|
| 01 | Patrol Mission | Schedule → Service Call → **Action** (send goal and wait, with feedback) |
| 02 | Battery Watchdog | **Topic Trigger** with a conditions filter → Service Call → Topic Publish |
| 03 | Send the Rover Somewhere | n8n Form with a **dropdown of places** → **Action** with live feedback → result page |
| 04 | ROS Calls n8n | **Service Trigger** — n8n advertises `/n8n/mission_report` to ROS |
| 05 | ROS Calls n8n | **Action Trigger + Action Respond** — n8n advertises `/n8n/inspect`, sends feedback, succeeds |
| 06 | Camera Snapshot | Webhook → **Capture Image** → returns a JPEG |
| 07 | Ask the Rover | **AI agent** with vision: discovers the graph, drives the rover, and looks through its camera |
| 08 | Hourly Demo Reset | Housekeeping: calls `/rover/reset_demo` every hour |
| 09 | Mission Planner | **The model plans, n8n executes**: plain-language mission → JSON plan → looped step-by-step execution |
| 10 | Self-Documenting Robot | Runtime discovery → an operator manual written from the live graph, at `/webhook/rover-manual` |
| 11 | Incident Responder | Same trigger as 02, but an **agent decides** whether to dock, finish, or e-stop |

All of them except 11 are activated by `setup.sh`. Workflow 07 needs a model
credential; it ships wired to Anthropic with a DeepSeek node parked beside it.

Workflow 11 ships **inactive on purpose**: it listens to the same `battery_low`
event as workflow 02, so running both means two things race to command the
rover. Turn 02 off before turning 11 on — the pair is meant to be shown as a
before/after, fixed logic against a reasoned decision.

### The agent (workflow 07)

Its tools are deliberately *plain*: the agent fills in every ROS name, type and
payload itself from `$fromAI`, so nothing about this rover is hardcoded in the
workflow. It can list nodes, expand any node, service or action into concrete
fields, read and publish topics, call services, send action goals, and look
through the camera. Chat with it at `/webhook/rover-chat/chat`.

**Use a vision model.** "Is the turtle in the lake?" is answered two ways: by
comparing `/rover/status` against the landmark coordinates, and by actually
looking at the map through `/rover/camera/compressed`. The second only works on
a model that accepts images. DeepSeek's API rejects them outright —
`unknown variant 'image_url', expected 'text'` — and that error aborts the whole
agent run, so the DeepSeek node is left disabled rather than half-working. Swap
the `ai_languageModel` connection to it if you want the text-only variant, and
drop the camera tool if you do.

**The chat trigger is public**, so anyone with the link can drive the rover and
spend model tokens. Set `public: false` on the Chat node if that is not what you
want.

A nice sequence to demo live:

1. Open the live view. Workflow 01 tours the landmarks every three minutes.
2. Open `https://<n8n-domain>/form/drive-rover` and send the rover to the lake —
   the form is a public URL, so this works from a phone in the audience.
3. Let the battery fall below 25 %. Workflow 02 catches the event, turns the LED
   red, preempts the patrol and docks the rover.
4. From ROS, call into n8n:
   `docker compose exec ros2 /bin/bash /demo-scripts/call-n8n-from-ros.sh`
5. Fetch `https://<n8n-domain>/webhook/rover-snapshot` for a JPEG of the map.
6. Chat with workflow 07: *"what interfaces does the rover have, and send it to
   the tree"*.

Step 3 preempting step 1 means the patrol goal gets aborted, which shows up as a
failed execution on workflow 01. That is the honest outcome of a mission being
interrupted, not a bug.

`demo/scripts/poke-the-rover.sh` drives the rover straight from ROS with no n8n
involved, which is the quickest way to tell a robot problem from a workflow
problem.

## Security choices

**The live readout is a read-only JSON endpoint, not rosbridge.** The viewer page
polls `/api/status` every two seconds for battery, state, destination and LED
colour. It is served by the rover process itself on port 8081 (proxied by Caddy
under `/api/*`), deliberately not through n8n, so the readout keeps working
while the hourly reset restarts n8n. The endpoint only ever reads.

**The live view is read-only at the protocol level.** `x11vnc` runs with
`-viewonly`, so the server never applies pointer or keyboard events no matter
what a client sends. The noVNC `view_only=1` URL flag on top of it is just
cosmetic; deleting it does not make the view interactive.

**Rosbridge is not on the internet.** It is published to `127.0.0.1` only and
reachable from n8n over the internal Docker network. An open rosbridge is a
remote control for the robot — anyone who can reach it can publish to any topic,
call any service and change parameters. The `Caddyfile` has a commented-out
block for exposing it over `wss://` if you want external ROS clients; it gates on
a token, and you should also set that token in the n8n credential.

**No Docker socket.** The repo's top-level `docker-compose.yml` mounts
`/var/run/docker.sock` into n8n so the Docker Container node can manage
containers. That is root on the host by another name, so this stack does not do
it. The Docker node is unavailable here as a result.

**The n8n owner account is the whole authentication boundary,** and an unclaimed
n8n instance can be claimed by whoever reaches it first — with the Code node,
that means running code on your server. `setup.sh --public` therefore imports
everything with Caddy still down and waits for you to create the owner account
before it exposes anything. Create that account through an SSH tunnel:

```bash
ssh -L 5678:localhost:5678 your-server    # then open http://localhost:5678
```

**Credentials.** `N8N_ENCRYPTION_KEY` must be set once and never changed, or n8n
loses the ability to decrypt its stored credentials. Generate one with
`openssl rand -hex 24`. `setup.sh --public` refuses to start while it is still
a placeholder, and also refuses if `N8N_PROTOCOL`, `N8N_SECURE_COOKIE` or
`N8N_PUBLIC_URL` disagree with your domain — those defaults are safe locally and
would silently produce cleartext cookies and unreachable webhook URLs in public.

**The container running the internet-facing process is not root.** Everything in
the ROS container, websockify included, runs as the unprivileged `ubuntu` user,
and `.env` is excluded from the Docker build context so the encryption key never
lands in an image layer.

The imported credential set includes a read-only variant
(`ROS2 Rosbridge (Demo Rover, Read-Only)`), used by the workflows that only
observe. Anything using it is refused at the node level if it tries to publish,
call a service or advertise.

## Keeping a public demo clean

A demo left running drifts: the battery ends up empty, the map gets scribbled
over, someone leaves the e-stop engaged or edits a workflow. Two layers handle
that.

**Hourly, in-band and with no downtime.** Workflow 08 calls `/rover/reset_demo`
every hour, which refills the battery, releases the e-stop, wipes the trail and
teleports the rover back to the centre. Nothing restarts, so nobody watching
notices anything except a clean map.

**Hourly, deeper, with a few seconds of downtime.** `reset.sh` additionally
restores the credentials and workflows from this folder, discarding any edits
made in the editor, then restarts n8n so the triggers re-arm. Worth scheduling
if you hand the n8n login to a group; unnecessary if you are the only one who
can log in. Install the provided timer:

```bash
sudo cp systemd/rover-demo-reset.{service,timer} /etc/systemd/system/
sudo nano /etc/systemd/system/rover-demo-reset.service   # fix the two paths
sudo systemctl daemon-reload
sudo systemctl enable --now rover-demo-reset.timer
systemctl list-timers rover-demo-reset.timer             # check it is scheduled
```

Run it by hand any time with `./reset.sh`, or `./reset.sh --hard` to restart the
robot process as well.

Execution history is pruned automatically after `EXECUTIONS_MAX_AGE_HOURS`
(default 2), so a demo running for weeks does not grow an unbounded database.

One caveat after pulling new code: the n8n container keeps the installed node
package in its data volume and skips reinstalling on restart, so a rebuild alone
does not pick up node changes. Force it once with:

```bash
SKIP_NODE_REINSTALL=0 docker compose up -d --build n8n
```

## Starting completely over

```bash
docker compose down            # keeps the TLS certificates
docker volume rm demo_n8n_data # forget the n8n database and owner account
./setup.sh
```

Avoid `docker compose down -v` on the public server: that also deletes
`caddy_data`, which holds your Let's Encrypt certificates and ACME account key.
Let's Encrypt allows five duplicate certificates per domain per week, so a few
careless resets can leave the site without a certificate.

## Layout

```
demo/
├── docker-compose.yml    n8n + ros2 (+ caddy under the "public" profile)
├── Caddyfile             TLS, the two public sites, optional rosbridge exposure
├── .env.example          domains, ACME email, encryption key
├── setup.sh              build, start, import, activate
├── reset.sh              restore the demo to its shipped state
├── systemd/              timer + unit for running reset.sh hourly
├── credentials/          rosbridge credential, normal and read-only
├── workflows/            the eight demo workflows
├── scripts/              ROS-side helpers, mounted into the ros2 container
└── ros2/
    ├── Dockerfile        rosbridge + turtlesim + Xvfb + x11vnc + noVNC
    ├── entrypoint.sh     starts the display, the viewer and the ROS stack
    ├── rover_node.py     the rover: actions, services, battery, map, status API
    ├── camera_node.py    publishes the screen as a camera topic
    ├── web/index.html    the public landing page around the viewer
    └── rover_interfaces/ custom msg/srv/action package
```
