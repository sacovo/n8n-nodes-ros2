#!/bin/bash
# Brings the demo stack up and loads the credentials and workflows into n8n.
#
#   ./setup.sh            local only, no domains or certificates needed
#   ./setup.sh --public   also start Caddy and go live on your two domains
#
# Re-running overwrites the demo credentials and workflows with the copies in
# this folder, discarding any edits made in the editor.
set -euo pipefail

cd "$(dirname "$0")"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
PUBLIC=0

fail() { echo -e "${RED}$*${NC}" >&2; exit 1; }

if [ "${1:-}" = "--public" ]; then
	PUBLIC=1
	[ -f .env ] || fail "Refusing to start the public profile without a .env file.
Copy .env.example to .env and fill it in first."

	set -a; . ./.env; set +a

	for var in N8N_DOMAIN VIEWER_DOMAIN N8N_PUBLIC_URL ACME_EMAIL N8N_ENCRYPTION_KEY; do
		[ -n "${!var:-}" ] || fail "Refusing to start: $var is not set in .env"
	done

	case "$N8N_ENCRYPTION_KEY" in
		change-me-*|demo-encryption-key-change-me)
			fail "Refusing to start: N8N_ENCRYPTION_KEY is still the placeholder.
Generate one with: openssl rand -hex 24" ;;
	esac

	[ "${N8N_PROTOCOL:-}" = "https" ] || fail "Set N8N_PROTOCOL=https in .env"
	[ "${N8N_SECURE_COOKIE:-}" = "true" ] || fail "Set N8N_SECURE_COOKIE=true in .env"

	# A mismatch here silently produces unreachable webhook and form URLs.
	[ "$N8N_PUBLIC_URL" = "https://$N8N_DOMAIN" ] || fail \
		"N8N_PUBLIC_URL must be exactly https://$N8N_DOMAIN (no trailing slash)"

	echo -e "${BLUE}Public mode: n8n on $N8N_DOMAIN, viewer on $VIEWER_DOMAIN.${NC}"
else
	echo -e "${BLUE}Local mode. Pass --public to also start Caddy.${NC}"
fi

wait_for_n8n() {
	local tries=0
	until curl -sf http://localhost:5678/healthz >/dev/null 2>&1; do
		tries=$((tries + 1))
		if [ "$tries" -gt 150 ]; then
			echo
			docker compose logs --tail=50 n8n || true
			fail "n8n did not become healthy in 5 minutes; see the log above."
		fi
		printf '.'
		sleep 2
	done
	echo
}

echo -e "${BLUE}Building images (the first run compiles n8n and the ROS interfaces, expect a while)...${NC}"
docker compose build

# Caddy stays down until the owner account exists: while n8n is unclaimed,
# anyone who reaches it can create the owner and run code on this server.
echo -e "${BLUE}Starting n8n and the robot...${NC}"
docker compose up -d

echo -e "${BLUE}Waiting for n8n...${NC}"
wait_for_n8n

echo -e "${BLUE}Importing credentials and workflows...${NC}"
docker compose exec -T n8n bash -c '
	set -e
	n8n import:credentials --input=/demo/credentials/rosBridgeApi.json
	n8n import:workflow --separate --input=/demo/workflows
'

echo -e "${BLUE}Activating the demo workflows...${NC}"
for id in demo-01-patrol demo-02-battery demo-03-drive demo-04-service-trigger \
	demo-05-action-trigger demo-06-snapshot demo-07-agent demo-08-reset demo-09-planner demo-10-manual; do
	docker compose exec -T n8n n8n update:workflow --id="$id" --active=true \
		|| echo -e "${YELLOW}could not activate $id, flip it on in the editor${NC}"
done

echo -e "${BLUE}Restarting n8n so the triggers register with rosbridge...${NC}"
docker compose restart n8n
wait_for_n8n

if [ "$PUBLIC" = "1" ]; then
	echo
	echo -e "${YELLOW}n8n has no owner account yet, and the first visitor to reach it${NC}"
	echo -e "${YELLOW}can claim one. Create yours before the site goes public:${NC}"
	echo -e "  open http://localhost:5678 on this machine, or tunnel to it with"
	echo -e "  ssh -L 5678:localhost:5678 <this-server>"
	echo
	if ! read -r -p "Press enter once the owner account exists to start Caddy: " _; then
		fail "No terminal to confirm on. Create the owner account, then run:
  docker compose --profile public up -d caddy"
	fi
	docker compose --profile public up -d caddy
fi

echo -e "${GREEN}Demo is up.${NC}"
if [ "$PUBLIC" = "1" ]; then
	echo -e "  Editor:      https://${N8N_DOMAIN}"
	echo -e "  Live view:   https://${VIEWER_DOMAIN}"
else
	echo -e "  Editor:      http://localhost:5678"
	echo -e "  Live view:   http://localhost:6080"
fi
echo -e "${YELLOW}Workflow 07 (AI agent) stays inactive until you add a model credential.${NC}"
