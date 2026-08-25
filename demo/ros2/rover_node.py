#!/usr/bin/env python3
"""Simulated rover for the n8n demo.

Wraps turtlesim in a rover-shaped interface: named waypoints, a battery that
drains while driving, a dock, an emergency stop, plus the services and actions
an n8n workflow is meant to call. Everything it does is visible in the turtlesim
window, which the demo exports to the browser through noVNC.
"""

import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import rclpy
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile

from geometry_msgs.msg import Pose2D, Twist
from std_msgs.msg import String
from std_srvs.srv import Empty, SetBool, Trigger
from turtlesim.msg import Pose as TurtlePose
from turtlesim.srv import Kill, SetPen, Spawn, TeleportAbsolute

from rover_interfaces.action import NavigateTo, Patrol
from rover_interfaces.msg import BatteryState, RoverStatus, Waypoint
from rover_interfaces.srv import SetLed

def _ellipse(cx, cy, rx, ry, segments=16):
    points = [
        (cx + rx * math.cos(2 * math.pi * i / segments),
         cy + ry * math.sin(2 * math.pi * i / segments))
        for i in range(segments)
    ]
    points.append(points[0])
    return points


# Places on the map. The named ones have a drawn landmark; the compass points
# are plain waypoints kept for patrols that just want to sweep the area.
WAYPOINTS = {
    'lake': (2.6, 8.5),
    'tree': (8.5, 8.6),
    'house': (8.6, 2.6),
    'mountain': (2.5, 3.4),
    'dock': (5.55, 1.25),
    'center': (5.544, 5.544),
    'nw': (2.0, 9.6),
    'ne': (9.6, 9.6),
    'sw': (1.4, 1.4),
    'se': (9.6, 1.4),
}

# Places that are drawn on the map, in the order a form should offer them.
LANDMARKS = ['lake', 'tree', 'house', 'mountain', 'dock', 'center']

DEFAULT_PATROL = ['lake', 'tree', 'house', 'mountain']

# The map itself, drawn by teleporting the rover with its pen down: each entry
# is a pen colour and a list of polylines. turtlesim cannot render images, but a
# teleport with the pen down draws an instant straight line, so the whole map
# appears in about a second at startup.
MAP_ART = [
    # Lake: an irregular pool with a ripple through it.
    ((70, 130, 255), [
        _ellipse(2.6, 8.5, 1.5, 0.95),
        [(1.7, 8.4), (2.2, 8.6), (2.7, 8.4), (3.2, 8.6)],
    ]),
    # Tree: a trunk under two stacked canopies.
    ((70, 200, 95), [
        [(8.5, 7.5), (8.5, 8.3)],
        [(7.6, 8.3), (8.5, 9.3), (9.4, 8.3), (7.6, 8.3)],
        [(7.9, 8.9), (8.5, 9.9), (9.1, 8.9), (7.9, 8.9)],
    ]),
    # House: walls, a roof and a door.
    ((235, 150, 70), [
        [(7.9, 1.9), (9.3, 1.9), (9.3, 2.9), (7.9, 2.9), (7.9, 1.9)],
        [(7.6, 2.9), (8.6, 3.8), (9.6, 2.9)],
        [(8.4, 1.9), (8.4, 2.45), (8.85, 2.45), (8.85, 1.9)],
    ]),
    # Mountain: a peak with a jagged snow line. The snow line has to zigzag
    # through the interior; a straight one would land on the outline and vanish.
    ((155, 160, 175), [
        [(1.1, 2.2), (2.5, 4.6), (3.9, 2.2), (1.1, 2.2)],
        [(2.0, 3.75), (2.22, 3.45), (2.5, 3.85), (2.78, 3.45), (3.0, 3.75)],
    ]),
    # Dock: a charging pad with a lightning bolt.
    ((240, 205, 60), [
        [(4.75, 0.85), (6.35, 0.85), (6.35, 1.65), (4.75, 1.65), (4.75, 0.85)],
        [(5.75, 1.5), (5.35, 1.2), (5.7, 1.2), (5.3, 0.95)],
    ]),
]

