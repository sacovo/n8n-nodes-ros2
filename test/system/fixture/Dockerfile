ARG ROS_DISTRO=jazzy
FROM ros:${ROS_DISTRO}-ros-core

ARG ROS_DISTRO
# Our rosbridge fork and the commit to build rosapi/rosbridge_server from.
# A SHA rather than a branch on purpose: docker caches the fetch layer, so a
# branch name would keep resolving to whatever was cloned the first time and the
# tests would silently go on running old rosapi. Bumping this invalidates the
# layer. Keep it equal to the rosbridge_suite submodule in ros-fhnw-rosbridge -
# fhnw/rosapi-fixes, which is upstream ros2 plus the not-yet-merged rosapi fixes.
ARG ROSBRIDGE_FORK=https://github.com/sacovo/rosbridge_suite.git
ARG ROSBRIDGE_REF=0d0ef9715cb68ef7f7b85bc5d77320b189f42374

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
#
# Only these two packages are built; rosbridge_library and the interface packages
# are unchanged and resolve from apt, keeping rosidl generation out of the build.
# BUILD_TESTING=OFF because the test-only CMake deps are not installed here.
RUN git init -q /opt/rosbridge_src && \
  cd /opt/rosbridge_src && \
  git remote add origin "${ROSBRIDGE_FORK}" && \
  git fetch -q --depth 1 origin "${ROSBRIDGE_REF}" && \
  git checkout -q FETCH_HEAD && \
  . /opt/ros/${ROS_DISTRO}/setup.sh && \
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
