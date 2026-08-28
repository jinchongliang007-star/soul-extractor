(() => {
  const canvas = document.getElementById('soul-canvas');
  const context = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const labels = {
    idle: '等待唤醒 / IDLE',
    calibrating: '背景校准 / CALIBRATING',
    recording: '持续生长 / RECORDING',
    paused: '记忆静置 / PAUSED',
    ended: '留存完成 / ARCHIVED',
  };

  let width = 0;
  let height = 0;
  let pointerX = 0;
  let pointerY = 0;
  let animationFrame = 0;
  let particles = fallbackParticles();

  function fallbackParticles() {
    return Array.from({ length: 720 }, (_, index) => {
      const ratio = index / 720;
      const pseudo = (Math.sin(index * 127.1) * 43758.5453) % 1;
      const noise = Math.abs(pseudo);
      const angle = ratio * Math.PI * 18 + noise * 0.8;
      const shell = 0.25 + Math.pow(Math.abs(Math.sin(index * 19.19)), 0.58) * 0.75;
      const vertical = Math.sin(index * 73.73) * 0.92;
      const radius = 0.42 + shell * 0.58;
      return {
        x: Math.cos(angle) * radius * (0.74 + Math.abs(vertical) * 0.2),
        y: vertical * (0.8 - Math.abs(vertical) * 0.15),
        z: Math.sin(angle) * radius,
        size: 0.45 + Math.abs(Math.sin(index * 5.31)) * 1.9,
        energy: Math.abs(Math.sin(index * 11.17)),
        phase: index * 0.371,
      };
    });
  }

  function normalizeParticles(source) {
    const maximum = Math.max(2.5, ...source.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    return source.map(([x, y, z, energy, size], index) => ({
      x: x / maximum,
      y: z / maximum,
      z: y / maximum,
      energy,
      size,
      phase: index * 0.371,
    }));
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
  }

  function applyField(field) {
    particles = normalizeParticles(field.particles);
    document.getElementById('particle-count').textContent = particles.length.toLocaleString('zh-CN');
    document.getElementById('active-time').textContent = formatDuration(field.active_seconds);
    document.getElementById('field-energy').textContent = `${Math.round(field.energy * 100)}%`;
    document.getElementById('state-label').textContent = labels[field.status] || field.status.toUpperCase();
    document.getElementById('state-time').textContent = `GITHUB MEMORY · ${new Date(field.updated_at).toLocaleString('zh-CN', { hour12: false })}`;
    document.getElementById('interaction-hint').textContent = '真实点云的统计回声 · 不保存身体轮廓';
    const systemState = document.getElementById('system-state');
    systemState.classList.add('is-live');
    systemState.innerHTML = '<i></i> SYSTEM / LIDAR LINKED';
    document.getElementById('soul-state').classList.add('is-live');
    if (reducedMotion) requestAnimationFrame(draw);
  }

  async function loadField() {
    try {
      const response = await fetch(`./data/live.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const field = await response.json();
      if (field.schema !== 'soul-field/v1' || !Array.isArray(field.particles) || !field.particles.length) return;
      applyField(field);
    } catch {
      // The procedural field remains visible until the GitHub archive is reachable.
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = bounds.width;
    height = bounds.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reducedMotion) requestAnimationFrame(draw);
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    const seconds = reducedMotion ? 0 : time * 0.001;
    const rotation = seconds * 0.12 + pointerX * 0.42;
    const tilt = pointerY * 0.2;
    const breath = 1 + Math.sin(seconds * 1.1) * 0.025;
    const scale = Math.min(width, height) * 0.34 * breath;

    const rendered = particles.map((particle) => {
      const wave = Math.sin(seconds * 0.8 + particle.phase + particle.y * 2.8) * 0.035;
      const x = particle.x * Math.cos(rotation) - particle.z * Math.sin(rotation);
      const z = particle.x * Math.sin(rotation) + particle.z * Math.cos(rotation);
      const y = particle.y * Math.cos(tilt) - z * Math.sin(tilt) + wave;
      const depth = 1.9 + z;
      return {
        x: width / 2 + (x * scale) / depth,
        y: height / 2 + (y * scale) / depth,
        z,
        size: (particle.size * (1.7 + z)) / 2.2,
        energy: particle.energy,
      };
    }).sort((a, b) => a.z - b.z);

    const aura = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * 0.37);
    aura.addColorStop(0, 'rgba(55, 156, 255, 0.10)');
    aura.addColorStop(0.48, 'rgba(54, 112, 255, 0.045)');
    aura.addColorStop(1, 'rgba(2, 7, 16, 0)');
    context.fillStyle = aura;
    context.fillRect(0, 0, width, height);

    for (const particle of rendered) {
      const warm = particle.energy > 0.92;
      const alpha = 0.18 + particle.energy * 0.72;
      context.beginPath();
      context.arc(particle.x, particle.y, Math.max(0.45, particle.size), 0, Math.PI * 2);
      context.fillStyle = warm ? `rgba(255, 205, 132, ${alpha})` : `rgba(132, 210, 255, ${alpha})`;
      context.fill();
    }

    if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
  }

  canvas.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect();
    pointerX = (event.clientX - bounds.left) / bounds.width - 0.5;
    pointerY = (event.clientY - bounds.top) / bounds.height - 0.5;
    if (reducedMotion) requestAnimationFrame(draw);
  });
  document.getElementById('scroll-cue').addEventListener('click', () => {
    document.getElementById('soul').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => cancelAnimationFrame(animationFrame));

  resize();
  animationFrame = requestAnimationFrame(draw);
  loadField();
  window.setInterval(loadField, 60_000);
})();
