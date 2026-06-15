import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String
import time
import base64

class StressTestNode(Node):
    def __init__(self):
        super().__init__('stress_test_node')
        self.image_pub = self.create_publisher(CompressedImage, '/camera/image/compressed', 10)
        self.publish_sub = self.create_subscription(String, '/n8n_publish_test', self.publish_callback, 10)
        self.discovery_sub = self.create_subscription(String, '/n8n_discovery_test', self.discovery_callback, 10)
        
        # Tiny 1x1 JPEG image in base64
        self.jpeg_data = base64.b64decode(
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
        )
        
        # Timer for 10Hz image publication
        self.timer = self.create_timer(0.1, self.timer_callback)
        self.msg_count = 0
        self.last_report = time.time()
        
    def timer_callback(self):
        msg = CompressedImage()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "camera_frame"
        msg.format = "jpeg"
        msg.data = self.jpeg_data
        self.image_pub.publish(msg)
        
    def publish_callback(self, msg):
        self.msg_count += 1
        now = time.time()
        if now - self.last_report >= 5.0:
            rate = self.msg_count / (now - self.last_report)
            self.get_logger().info(f"Received {self.msg_count} messages in last 5s (Rate: {rate:.2f} msg/sec)")
            self.msg_count = 0
            self.last_report = now

    def discovery_callback(self, msg):
        self.get_logger().info(f"Received discovery test: {msg.data}")

def main(args=None):
    rclpy.init(args=args)
    node = StressTestNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
