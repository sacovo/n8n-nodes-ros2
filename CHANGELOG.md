# Changelog

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
