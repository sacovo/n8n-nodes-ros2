#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0;3m' # No Color

echo -e "${BLUE}=== Starting ROS2 & n8n System Stress Test ===${NC}"

# Navigate to script directory
cd "$(dirname "$0")"

echo -e "${BLUE}Building docker-compose services...${NC}"
docker compose build --pull

# Cleanup hook on exit
cleanup() {
  echo -e "${YELLOW}Tearing down docker containers...${NC}"
  docker compose down -v
}
trap cleanup EXIT

echo -e "${BLUE}Starting all docker-compose services...${NC}"
docker compose up -d

echo -e "${BLUE}Waiting for n8n server to start (Initial boot)...${NC}"
until curl -s http://localhost:5678/healthz > /dev/null; do
  echo -n "."
  sleep 1
done

echo -e "\n${BLUE}Waiting for n8n to complete initial startup...${NC}"
until docker compose logs n8n 2>&1 | grep -q "Editor is now accessible"; do
  echo -n "+"
  sleep 1
done
echo -e "\n${GREEN}n8n initial startup completed! Node dependencies installed.${NC}"

echo -e "${BLUE}Initializing n8n database, credentials, and workflows...${NC}"
docker compose exec -T n8n bash -c "
  n8n import:credentials --input=/work/system-test/credentials/rosBridgeApi.json && \
  n8n import:workflow --input=/work/system-test/workflows/image_capture_test.json && \
  n8n import:workflow --input=/work/system-test/workflows/publish_stress_test.json && \
  n8n import:workflow --input=/work/system-test/workflows/dynamic_topics_stress_test.json && \
  n8n publish:workflow --id=1 && \
  n8n publish:workflow --id=2 && \
  n8n publish:workflow --id=3
"

echo -e "${BLUE}Restarting n8n server to load active workflows and hook them up...${NC}"
docker compose restart n8n

echo -e "${BLUE}Waiting for n8n server to start (Post-restart)...${NC}"
until curl -s http://localhost:5678/healthz > /dev/null; do
  echo -n "."
  sleep 1
done

echo -e "\n${BLUE}Waiting for n8n to reload workflows...${NC}"
until [ "$(docker compose logs n8n 2>&1 | grep -c "Editor is now accessible" || echo 0)" -ge 2 ]; do
  echo -n "+"
  sleep 1
done
echo -e "\n${GREEN}n8n is up and running with all webhooks loaded!${NC}"

echo -e "${BLUE}Measuring baseline resource usage...${NC}"
ros_container_id=$(docker compose ps -q ros2)
n8n_container_id=$(docker compose ps -q n8n)

get_stats() {
  docker stats --no-stream --format "CPU: {{.CPUPerc}} | Mem: {{.MemUsage}}" "$1"
}

echo -n "ROS2 Baseline: "
get_stats "$ros_container_id"
echo -n "n8n Baseline: "
get_stats "$n8n_container_id"

echo -e "\n${YELLOW}=== Test 1: Image Capture Test (sensor_msgs/msg/CompressedImage) ===${NC}"
echo -e "${BLUE}Running image capture workflow 5 times...${NC}"

start_time=$(date +%s%N)
for i in {1..5}; do
  echo -e "Execution $i:"
  curl -s -X POST http://localhost:5678/webhook/1/webhook/image-capture-test > /dev/null
  sleep 0.5
done
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))
echo -e "${GREEN}Completed 5 image captures in ${duration}ms${NC}"

echo -n "ROS2 usage after image capture: "
get_stats "$ros_container_id"
echo -n "n8n usage after image capture: "
get_stats "$n8n_container_id"

echo -e "\n${YELLOW}=== Test 2: Publish Stress Test (100 messages in a burst) ===${NC}"
echo -e "${BLUE}Executing publish stress test workflow...${NC}"

start_time=$(date +%s%N)
curl -s -X POST http://localhost:5678/webhook/2/webhook/publish-stress-test > /dev/null
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))
echo -e "${GREEN}Burst publish execution completed in ${duration}ms${NC}"

# Let subscriber register and print logs
sleep 6

echo -e "\n${YELLOW}=== Test 3: Dynamic Topics Stress Test (200 dynamic topics) ===${NC}"
echo -e "${BLUE}Measuring baseline topic count in ROS2...${NC}"
baseline_topics=$(docker compose exec -T ros2 bash -c "source /opt/ros/jazzy/setup.bash && ros2 topic list | wc -l")
echo -e "Baseline topics count: ${baseline_topics}"

echo -e "${BLUE}Executing dynamic topics stress test workflow (publishing to 200 different topics)...${NC}"
start_time=$(date +%s%N)
curl -s -X POST http://localhost:5678/webhook/3/webhook/dynamic-topics-stress-test > /dev/null
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))
echo -e "${GREEN}Dynamic topics publish execution completed in ${duration}ms${NC}"

# Check topic count immediately
peak_topics=$(docker compose exec -T ros2 bash -c "source /opt/ros/jazzy/setup.bash && ros2 topic list | wc -l")
echo -e "Peak active topics count during test: ${peak_topics}"

echo -e "${BLUE}Waiting 18 seconds for TTL expiration (ROS_PUBLISHER_TTL_MS=5000), rosbridge unregister timeout (10s), and discovery sync...${NC}"
sleep 18

# Check topic count after TTL expiration (stopping daemon to bypass cache)
docker compose exec -T ros2 bash -c "source /opt/ros/jazzy/setup.bash && ros2 daemon stop >/dev/null 2>&1 || true"
final_topics=$(docker compose exec -T ros2 bash -c "source /opt/ros/jazzy/setup.bash && ros2 topic list | wc -l")
echo -e "Final topics count after TTL expiration: ${final_topics}"

if [ "$final_topics" -lt "$peak_topics" ]; then
  echo -e "${GREEN}SUCCESS: Stale publishers were automatically unadvertised and cleaned up!${NC}"
else
  echo -e "${RED}FAILURE: Stale publishers were NOT cleaned up!${NC}"
  echo -e "${BLUE}=== ROS2 Logs ===${NC}"
  docker compose logs ros2 | tail -n 30
  echo -e "${BLUE}=== n8n Logs ===${NC}"
  docker compose logs n8n
  exit 1
fi

echo -e "\n${YELLOW}=== Test Results & Log Diagnostics ===${NC}"
echo -e "${BLUE}Checking ROS2 node logs for received message rate:${NC}"
docker compose logs ros2 | tail -n 15

echo -n "Final ROS2 Stats: "
get_stats "$ros_container_id"
echo -n "Final n8n Stats: "
get_stats "$n8n_container_id"

echo -e "${GREEN}=== System test completed successfully! ===${NC}"
