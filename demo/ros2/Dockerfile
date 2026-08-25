FROM ros:jazzy-ros-base

# ROS side: rosbridge + rosapi (discovery), turtlesim (the visible robot).
# Display side: Xvfb to give turtlesim a screen, x11vnc to export it and
# noVNC/websockify to serve that screen to a browser.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-jazzy-rosbridge-suite \
    ros-jazzy-turtlesim \
    ros-jazzy-geometry-msgs \
    python3-colcon-common-extensions \
    git \
    python3-pil \
    imagemagick \
    xvfb \
    x11-utils \
    x11vnc \
    novnc \
    websockify \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /ros2_ws

# Build rosbridge from the FHNW fork rather than using the stock Jazzy package,
# so the demo exercises the same rosbridge the real rover deployment runs. The
# fork carries the rosapi crash fixes this demo depends on:
#   - objectutils._type_name no longer asserts on non-message instances, which
#     stock rosapi does while expanding type_description_interfaces/srv/
#     GetTypeDescription — a built-in service on every node from Jazzy on.
#   - /rosapi/action_type uses rclpy.action instead of a ros2cli-only method.
#   - the parameter client cache no longer crashes the node.
# Each of those crashes rosapi_node outright, and because it spins bare that
# takes every in-flight /rosapi/* call down with it, which looks like a
# discovery bug in the n8n nodes when it is not.
# The apt package above stays installed: it pulls in the runtime dependencies
# (tornado, bson and friends). This workspace overlays it at runtime.
ARG ROSBRIDGE_REPO=https://github.com/sacovo/rosbridge_suite.git
ARG ROSBRIDGE_BRANCH=fhnw/rosapi-fixes
ARG ROSBRIDGE_COMMIT=0d0ef97
RUN git clone --branch ${ROSBRIDGE_BRANCH} ${ROSBRIDGE_REPO} src/rosbridge_suite \
 && git -C src/rosbridge_suite checkout ${ROSBRIDGE_COMMIT}

# Custom msg/srv/action types are what makes the ROS2 API node's recursive
# "Get Definition" worth demonstrating.
COPY rover_interfaces/ src/rover_interfaces/

# Only `rosapi` is taken from the fork. Its `rosbridge_library` targets a newer
# ROS 2 than Jazzy (it imports rosidl_pycommon.interface_base_classes, a module
# Jazzy does not ship), so the rest keeps coming from the apt package. The fork's
# rosapi only needs ROSMessage from rosbridge_library.internal.type_support,
# which Jazzy's copy does provide, so this overlay is enough to pick up the
# rosapi crash fixes.
# BUILD_TESTING=OFF: the test targets pull in ament_cmake_mypy, which the
# ros-base image does not have and which is not needed to run anything.
RUN . /opt/ros/jazzy/setup.sh \
 && colcon build --symlink-install --packages-select rover_interfaces rosapi rosbridge_test_msgs \
      --cmake-args -DBUILD_TESTING=OFF

COPY rover_node.py camera_node.py /app/
COPY entrypoint.sh /app/entrypoint.sh
COPY web/index.html /usr/share/novnc/index.html
RUN chmod +x /app/entrypoint.sh

ENV DISPLAY=:99
# turtlesim's window is a fixed 500x500 and there is no window manager to move
# or resize it, so matching the screen to it keeps the public view free of dead
# black margins.
ENV SCREEN_GEOMETRY=500x500x24

EXPOSE 9090 6080 8081

# websockify is the one process here reachable from the internet, and nothing in
# this container needs root or a privileged port.
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && chown -R ubuntu:ubuntu /ros2_ws /app
USER ubuntu

ENTRYPOINT ["/app/entrypoint.sh"]
