#!/bin/bash
set -e

# Trust custom certificates
if [ -d /opt/custom-certificates ]; then
  echo "Trusting custom certificates from /opt/custom-certificates."
  export NODE_OPTIONS="--use-openssl-ca $NODE_OPTIONS"
  export SSL_CERT_DIR=/opt/custom-certificates
  c_rehash /opt/custom-certificates
fi

# Set up custom nodes in /data/.n8n/nodes if the directory exists
if [ -d /data ]; then
  echo "Setting up custom nodes in n8n user folder..."
  mkdir -p /data/.n8n/nodes
  cd /data/.n8n/nodes
  
  if [ ! -f package.json ]; then
    echo '{"dependencies":{}}' > package.json
  fi
  
  if [ "${SKIP_NODE_REINSTALL:-}" = "1" ] && [ -d node_modules/@fhnw-rover/n8n-nodes-ros2 ]; then
    # Long-running deployments restart often; reinstalling every time makes
    # startup depend on the npm registry being reachable.
    echo "Custom node already installed, skipping reinstall (SKIP_NODE_REINSTALL=1)."
  else
    # Force clean reinstall of the package to clear the persistent volume cache
    rm -rf node_modules/@fhnw-rover/n8n-nodes-ros2

    # Install/update local package from /work
    npm install --legacy-peer-deps /work
  fi
fi

# Go back to /work
cd /work

if [ "$#" -gt 0 ]; then
  # Got started with arguments
  exec n8n "$@"
else
  # Got started without arguments
  exec n8n start
fi