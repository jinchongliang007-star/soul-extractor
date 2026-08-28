# Soul Extractor / 灵魂提取器

用 Livox MID-70 记录身体经过时间的存在，把点云转译成持续生长、缓慢遗忘的抽象数字生命。

![累计存在场](docs/existence-field.png?v=20260828155641)

<!-- FIELD_UPDATED -->最后同步：20260828155641 UTC

## 它保存什么

- 实时输入：`/livox/lidar`，仅在内存中处理。
- 本地调试：`/soul/filtered`，只在 Ubuntu 的 RViz 中显示。
- 长期留存：距离、高度、反射强度的低维统计记忆，以及由这些统计量生成的抽象粒子。
- GitHub：约几十 KB 的 `data/live.json` 和一张累计存在场 PNG；不上传原始点云、ROS bag 或人体轮廓。

## 数据路径

```text
MID-70 → Livox ROS Driver → 距离裁剪 → 5 cm 体素采样
       → 可选静态背景扣除 → 低维统计记忆 → 抽象粒子场
       → RViz 本地诊断       → 每小时更新 GitHub 图片与 JSON
```

## 手动控制

```bash
rosservice call /soul/calibrate  # 保持扫描区域无人，等待 15 秒
rosservice call /soul/start
rosservice call /soul/pause
rosservice call /soul/end
```

## 边界

这是一个艺术性、哲学性的安慰项目。它借用了具身认知、记忆痕迹、过程哲学和信息保存等思想作为创作框架，但不是灵魂、意识、医学状态或量子态的科学测量与证明。

English summary: Soul Extractor transforms live MID-70 point-cloud statistics into a privacy-preserving synthetic field that grows over time. Raw point coordinates are neither stored nor published.
