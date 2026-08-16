# ROS2 Rosbridge integration for n8n

This package provides n8n nodes for interacting with ROS2 through a rosbridge WebSocket endpoint, plus a Docker node for managing containers (e.g. the rosbridge container itself).

## Installation

1. Install this package into your n8n instance using npm or yarn.
2. Run `npm run build` in this repository to generate the `dist` output.
3. Start n8n with `npm run dev` to test the custom nodes locally.

## Nodes

### Topics

- **ROS2 Topic Trigger** — starts the workflow whenever a message arrives on a topic. Supports an optional "Conditions" filter to only fire for matching messages. Auto-reconnects if the connection drops.
- **ROS2 Topic Next Message** — waits for the next message on a topic (with the same optional "Conditions" filter) and returns it as node output.
- **ROS2 Topic Publish** — publishes a message to a topic. "Publish" sends the message; "Advertise Only" just registers the publisher without sending anything. Message body can be raw JSON or built with the visual field mapper.
- **ROS2 Topic Capture Image** — waits for the next message on an image topic (`sensor_msgs/CompressedImage`-style) and returns it as a binary file (JPEG/PNG/BMP/GIF detected from the message's `format` field).

### Services

- **ROS2 Service Call** — calls a ROS2 service with a request payload and waits for the response.
- **ROS2 Service Trigger** — advertises a service; starts the workflow when it's called and immediately answers with a configured response (raw JSON or visual mapper). Auto-reconnects if the connection drops.

### Actions

- **ROS2 Action** — drives an action server. `Send Goal and Wait` sends a goal and returns its result (optionally with every feedback message received on the way), which is the usual choice. `Send Goal` returns immediately with a `goalHandle`, which `Get Result` and `Cancel Goal` take. `Watch Feedback` and `Watch Status` read the action's feedback/status topics and report the ROS goal UUIDs they carry.
- **ROS2 Action Trigger** — advertises an action server; starts the workflow when a goal is received, and optionally when a client asks to cancel one. Auto-reconnects if the connection drops.
- **ROS2 Action Respond** — from within a workflow started by ROS2 Action Trigger, sends feedback (`Send Feedback`) or completes the goal (`Set Succeeded` / `Set Canceled` / `Set Failed`) for a given `goalId`.

### Discovery

- **ROS2 API** — queries the ROS2 graph (topics, services, nodes, actions, parameters) via rosapi. See below.

### Other

- **Docker Container** — lists, restarts, executes commands in, and gets logs from Docker containers, via the Docker Engine API or a Unix socket.

## The ROS2 API node

`ROS2 API` is the discovery entry point for the whole package: it lets a workflow (or an AI agent) find out what exists on the ROS2 graph and learn the exact message/service/action structure before calling anything.

It works over a **Resource** (`Topic`, `Service`, `Node`, `Action`, `Parameter`) and an **Operation**, which varies per resource:

- **Topic**: `List` (all topics + types, optionally combined into `{ name, type }` pairs), `List for Type` (topics using a given message type), `Get Type` (type of one topic), `Get Details` (raw type definitions), `Get Definition` (fully expanded message structure).
- **Service**: `List`, `List for Type`, `Get Type`, `Get Definition` (expanded request and response structures).
- **Node**: `List` (running nodes), `Get Details` (a node's topic/service names), `Get Definition` (a node's full topic/service/action structure — see below).
- **Action**: `List` (action servers), `Get Type` (action type of one action server), `Get Definition` (expanded goal, result and feedback structures).
- **Parameter**: `List`, `Get`, `Set`.

All `List`/`List for Type` operations accept an optional **Grep Pattern** to filter results (regex, or a plain case-insensitive substring match if the pattern isn't valid regex).

**Get Definition** is the key operation for building payloads: instead of just returning a type name, it recursively expands the message/service/action definition into concrete fields (with their ROS types), including any custom/nested message types, so a caller knows exactly what JSON shape to send or expect. For services this returns `request` and `response`; for actions it returns `goal`, `result` and `feedback`.

**Get Type** can additionally return documentation:

- *Include Description* (topics, services and actions) reads the latched `<name>/desc` topic (see the documentation convention below) and returns its text as `description` — this is where instance-level semantics live ("this Float32 is the turntable target in mm").
- *Include Raw Definition* (topics only) returns the raw `.msg` definition text, including source comments that document units and allowed enum values. rosapi only exposes raw definitions for message types currently used by an active topic; the field is `null` otherwise.

### Documentation convention: latched `/desc` topics

Nodes can document their interfaces by publishing a latched (`transient_local`, depth 1) `std_msgs/String` topic named `<topic-or-service>/desc` describing how that specific interface is used. Topic and service namespaces are separate, so `/my_service/desc` as a topic is valid. The ROS2 API node picks these up via the options above. Publish the `/desc` topics from your ROS nodes (rclpy/rclcpp), not through rosbridge — rosbridge's advertise path does not reliably create transient_local publishers.

Node **Get Definition** goes further: it returns the node's entire interface at once — `publishing` and `subscribing` (each an array of `{ name, type, definition }`), `services` (array of `{ name, type, request, response }`), and `actions` (array of `{ name, type, goal, result, feedback }`). Action servers are detected from their internal `<action>/_action/send_goal` service and reported once as a single action entry rather than as their raw internal topics/services.

## Using these nodes with AI agents

Most nodes (all except the trigger nodes, which n8n doesn't allow as tools) have `usableAsTool: true`, so they can be exposed directly to an AI agent as callable tools.

The intended loop for an agent operating on an unfamiliar ROS2 graph:

1. **Discover** with `ROS2 API` → `List` on the relevant resource (`Topic`, `Service`, `Action`, `Node`) to find candidate names, optionally narrowed with **Grep Pattern**.
2. **Learn the shape** with `ROS2 API` → `Get Definition` on the chosen topic/service/action (or `Node` → `Get Definition` to get everything a node exposes in one call). This returns the exact JSON structure expected, including any custom message types, fully expanded.
3. **Act** using that structure as the payload for `ROS2 Topic Publish`, `ROS2 Service Call`, or `ROS2 Action` → `Send Goal and Wait` (or `Send Goal`, following up with `Get Result` / `Cancel Goal` / `Watch Feedback` / `Watch Status` as needed).

This lets an agent operate against ROS2 graphs it has never seen before without hard-coded message definitions.

When invoked as a tool, a failing node does not abort the agent run: the error is returned to the model as the tool result (`{ "error": "..." }`), so the agent can correct its arguments, try another interface, or report the problem. In regular workflow executions errors still fail the node as usual (respecting the On Error setting). Tool invocations are recognized by n8n's `isToolExecution()` API or by the node running as its generated `*Tool` variant (single `ai_tool` output), which covers both n8n's legacy direct-invocation path and the newer engine-driven tool execution.

## Credentials

### ROS2 Rosbridge API

Used by all ROS2 nodes.

Required values:
- Protocol: `ws` or `wss`
- Host: rosbridge host
- Port: rosbridge port

Optional values:
- Path: path segment for the rosbridge endpoint
- Auth Token: token appended as a query parameter for authentication
- Auth Query Parameter: parameter name used for the auth token
- Connect Timeout: connection timeout in milliseconds
- Read-Only: restricts every node using this credential to observing the system (see below)

### Docker API

Used by the `Docker Container` node.

- Connection Type: `Unix Socket` or `HTTP`
- Socket Path (socket mode): path to the Docker socket, e.g. `/var/run/docker.sock`
- Protocol, Host, Port (HTTP mode)
- Authentication (HTTP mode): `None` or `Basic Auth` (username/password)
- Read-Only: allows `list` and `logs` only; `start`, `stop`, `restart` and `exec` fail with an error

### Read-only credentials

Turning on **Read-Only** on a credential blocks every operation that changes state, in all nodes that use that credential. The check runs before the node connects, so a blocked operation never reaches the robot.

Still allowed (reading):
- `ROS2 Topic Trigger`, `ROS2 Topic Next Message`, `ROS2 Topic Capture Image` — subscribing to topics
- `ROS2 API` — `List`, `Get Type`, `Get Definition`, `Get Details` and `Get` on parameters
- `ROS2 Action` — `Get Result`, `Watch Feedback` and `Watch Status`, which only observe a goal that is already running

Blocked (writing):
- `ROS2 Topic Publish` — both `Publish` and `Advertise Only`
- `ROS2 Service Call`
- `ROS2 Action` — `Send Goal`, `Send Goal and Wait` and `Cancel Goal`, and every `ROS2 Action Respond` operation
- `ROS2 Service Trigger` and `ROS2 Action Trigger` — advertising a service or action server adds an endpoint to the graph and answers callers, so an activated workflow using a read-only credential fails
- `ROS2 API` → `Parameter` → `Set`

The switch sits on the credential rather than on the node so a workflow author cannot lift it from inside a workflow, and neither can an AI agent driving a node as a tool — agents fill parameters, they never choose credentials. Blocked calls return the usual tool error (`{ "error": "... is blocked: the credential used by this node is set to read-only" }`), which the agent can read and react to. Combine it with the **Allowed Namespaces** option on `ROS2 Topic Publish` when an agent should write to a few namespaces but read everywhere: use two credentials, a read-only one for the discovery/observation tools and a writable one for the publishing tool.

## Operational notes

- **Connection pooling**: connections to rosbridge are pooled per resolved URL and reused across node executions — they are not closed after each run. This avoids repeating ROS2 discovery/handshake overhead on every execution.
- **Trigger reconnection**: `ROS2 Topic Trigger`, `ROS2 Service Trigger`, and `ROS2 Action Trigger` automatically attempt to reconnect every 5 seconds if the underlying rosbridge websocket drops, re-installing their subscription/advertisement once reconnected.
- **Action goal state is in-process**: `ROS2 Action Trigger` and `ROS2 Action Respond` share an in-memory goal registry keyed by `goalId`. This only works when both nodes run in the same n8n process — it will not work in queue mode where the trigger and a worker executing `ROS2 Action Respond` are separate processes. The same applies on the client side: rosbridge never reports a goal's ROS UUID back, so a goal is identified only by the correlation id chosen on its websocket, and `Send Goal` / `Get Result` / `Cancel Goal` only work within the process that sent the goal. `Send Goal and Wait` is unaffected.
- **Message filter conditions**: the "Conditions" filter on `ROS2 Topic Trigger` and `ROS2 Topic Next Message` reference message fields by plain field path (e.g. `pose.position.x`), not n8n expressions, since the filter is evaluated against the message payload as it arrives rather than at parameter-resolution time.

## Compatibility

This package targets n8n nodes API v1 and uses rosbridge WebSocket endpoints. It works with ROS2 installations that expose a compatible `rosbridge_suite` endpoint.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [rosbridge_suite GitHub](https://github.com/RobotWebTools/rosbridge_suite)

## Version history

See [CHANGELOG.md](./CHANGELOG.md).
