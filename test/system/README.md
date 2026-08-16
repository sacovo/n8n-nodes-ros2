# System tests

End-to-end tests that run every ROS-facing node's real `execute()` / `trigger()`
against a live rosbridge and a real ROS 2 node, both in docker.

```bash
npm run test:system                      # build if needed, run everything, tear down
./test/system/run.sh -t 'Action'         # extra args go to jest
KEEP_UP=1 npm run test:system            # leave the container up for poking at
```

`npm test` does **not** include these — `jest.config.js` ignores this directory
and the suite has its own `jest.system.config.js`.

## Why these exist

The unit tests mock the service layer, so they assert that a node called
`RosBridgeService.startAction(...)`, not what went over the websocket. That is
how the action nodes shipped speaking **ROS 1 actionlib** to a ROS 2 graph —
publishing `<server>/goal` and subscribing `actionlib_msgs/GoalStatusArray` —
with a fully green test suite. Everything asserted here has actually crossed the
wire to a real `rclpy` node.

## What's in the container

One container runs rosbridge and the fixture together, so they share a DDS
domain over loopback rather than needing multicast across a docker network.

`fixture/fixture_node.py` provides one of everything, using only interfaces that
ship with a stock ROS 2 install (so there is no custom message package to build):

| Interface           | Type                          | Purpose                                  |
| ------------------- | ----------------------------- | ---------------------------------------- |
| `/chatter`          | `std_msgs/String`             | publisher, 5 Hz                          |
| `/chatter/desc`     | `std_msgs/String`             | latched, the rover's `<name>/desc` convention |
| `/camera/image_raw` | `sensor_msgs/CompressedImage` | publisher, 2 Hz, a real 1×1 JPEG         |
| `/commands`         | `std_msgs/String`             | subscriber, echoes to `/command_echo`    |
| `/add_two_ints`     | `example_interfaces/AddTwoInts` | service                                |
| `/fibonacci`        | `example_interfaces/Fibonacci` | action, with feedback and cancel        |

The fixture can also act as a **client**, which is how the trigger nodes get
exercised: they advertise a service or action *from n8n*, and something on the
ROS side has to call it. Publish to `/test/command` and the outcome comes back
on `/test/result`:

- `call_service:<name>` — calls `<name>` (AddTwoInts) with `a=2 b=3`
- `send_goal:<name>:<order>` — sends a Fibonacci goal to `<name>`

## rosapi comes from our fork

`fixture/Dockerfile` builds `rosapi` and `rosbridge_server` from
[sacovo/rosbridge_suite](https://github.com/sacovo/rosbridge_suite), branch
`fhnw/rosapi-fixes`, and overlays them on the apt install — the same arrangement
`ros-fhnw-rosbridge` deploys, so these tests exercise the rosapi the rover runs.
**Keep the branch in sync with the `rosbridge_suite` submodule in that repo.**

The fork carries three rosapi fixes, each open as a PR upstream. Every one is a
crash, and `rosapi_node` runs a bare `rclpy.spin()`, so a single bad request
takes every `/rosapi/*` service off the graph — and every node's type picker
with it:

1. `objectutils.py` — bounded types (`string<255>`, `sequence<T, N>`) are not
   normalised, so `_type_name` gets an unresolvable name and trips its
   `assert isinstance(instance, ROSMessage)`. Reachable from **any** node's Get
   Definition, via `type_description_interfaces/TypeDescription` behind every
   node's `~/get_type_description` service.
2. `params.py` — `_CachedClient` starts with a `SYSTEM_TIME` `Time()` that
   `_cleanup_timer_callback` subtracts from a `ROS_TIME` clock.
3. `proxy.py` — `/rosapi/action_type` calls `ros2action.api`'s
   `get_action_names_and_types()`, which only exists on ros2cli's `DirectNode`.

Only those two packages are built; `rosbridge_library` and the interface
packages are unchanged and resolve from apt, which keeps rosidl generation out
of the image build.

## Known limitation asserted by the suite

`ROS2 API → Node → Get Definition` always reports an empty `actions` list.
It finds a node's actions by looking for `<action>/_action/send_goal` in the
node's service list, but rosapi builds that from
`get_service_names_and_types_by_node()`, which omits *hidden* names — and every
`_action/*` service and topic is hidden. The global action list
(`ROS2 API → Action → List`) is unaffected. The test asserts the empty list on
purpose, so it fails loudly if rosapi ever starts reporting them.
