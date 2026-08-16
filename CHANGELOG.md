# Changelog

## 0.7.0

### Changed

- **Breaking.** The seven action nodes are replaced by three. `ROS2 Action Start`, `Result`, `Status`, `Feedback` and `Cancel` are now one `ROS2 Action` node with a `Send Goal and Wait` / `Send Goal` / `Get Result` / `Cancel Goal` / `Watch Feedback` / `Watch Status` operation, and `ROS2 Action Send Feedback` becomes `ROS2 Action Respond` (gaining `Set Canceled`, and `Set Failed` in place of `Set Aborted`). `ROS2 Action Trigger` keeps its name. Existing workflows using the removed node types must be rebuilt; they could not have been working, see below.
- `ROS2 Action Respond` requires the ROS2 Rosbridge API credential. It still answers the client through the in-process goal registry rather than opening its own connection, but sending feedback or a final result is a write, and the credential is what decides whether writes are allowed. **Existing workflows using the node it replaces need a credential selected on it.**

### Fixed

- The action nodes could not drive a ROS 2 action server at all. They used roslib's `ActionClient`/`Goal`/`SimpleActionServer`, which are ROS 1 actionlib: they advertised `<server>/goal` with type `<Type>Goal` and subscribed `<server>/result|feedback|status` with `actionlib_msgs/GoalStatusArray`. An rclpy action server exposes `<name>/_action/send_goal|get_result|cancel_goal` services and `_action/feedback|status` topics instead — zero overlap, so goals landed nowhere and Action Result only ever timed out. Everything now goes through rosbridge's native action protocol (`send_action_goal` / `cancel_action_goal` / `action_feedback` / `action_result`) on the client side and `advertise_action` on the server side.

  Note this cannot be done with the `_action/*` services directly, which is the obvious-looking fix: rosbridge cannot reach them. They are hidden names, so `call_service`'s lookup through `get_service_names_and_types()` never finds them; and `ros_loader` resolves `pkg/action/X_SendGoal` as `getattr(pkg.action, 'X_SendGoal')`, which the generated `action/__init__.py` does not export (only `X_SendGoal_Request`/`_Response`/`_Event`). Only `_FeedbackMessage` is special-cased there, which is why the feedback and status topics do work.

- Action Status matched goals against `status_list[].goal_id.id`, the ROS 1 shape. ROS 2 nests it one level deeper as `status_list[].goal_info.goal_id.uuid`, and the id is a 16-byte UUID that rosbridge base64-encodes rather than a string, so the lookup never matched and every goal reported `UNKNOWN`. Goal ids are now decoded to canonical `8-4-4-4-12` hex, and the status labels are `action_msgs/msg/GoalStatus` (`ACCEPTED`/`EXECUTING`/`CANCELING`/`SUCCEEDED`/`CANCELED`/`ABORTED`) instead of the ROS 1 set (`PENDING`/`ACTIVE`/`PREEMPTED`/...).

- A goal that ends in any state other than SUCCEEDED is now reported as data, with its status code and label, rather than thrown. roslib's own `Action` class routes every non-SUCCEEDED result into its failure callback as a stringified error, which loses the distinction between a cancelled goal, an aborted one and a rejected one.

### Added

