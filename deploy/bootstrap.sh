#!/usr/bin/env bash
# One-time provisioning for a FRESH Ubuntu/Debian VPS that will run the Panzer TG
# Docker stack. Idempotent — safe to re-run. Run ONCE per server as root:
#
#   ssh root@<host> 'bash -s' < deploy/bootstrap.sh "ssh-ed25519 AAAA... ci-deploy"
#
# The argument is the PUBLIC half of the CI deploy key (its private half is the
# DEPLOY_SSH_KEY secret in the GitHub Environment). After this, the `deploy` user
# can SSH in with that key and run docker; GitHub Actions does the rest.
set -euo pipefail

# "$*" (all args joined) tolerates SSH re-splitting the key line into words.
PUB_KEY="$*"
if [[ -z "$PUB_KEY" ]]; then
	echo "Usage: bootstrap.sh \"<public-ssh-key-line>\"" >&2
	exit 1
fi

export DEBIAN_FRONTEND=noninteractive
echo "==> apt update + base packages"
apt-get update -y
apt-get install -y rsync ufw ca-certificates curl

# Provider images often ship a default apache2/nginx bound to :80 (and apache on
# :8080). Caddy needs :80 + :443 — stop and disable them so the container can bind.
echo "==> Disabling any pre-installed web servers (apache2/nginx)"
for svc in apache2 nginx; do
	if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
		systemctl disable --now "$svc" >/dev/null 2>&1 || true
	fi
done

echo "==> Installing Docker (if missing)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Docker 29 defaults to the containerd image store (storage driver "overlayfs"),
# which cAdvisor can't read per-container metrics from (it fails to resolve the
# container RW layer) — so the Grafana monitoring would show no container load.
# Pin the classic overlay2 graphdriver. Safe on a fresh host (no images yet).
if [ ! -s /etc/docker/daemon.json ]; then
	echo "==> Pinning Docker storage driver to overlay2 (cAdvisor-friendly)"
	mkdir -p /etc/docker
	printf '{\n  "features": { "containerd-snapshotter": false }\n}\n' > /etc/docker/daemon.json
	systemctl restart docker
fi

echo "==> Configuring firewall (ufw)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating 'deploy' user"
if ! id deploy >/dev/null 2>&1; then
	useradd -m -s /bin/bash deploy
fi
usermod -aG docker deploy

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$PUB_KEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Preparing /opt/panzers"
install -d -m 755 -o deploy -g deploy /opt/panzers

echo
echo "Bootstrap complete."
echo "Test from your workstation: ssh -i <private-key> deploy@$(hostname -I | awk '{print $1}')"
