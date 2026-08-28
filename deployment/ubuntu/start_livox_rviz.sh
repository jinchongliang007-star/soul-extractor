#!/usr/bin/env bash
set -eo pipefail

workspace="/home/jincl/soul_livox"
interface="${LIVOX_INTERFACE:-enp0s31f6}"
broadcast_code="${1:-100000000000000}"

if [[ -z "${DISPLAY:-}" ]]; then
  echo "没有检测到图形桌面 DISPLAY。请在 Ubuntu 本机桌面运行此脚本。" >&2
  exit 2
fi

if ! ip link show "${interface}" >/dev/null 2>&1; then
  echo "找不到 Livox 网卡：${interface}" >&2
  exit 3
fi

if ! ip -4 address show dev "${interface}" | grep -q "192\.168\.1\."; then
  echo "提示：${interface} 尚未配置 192.168.1.x 地址，接入 MID-70 后需要先配置网卡。" >&2
fi

source /opt/ros/melodic/setup.bash
source "${workspace}/devel/setup.bash"

exec roslaunch soul_extractor soul_system.launch \
  bd_list:="${broadcast_code}" \
  publish_freq:=10.0
