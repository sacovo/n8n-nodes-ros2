# Aggregate status of the demo rover, published at 2 Hz on /rover/status.
# Nests two other custom messages, so it is a good example for the
# "Get Definition" operation of the ROS2 API node.

# Current activity. One of:
#   IDLE        - powered on, not moving
#   NAVIGATING  - executing a /rover/navigate_to goal
#   PATROLLING  - executing a /rover/patrol goal
#   DOCKING     - driving back to the dock
#   DOCKED      - parked on the dock, charging
#   ESTOP       - emergency stop engaged, all motion refused
string state

# Where the rover currently is, in world coordinates.
geometry_msgs/Pose2D pose

# Current battery reading (same values as /rover/battery).
BatteryState battery

# Waypoint the rover is heading for. Empty name while idle.
Waypoint target

# Colour of the status LED as set through /rover/set_led.
string led_color

# Seconds since the rover node started.
float32 uptime_seconds
