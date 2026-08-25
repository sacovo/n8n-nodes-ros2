cmake_minimum_required(VERSION 3.8)
project(rover_interfaces)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(std_msgs REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/BatteryState.msg"
  "msg/RoverStatus.msg"
  "msg/Waypoint.msg"
  "srv/SetLed.srv"
  "action/NavigateTo.action"
  "action/Patrol.action"
  "action/Inspect.action"
  DEPENDENCIES geometry_msgs std_msgs
)

ament_package()