LED_COLORS = {
    'red': (255, 0, 0),
    'green': (0, 255, 0),
    'blue': (60, 90, 255),
    'yellow': (255, 220, 0),
    'magenta': (255, 0, 255),
    'cyan': (0, 220, 220),
    'white': (255, 255, 255),
    'off': (0, 0, 0),
}

# Battery model
DRAIN_PER_SECOND = 0.9      # percent per second while driving
IDLE_DRAIN_PER_SECOND = 0.05
CHARGE_PER_SECOND = 6.0
DOCK_ARRIVAL_TOLERANCE = 0.4

CONTROL_HZ = 20.0
FEEDBACK_HZ = 5.0

# Small read-only JSON endpoint for the public viewer page. Served from this
# container rather than through n8n so the readout survives the hourly reset,
# which restarts n8n.
STATUS_PORT = int(os.environ.get('STATUS_PORT', '8081'))

# Name of the temporary turtle that draws the map.
CARTOGRAPHER = 'cartographer'


def normalize_angle(angle):
    return math.atan2(math.sin(angle), math.cos(angle))


class StatusHandler(BaseHTTPRequestHandler):
    """Serves the rover's live state to the viewer page. Read-only, no writes."""

    node = None

    def do_GET(self):  # noqa: N802 - name fixed by BaseHTTPRequestHandler
        if self.path.split('?')[0].rstrip('/') not in ('/api/status', '/api'):
            self.send_error(404)
            return
        payload = json.dumps(self.node.status_snapshot()).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        # The viewer is same-origin behind Caddy, but a local run serves the
        # page from the noVNC port instead, which makes this cross-origin.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        """Silence per-request logging; the viewer polls every couple of seconds."""


