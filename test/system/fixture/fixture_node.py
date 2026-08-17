#!/usr/bin/env python3
"""
Test fixture ROS 2 node for the n8n-nodes-ros2 system tests.

Provides one of everything the nodes talk to, using only interfaces that ship
with a stock ROS 2 install so there is no custom message package to build:

  parameters  max_vel_x (double), robot_name (string)
  publisher   /chatter            std_msgs/String                 5 Hz
  publisher   /camera/image_raw   sensor_msgs/CompressedImage     2 Hz
  publisher   /chatter/desc       std_msgs/String                 latched docs topic
  subscriber  /commands           std_msgs/String                 echoes to /command_echo
  service     /add_two_ints       example_interfaces/AddTwoInts
  action      /fibonacci          example_interfaces/Fibonacci    feedback + cancel

It can also act as a *client*, so the trigger nodes - which advertise a service
or an action from n8n - can be exercised from the ROS side. Publish to
/test/command and the outcome is published to /test/result:

  "call_service:<name>"       calls <name> (AddTwoInts) with a=2 b=3
  "send_goal:<name>:<order>"  sends a Fibonacci goal to <name>
"""

import base64
import sys
import threading
import time

import rclpy
from example_interfaces.action import Fibonacci
from example_interfaces.srv import AddTwoInts
from rclpy.action import ActionClient, ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String

# A valid 1x1 JPEG, so the capture-image node has something real to decode.
ONE_PIXEL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
)


class FixtureNode(Node):
    def __init__(self) -> None:
        super().__init__("n8n_test_fixture")
        self.callback_group = ReentrantCallbackGroup()

        # rosapi addresses parameters as "<node>:<name>", so the API node's
        # parameter get/set has something real to read and write.
        self.declare_parameter("max_vel_x", 0.5)
        self.declare_parameter("robot_name", "fixture")

        self.chatter_pub = self.create_publisher(String, "/chatter", 10)
        self.image_pub = self.create_publisher(CompressedImage, "/camera/image_raw", 10)
        self.echo_pub = self.create_publisher(String, "/command_echo", 10)
        self.result_pub = self.create_publisher(String, "/test/result", 10)

        # Latched, matching the rover's `<name>/desc` documentation convention
        # that RosApiService.getInterfaceDescription reads.
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.desc_pub = self.create_publisher(String, "/chatter/desc", latched)
        self.desc_pub.publish(String(data="Counter published by the n8n system test fixture"))

        self.create_subscription(String, "/commands", self._on_command, 10)
        self.create_subscription(
            String, "/test/command", self._on_test_command, 10, callback_group=self.callback_group
        )

        self.create_service(
            AddTwoInts, "/add_two_ints", self._add_two_ints, callback_group=self.callback_group
        )

        self.action_server = ActionServer(
            self,
            Fibonacci,
            "/fibonacci",
            execute_callback=self._execute_fibonacci,
            goal_callback=self._on_goal,
            cancel_callback=self._on_cancel,
            callback_group=self.callback_group,
        )

        self.counter = 0
        self.create_timer(0.2, self._publish_chatter)
        self.create_timer(0.5, self._publish_image)

        self.get_logger().info("n8n test fixture ready")

    # --- publishers -----------------------------------------------------

    def _publish_chatter(self) -> None:
        self.counter += 1
        self.chatter_pub.publish(String(data=f"hello {self.counter}"))

    def _publish_image(self) -> None:
        msg = CompressedImage()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "camera"
        msg.format = "jpeg"
        msg.data = ONE_PIXEL_JPEG
        self.image_pub.publish(msg)

    # --- subscriber -----------------------------------------------------

    def _on_command(self, msg: String) -> None:
        self.get_logger().info(f"/commands -> {msg.data}")
        self.echo_pub.publish(String(data=f"echo:{msg.data}"))

    # --- service --------------------------------------------------------

    def _add_two_ints(self, request, response):
        response.sum = request.a + request.b
        self.get_logger().info(f"/add_two_ints {request.a}+{request.b}={response.sum}")
        return response

    # --- action server --------------------------------------------------

    def _on_goal(self, goal_request):
        # A negative order is rejected, so the nodes' rejection path is testable.
        if goal_request.order < 0:
            self.get_logger().info("rejecting goal with negative order")
            return GoalResponse.REJECT
        return GoalResponse.ACCEPT

    def _on_cancel(self, _goal_handle):
        return CancelResponse.ACCEPT

    def _execute_fibonacci(self, goal_handle):
        order = goal_handle.request.order
        sequence = [0, 1]

        for i in range(1, order):
            if goal_handle.is_cancel_requested:
                goal_handle.canceled()
                self.get_logger().info("goal canceled")
                return Fibonacci.Result(sequence=sequence)

            sequence.append(sequence[i] + sequence[i - 1])
            goal_handle.publish_feedback(Fibonacci.Feedback(sequence=sequence))
            # Slow enough that a test can observe feedback and cancel mid-flight.
            time.sleep(0.3)

        goal_handle.succeed()
        return Fibonacci.Result(sequence=sequence)

    # --- client side (drives interfaces advertised by n8n) ---------------

    def _on_test_command(self, msg: String) -> None:
        threading.Thread(target=self._run_test_command, args=(msg.data,), daemon=True).start()

    def _run_test_command(self, command: str) -> None:
        try:
            if command.startswith("call_service:"):
                self._call_service(command.split(":", 1)[1])
            elif command.startswith("send_goal:"):
                _, name, order = command.split(":", 2)
                self._send_goal(name, int(order))
            else:
                self._publish_result(f"error:unknown command {command}")
        except Exception as exc:  # noqa: BLE001 - surfaced to the test as data
            self._publish_result(f"error:{exc}")

    def _call_service(self, name: str) -> None:
        client = self.create_client(AddTwoInts, name, callback_group=self.callback_group)
        if not client.wait_for_service(timeout_sec=10.0):
            self._publish_result(f"error:service {name} not available")
            return

        request = AddTwoInts.Request(a=2, b=3)
        future = client.call_async(request)
        deadline = time.time() + 15.0
        while not future.done() and time.time() < deadline:
            time.sleep(0.05)

        if not future.done():
            self._publish_result(f"error:service {name} timed out")
            return

        self._publish_result(f"service:{future.result().sum}")

    def _send_goal(self, name: str, order: int) -> None:
        client = ActionClient(self, Fibonacci, name, callback_group=self.callback_group)
        if not client.wait_for_server(timeout_sec=10.0):
            self._publish_result(f"error:action {name} not available")
            return

        goal_future = client.send_goal_async(Fibonacci.Goal(order=order))
        deadline = time.time() + 20.0
        while not goal_future.done() and time.time() < deadline:
            time.sleep(0.05)

        if not goal_future.done():
            self._publish_result(f"error:action {name} goal timed out")
            return

        handle = goal_future.result()
        if not handle.accepted:
            self._publish_result("error:goal rejected")
            return

        result_future = handle.get_result_async()
        while not result_future.done() and time.time() < deadline:
            time.sleep(0.05)

        if not result_future.done():
            self._publish_result(f"error:action {name} result timed out")
            return

        sequence = list(result_future.result().result.sequence)
        self._publish_result(f"action:{','.join(str(value) for value in sequence)}")

    def _publish_result(self, payload: str) -> None:
        self.get_logger().info(f"/test/result -> {payload}")
        self.result_pub.publish(String(data=payload))


def main() -> int:
    rclpy.init()
    node = FixtureNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
