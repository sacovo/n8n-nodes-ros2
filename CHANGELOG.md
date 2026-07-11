# Changelog

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
