#!/bin/bash
# Puts the demo back to a known-good state.
#
#   ./reset.sh          soft: reset the robot, restore the workflows as shipped
#   ./reset.sh --hard   also restart both containers (robot process included)
#
# The soft reset is what the hourly systemd timer runs. It restarts n8n at the
# end, because re-imported workflows only re-arm their ROS triggers on startup,
# so expect the editor to be unavailable for a few seconds.
set -euo pipefail

cd "$(dirname "$0")"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
MODE="${1:-soft}"
case "$MODE" in
	soft|--hard) ;;
	*) echo "Unknown argument: $MODE (expected no argument or --hard)" >&2; exit 2 ;;
esac

log() { echo -e "${BLUE}[reset]${NC} $*"; }

if [ "$MODE" = "--hard" ]; then
	log "hard reset: restarting the robot container"
	docker compose restart ros2
	# rosbridge and the rover node need a moment before n8n's triggers reconnect.
	sleep 15
else
	log "asking the rover to reset itself"
	# `ros2 service call` blocks forever when the service is missing, so this
	# has to be bounded rather than just guarded against a non-zero exit.
	timeout 60 docker compose exec -T ros2 bash -c '
		source /opt/ros/jazzy/setup.bash
		source /ros2_ws/install/setup.bash
		ros2 service call /rover/reset_demo std_srvs/srv/Trigger
	' || echo -e "${YELLOW}[reset] rover reset service did not answer; use --hard${NC}"
fi

log "restoring credentials and workflows as shipped"
# A transient failure here must not skip the re-activation and restart below.
timeout 180 docker compose exec -T n8n bash -c '
	n8n import:credentials --input=/demo/credentials/rosBridgeApi.json
	n8n import:workflow --separate --input=/demo/workflows
' || echo -e "${YELLOW}[reset] import failed, continuing with the restart${NC}"

log "re-activating the demo workflows"
for id in demo-01-patrol demo-02-battery demo-03-drive demo-04-service-trigger \
	demo-05-action-trigger demo-06-snapshot demo-07-agent demo-08-reset demo-09-planner demo-10-manual; do
	docker compose exec -T n8n n8n update:workflow --id="$id" --active=true \
		|| echo -e "${YELLOW}[reset] could not activate $id${NC}"
done

log "restarting n8n so the triggers re-arm"
docker compose restart n8n

tries=0
until curl -sf http://localhost:5678/healthz >/dev/null 2>&1; do
	tries=$((tries + 1))
	if [ "$tries" -gt 150 ]; then
		echo
		docker compose logs --tail=50 n8n || true
		echo -e "${YELLOW}[reset] n8n did not come back within 5 minutes${NC}" >&2
		exit 1
	fi
	printf '.'
	sleep 2
done
echo
echo -e "${GREEN}[reset] done${NC}"
