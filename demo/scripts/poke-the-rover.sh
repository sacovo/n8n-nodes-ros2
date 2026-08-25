#!/bin/bash
# Drives the rover straight from ROS, without n8n in the loop. Useful to prove
# the robot works before blaming a workflow.
#
#   docker compose exec ros2 /bin/bash /demo-scripts/poke-the-rover.sh
set -e

source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash

echo "== what the rover offers =="
ros2 node info /rover || true

echo
echo "== current status =="
timeout 5 ros2 topic echo /rover/status --once || echo "(no status yet)"

echo
echo "== set the LED to magenta =="
ros2 service call /rover/set_led rover_interfaces/srv/SetLed "{color: 'magenta', blink: false}"

echo
echo "== the places on the map =="
timeout 5 ros2 topic echo /rover/landmarks --once || echo "(no landmarks)"

echo
echo "== drive to the tree by name =="
ros2 action send_goal /rover/patrol rover_interfaces/action/Patrol \
	"{waypoint_names: [tree], loops: 1, dock_when_done: false}" --feedback

echo
echo "== or drive to raw coordinates =="
ros2 action send_goal /rover/navigate_to rover_interfaces/action/NavigateTo \
	"{target: {x: 9.0, y: 9.0, theta: 0.0}, tolerance: 0.3, max_speed: 1.8}" --feedback

echo
echo "== read the documentation a node published about its own battery topic =="
timeout 5 ros2 topic echo /rover/battery/desc --once || echo "(no description)"
