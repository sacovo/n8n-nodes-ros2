# ROS2 Rosbridge integration for n8n

This package provides n8n nodes for interacting with ROS2 through a rosbridge WebSocket endpoint.

Supported capabilities:
- Subscribe to a ROS2 topic and trigger workflows on incoming messages
- Wait for the next message on a topic in any node
- Call a ROS2 service and wait for the response
- Start a ROS2 action goal without waiting for completion
- Check the status of a previously started ROS2 action goal

## Installation

1. Install this package into your n8n instance using npm or yarn.
2. Run `npm run build` in this repository to generate the `dist` output.
3. Start n8n with `npm run dev` to test the custom nodes locally.

## Nodes

- **ROS2 Topic Trigger** — trigger when a topic message is received.
- **ROS2 Topic Next Message** — wait for the next message on a topic and pass it downstream.
- **ROS2 Topic Publish** — publish a message to a ROS2 topic.
- **ROS2 Service Call** — make a ROS2 service request and return the response.
- **ROS2 Action Start** — send an action goal and return the goal ID immediately.
- **ROS2 Action Status** — query the status of an action goal by goal ID.

## Credentials

This integration uses the `ROS2 Rosbridge` credential type.

Required values:
- Protocol: `ws` or `wss`
- Host: rosbridge host
- Port: rosbridge port

Optional values:
- Path: path segment for the rosbridge endpoint
- Auth Token: token appended as query parameter for authentication
- Auth Query Parameter: parameter name used for the auth token
- Connect Timeout: connection timeout in milliseconds

## Usage

1. Create a new credential entry for your rosbridge endpoint.
2. Add one of the ROS2 nodes to your workflow.
3. Select the `ROS2 Rosbridge` credential.
4. Configure the topic, service, or action parameters.

### Example workflow

- `ROS2 Topic Trigger` receives topic messages and starts the workflow.
- `ROS2 Service Call` can be used in the same workflow to request ROS2 services.
- `ROS2 Action Start` starts a long-running action and returns `goalId`.
- `ROS2 Action Status` checks the action progress using the returned `goalId`.

## Compatibility

This package targets n8n nodes API v1 and uses rosbridge WebSocket endpoints. It works with ROS2 installations that expose a compatible `rosbridge_suite` endpoint.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [rosbridge_suite GitHub](https://github.com/RobotWebTools/rosbridge_suite)

## Version history

### 0.1.0
- Initial ROS2 rosbridge integration with topic triggers, topic reads, service calls, and action support.

