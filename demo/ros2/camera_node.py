#!/usr/bin/env python3
"""Publishes the turtlesim window as a compressed image topic.

Gives the demo a real camera feed to point the "ROS2 Topic Capture Image" node
at: whatever the rover is doing on screen can be pulled into a workflow as a
JPEG binary.
"""

import io
import os
import subprocess

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile

from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String

DISPLAY = os.environ.get('DISPLAY', ':99')
PUBLISH_HZ = float(os.environ.get('CAMERA_HZ', '2.0'))
JPEG_QUALITY = int(os.environ.get('CAMERA_JPEG_QUALITY', '70'))
MAX_WIDTH = int(os.environ.get('CAMERA_MAX_WIDTH', '640'))


def grab_with_pillow():
    """Fast path. Needs a Pillow built with X11 screen-grab support."""
    from PIL import ImageGrab

    image = ImageGrab.grab(xdisplay=DISPLAY).convert('RGB')
    if image.width > MAX_WIDTH:
        height = round(image.height * MAX_WIDTH / image.width)
        image = image.resize((MAX_WIDTH, height))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    return buffer.getvalue()


def grab_with_imagemagick():
    """Fallback that does the capture, resize and encode in one process."""
    return subprocess.run(
        [
            'import', '-display', DISPLAY, '-window', 'root', '-silent',
            '-resize', str(MAX_WIDTH), '-quality', str(JPEG_QUALITY),
            'jpeg:-',
        ],
        check=True, capture_output=True, timeout=10,
    ).stdout


GRABBERS = (grab_with_pillow, grab_with_imagemagick)


class CameraNode(Node):
    def __init__(self):
        super().__init__('rover_camera')
        self.publisher = self.create_publisher(
            CompressedImage, '/rover/camera/compressed', 10
        )
        self.grab = None
        self.failures = 0
        self.create_timer(1.0 / PUBLISH_HZ, self._tick)

        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.desc_pub = self.create_publisher(
            String, '/rover/camera/compressed/desc', latched
        )
        self.desc_pub.publish(String(data=(
            'Live JPEG view of the rover map, published at %g Hz. This is the '
            'same picture the public viewer shows. Point the "ROS2 Topic '
            'Capture Image" node at this topic to pull a snapshot into a '
            'workflow.' % PUBLISH_HZ
        )))

    def _select_grabber(self):
        for candidate in GRABBERS:
            try:
                if not candidate():
                    raise RuntimeError('returned no image data')
            except Exception as error:  # noqa: BLE001 - probing for what works
                self.get_logger().warn(
                    '%s unavailable: %s' % (candidate.__name__, error)
                )
                continue
            self.get_logger().info('capturing screen with %s' % candidate.__name__)
            return candidate
        return None

    def _tick(self):
        if self.grab is None:
            self.grab = self._select_grabber()
            if self.grab is None:
                self.get_logger().error('no working screen capture method; retrying')
                return

        try:
            jpeg = self.grab()
        except Exception as error:  # noqa: BLE001 - keep the node alive
            self.failures += 1
            if self.failures % 10 == 1:
                self.get_logger().warn('screen capture failed: %s' % error)
            return

        msg = CompressedImage()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map_view'
        msg.format = 'jpeg'
        msg.data = jpeg
        self.publisher.publish(msg)


def main():
    rclpy.init()
    node = CameraNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
