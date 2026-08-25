#!/bin/bash
set -e

source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash

export DISPLAY="${DISPLAY:-:99}"
GEOMETRY="${SCREEN_GEOMETRY:-900x700x24}"

# A restarted container keeps its /tmp, and Xvfb refuses to start if the lock
# from the previous run is still there. Without this, one component dying turns
# a self-healing restart into a permanent restart loop.
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"

echo "[demo] starting virtual display ${DISPLAY} (${GEOMETRY})"
Xvfb "${DISPLAY}" -screen 0 "${GEOMETRY}" -nolisten tcp &

waited=0
until xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; do
    waited=$((waited + 1))
    if [ "$waited" -gt 100 ]; then
        echo "[demo] Xvfb did not come up within 20s" >&2
        exit 1
    fi
    sleep 0.2
done

echo "[demo] starting turtlesim"
ros2 run turtlesim turtlesim_node &

# -viewonly makes the export read-only in the VNC server itself: even a client
# that ignores noVNC's view_only flag cannot inject clicks or key presses.
echo "[demo] exporting display over VNC (read-only)"
x11vnc -display "${DISPLAY}" \
    -viewonly \
    -localhost \
    -forever \
    -shared \
    -nopw \
    -rfbport 5900 \
    -noxdamage \
    -quiet &

echo "[demo] serving noVNC on :6080"
websockify --web=/usr/share/novnc 6080 localhost:5900 &

# Use the launch file, not `ros2 run`: it sets call_services_in_new_thread and
# send_action_goals_in_new_thread to true, while the node's own defaults are
# false. With them false rosbridge serialises every service call, so the
# concurrent rosapi fan-out behind "Get Definition" times out and a long action
# goal stalls every other operation on the connection.
# respawn:=true restarts rosbridge or rosapi individually if either dies, which
# is finer-grained than letting the container supervisor bounce everything.
echo "[demo] starting rosbridge + rosapi on :9090"
# default_call_service_timeout is raised from the stock 5s because expanding a
# whole node fans out ~50 concurrent /rosapi/* calls and rosapi_node answers
# them on a single spin; at 5s the later ones come back as
# "Timeout exceeded while waiting for service response".
ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
    respawn:=true \
    default_call_service_timeout:=20.0 &

# Give turtlesim time to advertise its services before the rover node calls them.
sleep 5

# Dark map: turtlesim's default background is the same blue as one of the LED
# colours, which makes that trail invisible. A dark background also matches the
# public viewer page.
echo "[demo] theming the map"
for attempt in 1 2 3 4 5; do
    if ros2 param set /turtlesim background_r "${MAP_BG_R:-24}" >/dev/null 2>&1 \
        && ros2 param set /turtlesim background_g "${MAP_BG_G:-27}" >/dev/null 2>&1 \
        && ros2 param set /turtlesim background_b "${MAP_BG_B:-38}" >/dev/null 2>&1; then
        ros2 service call /clear std_srvs/srv/Empty >/dev/null 2>&1 || true
        break
    fi
    sleep 2
done

echo "[demo] starting screen camera node"
python3 /app/camera_node.py &

echo "[demo] starting rover node"
python3 /app/rover_node.py &

# Every piece above runs in the background, so without this the container would
# stay "up" with a dead viewer or a dead rosbridge and never be restarted.
wait -n || true
echo "[demo] a component exited, stopping the container so Docker restarts it" >&2
exit 1
