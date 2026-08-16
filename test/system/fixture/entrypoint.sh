#!/usr/bin/env bash
# Runs rosbridge and the fixture node in one container, so they share a DDS
# domain over loopback instead of needing multicast across a docker network.
set -eo pipefail

# ROS's setup.bash reads unset variables, so it cannot run under `set -u`.
set +u
source "/opt/ros/${ROS_DISTRO}/setup.bash"
# Overlay carrying our rosapi/rosbridge_server fork build; sourced second so it
# shadows the apt packages, the same ordering ros-fhnw-rosbridge uses.
source /opt/rosbridge_overlay/setup.bash
set -u

# The nodes send goals concurrently, so keep rosbridge's default of handling
# each goal on its own thread. Stated explicitly because with it disabled a
# goal blocks the connection's whole message queue and cancels never arrive.
ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
    send_action_goals_in_new_thread:=true &
ROSBRIDGE_PID=$!

python3 /opt/fixture_node.py &
FIXTURE_PID=$!

# If either dies, take the container down so the test fails loudly rather than
# hanging against a half-running fixture.
trap 'kill -TERM ${ROSBRIDGE_PID} ${FIXTURE_PID} 2>/dev/null || true' TERM INT
wait -n ${ROSBRIDGE_PID} ${FIXTURE_PID}
exit $?