- Both credentials now have a "Read-Only" switch that restricts every node using them to observing the system. On the ROS2 Rosbridge API credential, subscribing to topics (Topic Trigger, Topic Next Message, Topic Capture Image), listing topics/services/actions/nodes/parameters and resolving their types and definitions, and observing a goal that is already running (`ROS2 Action`'s `Get Result`, `Watch Feedback` and `Watch Status`) keep working; publishing or advertising a topic, calling a service, sending or cancelling a goal, responding to one, advertising a service or action server, and setting a parameter fail with an error naming the refused operation. On the Docker API credential, `list` and `logs` keep working while `start`, `stop`, `restart` and `exec` fail. The check runs before the node connects, so a blocked operation never reaches the robot. Existing credentials have no such flag stored and stay writable. Like "Allowed Namespaces", this targets AI agent tooling: the switch lives on the credential, which an agent cannot choose or change, and the resulting error is returned as a tool observation the agent can react to.

- `ROS2 Action` gains `Send Goal and Wait`, which sends a goal and returns its result in one step — the common case for a robot task — optionally collecting every feedback message received while it ran.
- `ROS2 Action Trigger` can now emit client cancel requests (`Emit Cancel Requests`), so a workflow acting as an action server can react to them; the ROS 1 `SimpleActionServer` it used before had no cancel callback at all.
- Dockerised system tests (`npm run test:system`, see `test/system/README.md`): every ROS-facing node's real `execute()`/`trigger()` run against a live rosbridge and an `rclpy` fixture node providing a topic, a subscriber, a service and an action. The previous suite mocked the service layer wholesale, which is why the ROS 1 action protocol shipped with a fully green test run. The fixture builds `rosapi` from our rosbridge fork, matching what `ros-fhnw-rosbridge` deploys — stock jazzy rosapi crashes on three separate paths the nodes depend on, and since `rosapi_node` runs a bare `rclpy.spin()` each one takes every `/rosapi/*` service down with it.

### Known issues

- `ROS2 API → Node → Get Definition` always reports an empty `actions` list. Actions are detected from an `<action>/_action/send_goal` entry in the node's service list, but rosapi builds that from `get_service_names_and_types_by_node()`, which omits hidden names — and all `_action/*` names are hidden. `ROS2 API → Action → List` is unaffected. The system tests assert the current behaviour so it fails loudly if rosapi ever changes.
- `Send Goal` / `Get Result` / `Cancel Goal` only work within the n8n process that sent the goal. rosbridge never reports a goal's ROS UUID back to the client — a goal is identified only by the correlation id chosen for the `send_action_goal` op on that websocket — so there is nothing durable to key a lookup on. `Send Goal and Wait` is unaffected.
- These operations also need rosbridge's `send_action_goals_in_new_thread` (the stock `rosbridge_websocket_launch.xml` defaults it to true). With it disabled, a goal blocks its connection's whole message queue, so cancels are never dispatched and every other node sharing the pooled connection stalls until the goal finishes.

## 0.6.0

### Fixed

- The "Action Type" picker (Action Start/Result/Feedback/Cancel) no longer comes back empty in "Detected" mode, and the ROS2 API node's action definitions resolve their type again. The type was derived from the `<action>/_action/send_goal` service via rosapi's `service_type`, but that lookup only searches *non-hidden* services and `_action/*` services are hidden, so it always answered with an empty type — silently, which is why nothing showed up in the n8n or rosbridge logs. The type now comes from `/rosapi/action_type`, with the old derivation kept as a fallback for rosbridge builds that lack that service.

### Added

- ROS2 Topic Publish can now be restricted to one or more namespaces via an "Allowed Namespaces" option (comma- or newline-separated, e.g. `/mani, /any-safe-system`). Publishing or advertising a topic outside them fails with an error naming the attempted topic and the allowed namespaces, and the topic picker only lists in-scope topics. Matching is on name segments, so `/mani` covers `/mani/cmd_vel` but not `/manipulator`; a `*` segment matches any single segment (e.g. `/robot/*/cmd_vel`). This is aimed at AI agent tooling: the agent chooses the topic name, but cannot change the restriction, since agents only fill parameters the workflow author exposes via `$fromAI`. Leaving the option empty keeps the previous unrestricted behaviour. Note that n8n resolves a tool's description from the static node type or the raw "Description" field before parameters are evaluated, so the configured namespaces cannot be injected into it automatically; the agent learns them from the error, or from a manually written tool description.

## 0.5.0

### Added

- ROS2 Topic Capture Image can now optionally resize the captured image before output. Enabling "Resize Image" downscales it to fit within a configurable Max Width/Max Height (aspect ratio preserved, never enlarged) with an adjustable JPEG/WebP quality, which cuts the image size and the token cost when the image is fed to a vision language model. Resizing re-encodes via sharp, so formats sharp cannot output (e.g. BMP/GIF) are normalized to JPEG, and the output dimensions are reported on the JSON output.

## 0.4.0

### Fixed

- Resource mapper ("Fixed" input mode) fields are now parsed into the type each ROS message expects before publishing. Manually entered values were stored as raw strings, so a nested/array field like `data` on `std_msgs/Float64MultiArray` was sent as the literal string `"[0.5, 0.5]"` instead of an array (previously this required an expression such as `{{ [0.5, 0.5] }}`). Numbers, booleans, arrays and objects are now parsed from their entered strings using the mapper schema; if a value cannot be parsed into the expected type, the node errors and the message is not sent. Applies to Topic Publish, Service Call and Action Start.
- Payloads are now validated against the real message type before sending (both "Raw (JSON)" and "Fixed (Mapper)" input modes). At execution the node fetches the expanded type definition via rosapi and recursively checks the whole payload: numeric/boolean strings are coerced, JSON strings are parsed into the arrays/objects the type expects, and unknown fields or values that cannot be coerced abort the send with an error naming the offending path (e.g. `layout.dim[0].size`) and the expected structure. If the type cannot be introspected, validation is skipped and the payload is sent as before. Applies to Topic Publish, Service Call and Action Start. Previously raw JSON was only checked for being valid JSON, not against the message type.
- rosapi Get Definition for services and actions now actually returns the expanded structure. rosapi names service/action sub-definitions after their generated classes (e.g. `rcl_interfaces/GetParameters_Request` for `rcl_interfaces/srv/GetParameters`), so the previous exact-name root lookup found nothing and silently returned the bare type name string instead of the request/response (or goal/result/feedback) structure. The same fix applies to Node Get Definition, so AI agents and workflows can now discover service and action payload shapes the same way the editor's resource mapper does.

### Added

- The "Fixed (Mapper)" input mode (Topic Publish, Service Call, Action Start) now pre-populates the mapper with every field of the selected message/service/action type (`addAllFields: true`), so the whole structure appears as an editable form without adding fields one by one. A hint under the raw JSON box points users to this mode.
- Resource mapper fields now show their ROS type — and, for nested messages, the sub-field names — in the field label (e.g. `data (float64[])`, `layout (std_msgs/MultiArrayLayout) {dim, data_offset}`). n8n's resource mapper has no per-field description/hint slot below the input, so the label is the only place the structure can be surfaced inline.
- rosapi Action resource now has a Get Type operation: resolves the action type of a running action server by name, with the same optional Include Description (`<name>/desc`) documentation lookup that topics and services have.

### Changed

- All non-trigger nodes now return errors as `{ "error": "..." }` output instead of throwing when invoked as AI agent tools. A failing tool call becomes an observation the agent can read and react to; previously the thrown error aborted the entire agent run. Tool execution is detected via n8n's `isToolExecution()` (legacy direct-invocation path) plus the `ai_tool` output of the generated `*Tool` node variant — the latter is required because newer n8n runs agent tool calls through the regular workflow engine, where `isToolExecution()` always reports false. Regular workflow executions are unchanged: errors still fail the node unless On Error is set to continue.

## 0.3.0

### Added

- rosapi Get Type can now return interface documentation: an "Include Description" option reads the latched `<name>/desc` topic (new documentation convention, see README), and an "Include Raw Definition" option returns the raw .msg definition text with its comments (units, enum values).

## 0.2.1

### Fixed

- Workflows exported before 0.2.0 with Conditions containing n8n expressions (e.g. `={{ $json.message.data }}`) no longer fail at execution: expression-style left values are converted to the message field path they reference, and expression right values are evaluated safely.

## 0.2.0

### Added

- ROS2 API node can now return the full topic/service/action structure of a node via Get Definition, with custom message types expanded.
- Option to combine topic list output into name/type pairs.
- Working credential Test buttons for the rosbridge and Docker credentials.
- Trigger nodes (ROS2 Topic/Service/Action Trigger) now automatically reconnect their subscriptions when the rosbridge connection drops.
- Canvas subtitles on all nodes.
- AI-agent-oriented tool descriptions so nodes read better when used as AI tools.

### Changed

- Resource mapper fields now show expanded nested type structures for message, service, and action definitions.
- Payload JSON field descriptions now point at the rosapi Get Definition operation.
- Consolidated the legacy RosBridgeClient into the shared service classes (internal refactor).
- **Breaking:** topic messages no longer include a duplicate `rawMessage` field alongside `message`; update workflows that read `rawMessage`.

### Fixed

- Conditions filter on ROS2 Topic Trigger and ROS2 Topic Next Message now actually filters incoming messages.
- ROS2 Topic Trigger no longer fails on activation when the topic is picked from the list, and ROS2 Topic Next Message reads its parameters per item.
- rosapi topic Get Details now resolves the message type before fetching its typedefs.
- Duplicate resource locator mode name in ROS2 Action Status.
- Removed the broken Fixed (Mapper) payload mode from ROS2 Action Send Feedback.
- Hardened rosbridge connection pooling against concurrent connect races, closing abandoned handshake sockets instead of leaking them.
- Goal registry entries are now purged when an action trigger tears down or reconnects, preventing stale goal state.

## 0.1.0

- Initial ROS2 integration via rosbridge credentials.
- Added ROS2 Topic Trigger node.
- Added ROS2 Topic Next Message node.
- Added ROS2 Service Call node.
- Added ROS2 Action Start node.
- Added ROS2 Action Status node.
- Added shared ROS helper module for connection, service, topic, and action helpers.
