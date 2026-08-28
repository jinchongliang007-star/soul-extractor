# Soul Extractor ROS node

This node transforms the live `/livox/lidar` stream into two deliberately different outputs:

- `/soul/filtered`: local-only downsampled foreground points for RViz diagnostics.
- `/home/jincl/soul-runtime/public/live.json`: irreversible aggregate descriptors rendered as a synthetic energy field. It never contains source point coordinates.

## Manual session controls

Keep the capture area empty, then calibrate the static background:

```bash
rosservice call /soul/calibrate
```

After the 15-second calibration, use:

```bash
rosservice call /soul/start
rosservice call /soul/pause
rosservice call /soul/end
```

The JSON uses an atomic temporary-file rename so an hourly publisher never reads a partially written state.
The processor also checkpoints its 36-value abstract memory every 30 seconds, so a reboot does not erase the cumulative field. The checkpoint contains no source point coordinates.

## Boundary

The output is an artistic record derived from LiDAR statistics. It is not evidence or measurement of a soul, consciousness, a medical condition, or a quantum state.
