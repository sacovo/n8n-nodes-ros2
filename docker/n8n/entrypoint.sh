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
  
  # Install/update local package from /work
  npm install --legacy-peer-deps /work
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