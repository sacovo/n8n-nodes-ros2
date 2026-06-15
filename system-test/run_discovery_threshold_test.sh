#!/bin/bash
# run_discovery_threshold_test.sh

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Starting ROS2 DDS Discovery Delay Threshold Test ===${NC}"

cd "$(dirname "$0")"

# Start containers
echo -e "${BLUE}Starting all docker-compose services...${NC}"
docker compose up -d

cleanup() {
  echo -e "${YELLOW}Tearing down docker containers...${NC}"
  docker compose down -v
}
trap cleanup EXIT

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
  n8n import:workflow --input=/work/system-test/workflows/discovery_test.json && \
  n8n publish:workflow --id=4
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

# Define delays to test (in milliseconds)
DELAYS=(0 50 100 250 500 750)
RUNS_PER_DELAY=5

echo -e "${YELLOW}Testing discovery delays. Each delay will be tested $RUNS_PER_DELAY times.${NC}"
echo -e "${YELLOW}We wait 18 seconds between runs to ensure the publisher cache (TTL 5s) and rosbridge unregister timeout (10s) expire.${NC}"

# Declare associative arrays or lists to track results
RESULTS=()

for delay in "${DELAYS[@]}"; do
  echo -e "\n${BLUE}--- Testing Discovery Delay: ${delay}ms ---${NC}"
  success_count=0
  
  for i in $(seq 1 $RUNS_PER_DELAY); do
    # 1. Wait for publisher cache TTL (5s) and rosbridge unregister timeout (10s) to expire to guarantee a fresh advertising step
    echo -n "Waiting for cache to clear... "
    sleep 18
    
    msg_id="delay_${delay}_run_${i}_$(date +%s)"
    echo -e "Triggering publish with msg: ${msg_id}"
    
    # 2. Trigger webhook in n8n (production webhook URL for active workflow)
    curl -s -X POST -H "Content-Type: application/json" \
      -d "{\"delay\": $delay, \"message\": \"$msg_id\"}" \
      http://localhost:5678/webhook/4/webhook/discovery-test > /dev/null
      
    # 3. Wait for message delivery
    sleep 2
    
    # 4. Check if the message reached the ROS2 node logs
    if docker compose logs ros2 | grep -q "Received discovery test: $msg_id"; then
      echo -e "${GREEN}  Run $i: SUCCESS${NC}"
      success_count=$((success_count + 1))
    else
      echo -e "${RED}  Run $i: FAILED (Missed)${NC}"
    fi
  done
  
  rate=$(( success_count * 100 / RUNS_PER_DELAY ))
  RESULTS+=("$delay ms: $rate% ($success_count/$RUNS_PER_DELAY)")
done

echo -e "\n${GREEN}=== Threshold Test Completed ===${NC}"
echo -e "${BLUE}Results Summary:${NC}"
for res in "${RESULTS[@]}"; do
  echo -e "  $res"
done
