#!/bin/bash
# Demonstrates the reverse direction: a plain ROS 2 client calling into n8n.
# The service and the action below are advertised by n8n workflows 04 and 05,
# not by the rover, but from ROS they look like any other interface.
#
# Run it inside the ros2 container:
#   docker compose exec ros2 /bin/bash /demo-scripts/call-n8n-from-ros.sh
# or, if you did not mount this folder, copy the commands out by hand.
set -e

source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash

echo "== interfaces n8n is providing =="
ros2 service list | grep '^/n8n/' || echo "(no n8n services found — is workflow 04 active?)"
ros2 action list | grep '^/n8n/' || echo "(no n8n actions found — is workflow 05 active?)"

echo
echo "== calling the n8n-provided service =="
ros2 service call /n8n/mission_report std_srvs/srv/Trigger

echo
echo "== sending a goal to the n8n-provided action (with live feedback) =="
ros2 action send_goal /n8n/inspect rover_interfaces/action/Inspect \
	"{target: 'solar panel', samples: 3}" --feedback
