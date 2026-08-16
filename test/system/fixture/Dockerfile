ARG ROS_DISTRO=jazzy
FROM ros:${ROS_DISTRO}-ros-core

ARG ROS_DISTRO
# Our rosbridge fork and the branch to build rosapi/rosbridge_server from.
# Keep in sync with the rosbridge_suite submodule in ros-fhnw-rosbridge.
ARG ROSBRIDGE_FORK=https://github.com/sacovo/rosbridge_suite.git
ARG ROSBRIDGE_REF=fhnw/rosapi-fixes

# rosbridge plus the interface packages the fixture uses. example_interfaces
# ships both AddTwoInts and Fibonacci, so the fixture needs no custom package.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rclpy \
    ros-${ROS_DISTRO}-rosbridge-suite \
    ros-${ROS_DISTRO}-example-interfaces \
    ros-${ROS_DISTRO}-sensor-msgs \
    ros-${ROS_DISTRO}-std-msgs \
    build-essential git \
    python3-colcon-common-extensions \
    ros-${ROS_DISTRO}-ament-cmake \
    ros-${ROS_DISTRO}-ament-cmake-python \
    ros-${ROS_DISTRO}-ament-cmake-ros \
    && rm -rf /var/lib/apt/lists/*

# rosapi and rosbridge_server come from our fork rather than the apt package,
# matching what ros-fhnw-rosbridge deploys - so these tests run against the same
# rosapi the rover does. The fork carries three rosapi fixes, each open as a PR
# upstream and each a crash: rosapi_node runs a bare rclpy.spin(), so one bad
# request takes every /rosapi/* service off the graph.
#   - objectutils: bounded string/sequence types (`string<255>`, `sequence<T,N>`).
#     Hit by type_description_interfaces/TypeDescription, which is reachable from
#     every node's ~/get_type_description service - so any node Get Definition.
#   - params:      cached param clients stamped with the wrong ClockType.
#   - proxy:       /rosapi/action_type resolved via a ros2cli-only method, which
#                  is what the action type picker depends on.
#
# Only these two packages are built; rosbridge_library and the interface packages
# are unchanged and resolve from apt, keeping rosidl generation out of the build.
# BUILD_TESTING=OFF because the test-only CMake deps are not installed here.
RUN git clone --depth 1 --branch "${ROSBRIDGE_REF}" "${ROSBRIDGE_FORK}" /opt/rosbridge_src && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    cd /opt/rosbridge_src && \
    colcon build --install-base /opt/rosbridge_overlay \
    --packages-select rosapi rosbridge_server \
    --packages-ignore rosbridge_library rosbridge_msgs rosapi_msgs rosbridge_test_msgs \
    --cmake-args -DBUILD_TESTING=OFF && \
    rm -rf /opt/rosbridge_src/build /opt/rosbridge_src/log

COPY fixture_node.py /opt/fixture_node.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /opt/fixture_node.py

EXPOSE 9090

ENTRYPOINT ["/entrypoint.sh"]
