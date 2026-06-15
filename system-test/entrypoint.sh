#!/bin/bash
set -e

# Source ROS2 setup
source /opt/ros/jazzy/setup.bash

# Start rosbridge server in background
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &

# Wait for rosbridge to startup
sleep 3

# Run the stress test node in foreground
python3 nodes_stress_test.py