class RoverNode(Node):
    def __init__(self):
        super().__init__('rover')
        self.cb = ReentrantCallbackGroup()

        self.started_at = time.time()
        self.pose = None
        self.state = 'IDLE'
        self.led_color = 'green'
        self.led_blink = False
        self.battery = 100.0
        self.charging = False
        self.estopped = False
        self.target_waypoint = ''
        self.busy = False           # an action goal is currently executing
        self.drawing = False        # the map is being drawn, refuse goals
        self._cartographer_alive = False
        self.cancel_drive = False   # set by e-stop to break out of a drive loop
        self.last_tick = time.time()

        # --- turtlesim plumbing -------------------------------------------
        self.cmd_pub = self.create_publisher(Twist, '/turtle1/cmd_vel', 10)
        self.create_subscription(
            TurtlePose, '/turtle1/pose', self._on_pose, 10, callback_group=self.cb
        )
        self.set_pen = self.create_client(
            SetPen, '/turtle1/set_pen', callback_group=self.cb
        )
        self.teleport = self.create_client(
            TeleportAbsolute, '/turtle1/teleport_absolute', callback_group=self.cb
        )
        self.clear_screen = self.create_client(
            Empty, '/clear', callback_group=self.cb
        )
        self.spawn_turtle = self.create_client(
            Spawn, '/spawn', callback_group=self.cb
        )
        self.kill_turtle = self.create_client(
            Kill, '/kill', callback_group=self.cb
        )

        # --- published state ----------------------------------------------
        self.status_pub = self.create_publisher(RoverStatus, '/rover/status', 10)
        self.battery_pub = self.create_publisher(BatteryState, '/rover/battery', 10)
        self.events_pub = self.create_publisher(String, '/rover/events', 10)

        # Workflows publish here; logging them gives the n8n -> ROS direction a
        # visible effect in `docker compose logs ros2`.
        self.create_subscription(
            String, '/rover/notifications', self._on_notification, 10,
            callback_group=self.cb,
        )

        self.create_timer(1.0 / CONTROL_HZ, self._tick, callback_group=self.cb)
        self.create_timer(0.5, self._publish_status, callback_group=self.cb)
        self.create_timer(1.0, self._publish_battery, callback_group=self.cb)

        # --- services -------------------------------------------------------
        self.create_service(
            SetLed, '/rover/set_led', self._on_set_led, callback_group=self.cb
        )
        self.create_service(
            Trigger, '/rover/dock', self._on_dock, callback_group=self.cb
        )
        self.create_service(
            SetBool, '/rover/emergency_stop', self._on_estop, callback_group=self.cb
        )
        self.create_service(
            Trigger, '/rover/reset_battery', self._on_reset_battery, callback_group=self.cb
        )
        self.create_service(
            Trigger, '/rover/reset_demo', self._on_reset_demo, callback_group=self.cb
        )

        # --- actions --------------------------------------------------------
        self.navigate_server = ActionServer(
            self,
            NavigateTo,
            '/rover/navigate_to',
            execute_callback=self._execute_navigate,
            goal_callback=self._accept_goal,
            cancel_callback=lambda _goal: CancelResponse.ACCEPT,
            callback_group=self.cb,
        )
        self.patrol_server = ActionServer(
            self,
            Patrol,
            '/rover/patrol',
            execute_callback=self._execute_patrol,
            goal_callback=self._accept_goal,
            cancel_callback=lambda _goal: CancelResponse.ACCEPT,
            callback_group=self.cb,
        )

        self._publish_descriptions()
        self._publish_landmarks()
        self._start_status_server()

        # Drawing needs the executor spinning to resolve service futures, so it
        # cannot happen here; a one-shot timer runs it once turtlesim is ready.
        self._draw_timer = self.create_timer(
            3.0, self._draw_map_once, callback_group=self.cb
        )
        self.get_logger().info('rover ready: places %s' % ', '.join(WAYPOINTS))

    # ------------------------------------------------------------------
    # Documentation convention: latched std_msgs/String on <interface>/desc.
    # The ROS2 API node reads these with "Include Description".
    # ------------------------------------------------------------------
    def _publish_descriptions(self):
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self._desc_pubs = []
        descriptions = {
            '/rover/status/desc':
                'Aggregate rover status at 2 Hz: state machine, pose, battery, '
                'current target waypoint and LED colour.',
            '/rover/battery/desc':
                'Battery level at 1 Hz. Drains about 0.9 %/s while driving and '
                'recharges at 6 %/s on the dock. Trigger workflows below 25 %.',
            '/rover/events/desc':
                'JSON events as they happen: arrived, patrol_complete, '
                'battery_low, estop, docked. Each message is one JSON object '
                'with an "event" key.',
            '/rover/notifications/desc':
                'Free-text channel for workflows to announce what they did. '
                'The rover logs whatever arrives here. Publish a '
                'std_msgs/String to it.',
            '/rover/set_led/desc':
                'Sets the status LED and the colour of the trail the rover '
                'draws. Colours: red, green, blue, yellow, magenta, cyan, '
                'white, off.',
            '/rover/dock/desc':
                'Drives the rover back to the charging pad at the bottom of '
                'the map and starts charging, preempting any running mission.',
            '/rover/reset_demo/desc':
                'Housekeeping: refills the battery, releases the e-stop, wipes '
                'the drawn trail and teleports the rover back to the centre. '
                'Called hourly by the demo reset workflow.',
            '/rover/emergency_stop/desc':
                'data=true engages the e-stop, cancels any running goal and '
                'refuses new ones. data=false releases it.',
            '/rover/navigate_to/desc':
                'Drives to one point on the map with live distance feedback. '
                'The map is 0-11.08 on both axes; the rover starts at 5.5, 5.5.',
            '/rover/patrol/desc':
                'Visits a list of named places in order, optionally looping, '
                'with per-waypoint feedback. Drawn landmarks: lake, tree, '
                'house, mountain, dock, center. Plain waypoints: nw, ne, sw, '
                'se. An empty list visits every landmark. Use this with a '
                'single name to send the rover to one place.',
            '/rover/landmarks/desc':
                'Latched JSON list of the places on the map and their '
                'coordinates. Read this to offer a user or an agent a list of '
                'destinations without hardcoding one.',
        }
        for topic, text in descriptions.items():
            pub = self.create_publisher(String, topic, latched)
            pub.publish(String(data=text))
            self._desc_pubs.append(pub)

    def status_snapshot(self):
        """Plain dict for the viewer page. Safe to call from another thread."""
        pose = self.pose
        return {
            'state': self.state,
            'battery': round(self.battery, 1),
            'charging': bool(self.charging and self._at_dock()),
            'estopped': self.estopped,
            'led': self.led_color,
            'led_blink': self.led_blink,
            'target': self.target_waypoint,
            'pose': {
                'x': round(float(pose.x), 2) if pose else None,
                'y': round(float(pose.y), 2) if pose else None,
            },
            'uptime_seconds': round(time.time() - self.started_at, 1),
            'low_battery_threshold': 25.0,
        }

    def _start_status_server(self):
        handler = type('BoundStatusHandler', (StatusHandler,), {'node': self})
        self._status_server = ThreadingHTTPServer(('0.0.0.0', STATUS_PORT), handler)
        self._status_server.daemon_threads = True
        threading.Thread(
            target=self._status_server.serve_forever, daemon=True,
        ).start()
        self.get_logger().info('status endpoint on :%d/api/status' % STATUS_PORT)

    def _publish_landmarks(self):
        """Latched list of places, so a caller can offer them without guessing."""
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self._landmark_pub = self.create_publisher(String, '/rover/landmarks', latched)
        self._landmark_pub.publish(String(data=json.dumps({
            'landmarks': [
                {'name': name, 'x': WAYPOINTS[name][0], 'y': WAYPOINTS[name][1]}
                for name in LANDMARKS
            ],
            'all_waypoints': sorted(WAYPOINTS),
        })))

    # ------------------------------------------------------------------
    # State plumbing
    # ------------------------------------------------------------------
    def _on_pose(self, msg):
        self.pose = msg

    def _on_notification(self, msg):
        self.get_logger().info('notification from n8n: %s' % msg.data)

    def _emit(self, event, **fields):
        payload = {'event': event, 'timestamp': time.time()}
        payload.update(fields)
        self.events_pub.publish(String(data=json.dumps(payload)))
        self.get_logger().info('event: %s' % json.dumps(payload))

    def _at_dock(self):
        if self.pose is None:
            return False
        dx = self.pose.x - WAYPOINTS['dock'][0]
        dy = self.pose.y - WAYPOINTS['dock'][1]
        return math.hypot(dx, dy) <= DOCK_ARRIVAL_TOLERANCE

    def _tick(self):
        """Battery model. Runs whether or not a goal is active."""
        now = time.time()
        dt = now - self.last_tick
        self.last_tick = now
        if dt <= 0 or dt > 1.0:
            return

        was_low = self.battery < 25.0
        moving = self.busy and not self.estopped

        if self.charging and self._at_dock():
            self.battery = min(100.0, self.battery + CHARGE_PER_SECOND * dt)
        elif moving:
            self.battery = max(0.0, self.battery - DRAIN_PER_SECOND * dt)
        else:
            self.battery = max(0.0, self.battery - IDLE_DRAIN_PER_SECOND * dt)

        if not was_low and self.battery < 25.0:
            self._emit('battery_low', percentage=round(self.battery, 1))
        if self.battery <= 0.0 and self.busy:
            self.cancel_drive = True

    def _battery_msg(self):
        msg = BatteryState()
        msg.percentage = float(self.battery)
        msg.voltage = float(19.4 + (self.battery / 100.0) * 3.4)
        msg.charging = bool(self.charging and self._at_dock())
        msg.seconds_remaining = -1.0 if msg.charging else float(
            self.battery / DRAIN_PER_SECOND
        )
        return msg

    def _publish_battery(self):
        self.battery_pub.publish(self._battery_msg())

    def _publish_status(self):
        msg = RoverStatus()
        msg.state = self.state
        msg.pose = Pose2D()
        if self.pose is not None:
            msg.pose.x = float(self.pose.x)
            msg.pose.y = float(self.pose.y)
            msg.pose.theta = float(self.pose.theta)
        msg.battery = self._battery_msg()
        msg.target = Waypoint()
        msg.target.name = self.target_waypoint
        msg.target.position = Pose2D()
        if self.target_waypoint in WAYPOINTS:
            x, y = WAYPOINTS[self.target_waypoint]
            msg.target.position.x = x
            msg.target.position.y = y
        msg.led_color = self.led_color
        msg.uptime_seconds = float(time.time() - self.started_at)
        self.status_pub.publish(msg)

    def _stop_motion(self):
        self.cmd_pub.publish(Twist())

    # ------------------------------------------------------------------
    # Drawing the map
    # ------------------------------------------------------------------
    def _call_and_wait(self, client, request, timeout=3.0):
        """Blocking service call. Safe here: reentrant group, multiple threads."""
        if not client.service_is_ready() and not client.wait_for_service(timeout_sec=timeout):
            return None
        future = client.call_async(request)
        deadline = time.time() + timeout
        while not future.done() and time.time() < deadline:
            time.sleep(0.01)
        return future.result() if future.done() else None

    def _pen(self, client, r=0, g=0, b=0, width=3, off=0):
        request = SetPen.Request()
        request.r, request.g, request.b = int(r), int(g), int(b)
        request.width = int(width)
        request.off = int(off)
        self._call_and_wait(client, request)

    def _teleport(self, client, x, y):
        request = TeleportAbsolute.Request()
        request.x, request.y, request.theta = float(x), float(y), 0.0
        self._call_and_wait(client, request)

    def _draw_map(self):
        """Redraw every landmark using a throwaway turtle.

        The drawing is done by teleporting, and teleporting the rover itself
        would look exactly like the robot glitching across the screen — which
        matters because this runs again after every reset. So a second turtle is
        spawned to do it and killed afterwards; the lines it drew stay behind.
        """
        self.drawing = True
        started = time.time()
        pen = teleport = None
        try:
            if self._cartographer_alive:
                # A previous draw died before cleaning up after itself.
                self._call_and_wait(
                    self.kill_turtle, Kill.Request(name=CARTOGRAPHER), timeout=1.0,
                )
                self._cartographer_alive = False

            first_shape = MAP_ART[0][1][0]
            spawn = Spawn.Request()
            spawn.x, spawn.y = float(first_shape[0][0]), float(first_shape[0][1])
            spawn.theta = 0.0
            spawn.name = CARTOGRAPHER
            if self._call_and_wait(self.spawn_turtle, spawn) is None:
                self.get_logger().warn('could not spawn the map drawer, skipping the map')
                return
            self._cartographer_alive = True

            pen = self.create_client(
                SetPen, '/%s/set_pen' % CARTOGRAPHER, callback_group=self.cb,
            )
            teleport = self.create_client(
                TeleportAbsolute, '/%s/teleport_absolute' % CARTOGRAPHER,
                callback_group=self.cb,
            )

            for colour, shapes in MAP_ART:
                for points in shapes:
                    self._pen(pen, off=1)
                    self._teleport(teleport, *points[0])
                    self._pen(pen, *colour, width=3, off=0)
                    for point in points[1:]:
                        self._teleport(teleport, *point)

            self._call_and_wait(self.kill_turtle, Kill.Request(name=CARTOGRAPHER))
            self._cartographer_alive = False
        finally:
            for client in (pen, teleport):
                if client is not None:
                    self.destroy_client(client)
            self.drawing = False

        self.get_logger().info(
            'map drawn in %.1fs: %s' % (time.time() - started, ', '.join(LANDMARKS))
        )

    def _draw_map_once(self):
        """One-shot startup draw; the timer cancels itself after the first run."""
        if self._draw_timer is not None:
            self._draw_timer.cancel()
            self._draw_timer = None
        self._draw_map()

    def _set_pen_color(self, color):
        r, g, b = LED_COLORS.get(color, LED_COLORS['green'])
        req = SetPen.Request()
        req.r, req.g, req.b = r, g, b
        req.width = 3
        req.off = 1 if color == 'off' else 0
        if self.set_pen.service_is_ready():
            self.set_pen.call_async(req)

    # ------------------------------------------------------------------
    # Services
    # ------------------------------------------------------------------
    def _on_set_led(self, request, response):
        color = (request.color or '').strip().lower()
        if color not in LED_COLORS:
            response.success = False
            response.message = 'unknown colour %r, expected one of: %s' % (
                request.color, ', '.join(sorted(LED_COLORS)),
            )
            return response
        self.led_color = color
        self.led_blink = bool(request.blink)
        self._set_pen_color(color)
        response.success = True
        response.message = 'LED set to %s%s' % (
            color, ' (blinking)' if self.led_blink else '',
        )
        self._emit('led_changed', color=color, blink=self.led_blink)
        return response

    def _on_dock(self, request, response):
        if self.estopped:
            response.success = False
            response.message = 'e-stop engaged, release it before docking'
            return response
        if self.busy:
            # Docking preempts whatever mission is running: a battery watchdog
            # has to be able to call the rover home mid-patrol.
            self.get_logger().info('dock requested, preempting the running goal')
            self.cancel_drive = True
            deadline = time.time() + 5.0
            while self.busy and time.time() < deadline:
                time.sleep(0.1)
            if self.busy:
                response.success = False
                response.message = 'rover did not yield to the dock request'
                return response

        self.state = 'DOCKING'
        self.target_waypoint = 'dock'
        self.busy = True
        x, y = WAYPOINTS['dock']
        try:
            arrived, distance = self._drive_to(x, y, 0.25, 1.8)
        finally:
            self.busy = False
            self._stop_motion()

        if arrived:
            self.state = 'DOCKED'
            self.charging = True
            self.target_waypoint = ''
            self._set_pen_color('cyan')
            self._emit('docked', distance=round(distance, 2))
            response.success = True
            response.message = 'docked, charging from %.1f%%' % self.battery
        else:
            self.state = 'IDLE'
            response.success = False
            response.message = 'docking interrupted'
        return response

    def _on_estop(self, request, response):
        if request.data:
            self.estopped = True
            self.cancel_drive = True
            self._stop_motion()
            self.state = 'ESTOP'
            self._set_pen_color('red')
            self.led_color = 'red'
            self._emit('estop', engaged=True)
            response.message = 'emergency stop engaged'
        else:
            self.estopped = False
            self.cancel_drive = False
            self.state = 'DOCKED' if self._at_dock() else 'IDLE'
            self._set_pen_color('green')
            self.led_color = 'green'
            self._emit('estop', engaged=False)
            response.message = 'emergency stop released'
        response.success = True
        return response

    def _on_reset_battery(self, request, response):
        self.battery = 100.0
        response.success = True
        response.message = 'battery reset to 100%'
        return response

    def _on_reset_demo(self, request, response):
        """Put the demo back to its starting state without restarting anything.

        Called hourly by a housekeeping workflow so a public demo does not drift
        into an empty battery, a scribbled-on map or a latched e-stop.
        """
        self.cancel_drive = True
        deadline = time.time() + 5.0
        while self.busy and time.time() < deadline:
            time.sleep(0.1)

        self._stop_motion()
        self.estopped = False
        self.cancel_drive = False
        self.charging = False
        self.battery = 100.0
        self.target_waypoint = ''
        self.state = 'IDLE'
        self.led_blink = False
        self.led_color = 'green'

        # Lift the pen before moving so the reset itself does not draw a line,
        # wipe the trail, then put the landmarks back: /clear erases everything,
        # the drawn map included.
        self._pen(self.set_pen, off=1)
        self._teleport(self.teleport, *WAYPOINTS['center'])
        self._call_and_wait(self.clear_screen, Empty.Request())
        self._draw_map()
        self._set_pen_color(self.led_color)

        self._emit('demo_reset')
        response.success = True
        response.message = (
            'demo reset: battery full, trail cleared, map redrawn, '
            'rover back at the centre'
        )
        return response

    # ------------------------------------------------------------------
    # Motion
    # ------------------------------------------------------------------
    def _drive_to(self, x, y, tolerance, max_speed, goal_handle=None, on_feedback=None):
        """Blocking proportional controller. Returns (arrived, distance_driven)."""
        tolerance = tolerance if tolerance > 0 else 0.3
        max_speed = max_speed if max_speed > 0 else 1.5
        period = 1.0 / CONTROL_HZ
        feedback_period = 1.0 / FEEDBACK_HZ
        last_feedback = 0.0
        distance_driven = 0.0
        last_point = None
        self.cancel_drive = False

        while rclpy.ok():
            if self.estopped or self.cancel_drive:
                self._stop_motion()
                return False, distance_driven
            if goal_handle is not None and goal_handle.is_cancel_requested:
                self._stop_motion()
                return False, distance_driven
            if self.pose is None:
                time.sleep(period)
                continue

            here = (self.pose.x, self.pose.y)
            if last_point is not None:
                distance_driven += math.hypot(here[0] - last_point[0], here[1] - last_point[1])
            last_point = here

            dx = x - self.pose.x
            dy = y - self.pose.y
            distance = math.hypot(dx, dy)
            if distance <= tolerance:
                self._stop_motion()
                return True, distance_driven

            heading_error = normalize_angle(math.atan2(dy, dx) - self.pose.theta)
            cmd = Twist()
            cmd.angular.z = max(-3.0, min(3.0, 5.0 * heading_error))
            # Only drive forward once roughly pointed the right way, so the
            # turtle traces clean straight lines instead of spirals.
            if abs(heading_error) < 0.35:
                cmd.linear.x = max(0.3, min(max_speed, 1.6 * distance))
            self.cmd_pub.publish(cmd)

            now = time.time()
            if on_feedback is not None and now - last_feedback >= feedback_period:
                last_feedback = now
                on_feedback(distance)

            time.sleep(period)

        self._stop_motion()
        return False, distance_driven

    def _accept_goal(self, _goal_request):
        if self.estopped:
            self.get_logger().warn('goal rejected: e-stop engaged')
            return GoalResponse.REJECT
        if self.battery <= 2.0:
            self.get_logger().warn('goal rejected: battery empty')
            return GoalResponse.REJECT
        if self.busy:
            # Take over rather than refuse. Refusing means a visitor who submits
            # the form while a scheduled patrol happens to be running just gets
            # an error, which is the wrong answer for the person watching.
            self.get_logger().info('new goal preempts the running one')
            self.cancel_drive = True
        return GoalResponse.ACCEPT

    def _await_idle(self, timeout=8.0):
        """Wait out a preempted goal, or an in-progress map draw, before taking over."""
        deadline = time.time() + timeout
        while (self.busy or self.drawing) and time.time() < deadline:
            time.sleep(0.05)
        return not (self.busy or self.drawing)

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _execute_navigate(self, goal_handle):
        request = goal_handle.request
        target = request.target
        started = time.time()

        if not self._await_idle():
            goal_handle.abort()
            result = NavigateTo.Result()
            result.success = False
            result.message = 'the previous goal did not stop in time'
            return result

        self.busy = True
        self.charging = False
        self.state = 'NAVIGATING'
        self.target_waypoint = ''
        self._emit('navigate_started', x=round(target.x, 2), y=round(target.y, 2))

        def feedback(distance_remaining):
            fb = NavigateTo.Feedback()
            fb.distance_remaining = float(distance_remaining)
            fb.current_pose = Pose2D()
            if self.pose is not None:
                fb.current_pose.x = float(self.pose.x)
                fb.current_pose.y = float(self.pose.y)
                fb.current_pose.theta = float(self.pose.theta)
            fb.battery_percentage = float(self.battery)
            goal_handle.publish_feedback(fb)

        try:
            arrived, driven = self._drive_to(
                float(target.x), float(target.y),
                float(request.tolerance), float(request.max_speed),
                goal_handle=goal_handle, on_feedback=feedback,
            )
        finally:
            self.busy = False
            self._stop_motion()
            self.state = 'DOCKED' if self._at_dock() else 'IDLE'

        result = NavigateTo.Result()
        result.distance_traveled = float(driven)
        result.duration_seconds = float(time.time() - started)

        if arrived:
            goal_handle.succeed()
            result.success = True
            result.message = 'arrived at (%.2f, %.2f)' % (target.x, target.y)
            self._emit('arrived', x=round(target.x, 2), y=round(target.y, 2))
        elif goal_handle.is_cancel_requested:
            goal_handle.canceled()
            result.success = False
            result.message = 'goal canceled by client'
        else:
            goal_handle.abort()
            result.success = False
            result.message = 'aborted: e-stop engaged or battery empty'
        return result

    def _execute_patrol(self, goal_handle):
        request = goal_handle.request
        names = [n.strip().lower() for n in request.waypoint_names if n.strip()]
        names = names or list(DEFAULT_PATROL)
        loops = request.loops if request.loops > 0 else 1
        started = time.time()

        unknown = [n for n in names if n not in WAYPOINTS]
        if unknown:
            goal_handle.abort()
            result = Patrol.Result()
            result.success = False
            result.message = 'unknown waypoints: %s (known: %s)' % (
                ', '.join(unknown), ', '.join(sorted(WAYPOINTS)),
            )
            return result

        if not self._await_idle():
            goal_handle.abort()
            result = Patrol.Result()
            result.success = False
            result.message = 'the previous goal did not stop in time'
            return result

        self.busy = True
        self.charging = False
        self.state = 'PATROLLING'
        self._emit('patrol_started', waypoints=names, loops=loops)

        visited = 0
        driven = 0.0
        canceled = False
        aborted = False

        try:
            for loop in range(loops):
                for name in names:
                    self.target_waypoint = name

                    def feedback(_distance_remaining, _name=name, _loop=loop, _visited=visited):
                        fb = Patrol.Feedback()
                        fb.current_waypoint = _name
                        fb.waypoints_completed = _visited
                        fb.current_loop = _loop + 1
                        fb.battery_percentage = float(self.battery)
                        goal_handle.publish_feedback(fb)

                    x, y = WAYPOINTS[name]
                    arrived, leg = self._drive_to(
                        x, y, 0.3, 1.8, goal_handle=goal_handle, on_feedback=feedback,
                    )
                    driven += leg
                    if not arrived:
                        canceled = goal_handle.is_cancel_requested
                        aborted = not canceled
                        break
                    visited += 1
                    self._emit('waypoint_reached', waypoint=name, loop=loop + 1)
                if canceled or aborted:
                    break

            if not canceled and not aborted and request.dock_when_done:
                self.target_waypoint = 'dock'
                x, y = WAYPOINTS['dock']
                arrived, leg = self._drive_to(x, y, 0.25, 1.8, goal_handle=goal_handle)
                driven += leg
                if arrived:
                    self.charging = True
        finally:
            self.busy = False
            self.target_waypoint = ''
            self._stop_motion()
            if self.charging and self._at_dock():
                self.state = 'DOCKED'
            else:
                self.state = 'IDLE'

        result = Patrol.Result()
        result.waypoints_visited = visited
        result.distance_traveled = float(driven)
        result.duration_seconds = float(time.time() - started)

        if canceled:
            goal_handle.canceled()
            result.success = False
            result.message = 'patrol canceled after %d waypoints' % visited
        elif aborted:
            goal_handle.abort()
            result.success = False
            result.message = 'patrol aborted after %d waypoints' % visited
        else:
            goal_handle.succeed()
            result.success = True
            result.message = 'patrol complete: %d waypoints over %d loop(s)' % (
                visited, loops,
            )
            self._emit('patrol_complete', waypoints_visited=visited)
        return result


def main():
    rclpy.init()
    node = RoverNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
