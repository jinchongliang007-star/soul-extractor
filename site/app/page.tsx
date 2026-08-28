'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Particle = {
  x: number;
  y: number;
  z: number;
  size: number;
  energy: number;
  phase: number;
};

type SoulFieldData = {
  schema: 'soul-field/v1';
  updated_at: string;
  status: 'idle' | 'calibrating' | 'recording' | 'paused' | 'ended';
  sensor: string;
  privacy: string;
  background_calibrated: boolean;
  active_seconds: number;
  source_points_live: number;
  filtered_points_live: number;
  recorded_frames: number;
  energy: number;
  motion: number;
  particles: [number, number, number, number, number][];
};

function fallbackParticles(): Particle[] {
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

function SoulField({ particles }: { particles: Particle[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let animationFrame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = (event.clientX - bounds.left) / bounds.width - 0.5;
      pointerY = (event.clientY - bounds.top) / bounds.height - 0.5;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const seconds = reducedMotion ? 0 : time * 0.001;
      const rotation = seconds * 0.12 + pointerX * 0.42;
      const tilt = pointerY * 0.2;
      const breath = 1 + Math.sin(seconds * 1.1) * 0.025;
      const scale = Math.min(width, height) * 0.34 * breath;

      const rendered = particles
        .map((particle) => {
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
        })
        .sort((a, b) => a.z - b.z);

      const aura = context.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.min(width, height) * 0.37,
      );
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
        context.fillStyle = warm
          ? `rgba(255, 205, 132, ${alpha})`
          : `rgba(132, 210, 255, ${alpha})`;
        context.fill();
      }

      frame += 1;
      if (!reducedMotion || frame < 2) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointermove', onPointerMove);
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointerMove);
    };
  }, [particles]);

  return <canvas ref={canvasRef} className="soul-canvas" aria-label="抽象灵魂粒子能量场" />;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

function statusLabel(status?: SoulFieldData['status']) {
  const labels: Record<SoulFieldData['status'], string> = {
    idle: '等待唤醒 / IDLE',
    calibrating: '背景校准 / CALIBRATING',
    recording: '持续生长 / RECORDING',
    paused: '记忆静置 / PAUSED',
    ended: '留存完成 / ARCHIVED',
  };
  return status ? labels[status] : '模拟回退 / AWAITING SIGNAL';
}

export default function Home() {
  const soulRef = useRef<HTMLElement>(null);
  const [field, setField] = useState<SoulFieldData | null>(null);
  const [fieldSource, setFieldSource] = useState<'github' | 'snapshot' | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadField = async () => {
      const timestamp = Date.now();
      const sources = [
        {
          name: 'github' as const,
          url: `https://raw.githubusercontent.com/jinchongliang007-star/soul-extractor/main/data/live.json?t=${timestamp}`,
        },
        { name: 'snapshot' as const, url: `/live.json?t=${timestamp}` },
      ];

      for (const source of sources) {
        try {
          const response = await fetch(source.url, { cache: 'no-store' });
          if (!response.ok) continue;
          const data = await response.json() as SoulFieldData;
          if (data.schema !== 'soul-field/v1' || !Array.isArray(data.particles)) continue;
          if (!cancelled) {
            setField(data);
            setFieldSource(source.name);
          }
          return;
        } catch {
          // Try the embedded snapshot when the GitHub archive is temporarily unavailable.
        }
      }
    };

    loadField();
    const refresh = window.setInterval(loadField, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, []);

  const particles = useMemo(() => {
    if (!field?.particles.length) return fallbackParticles();
    const maximum = Math.max(
      2.5,
      ...field.particles.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]),
    );
    return field.particles.map(([x, y, z, energy, size], index) => ({
      x: x / maximum,
      y: z / maximum,
      z: y / maximum,
      energy,
      size,
      phase: index * 0.371,
    }));
  }, [field]);

  const isReal = Boolean(field);

  return (
    <main>
      <nav className="site-nav" aria-label="主导航">
        <a className="brand" href="#top" aria-label="返回首页">
          <span className="brand-mark">S·E</span>
          <span className="brand-name">SOUL EXTRACTOR</span>
        </a>
        <p className={`system-state ${isReal ? 'is-live' : ''}`}>
          <i /> SYSTEM / {isReal ? 'LIDAR LINKED' : 'STANDBY'}
        </p>
      </nav>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit orbit-one" aria-hidden="true" />
        <div className="hero-orbit orbit-two" aria-hidden="true" />

        <div className="hero-copy">
          <p className="eyebrow">MID-70 / DIGITAL LIFE ARCHIVE</p>
          <h1>把一段存在，<br />留在光里。</h1>
          <p className="intro">
            用激光记录身体经过时间的存在，<br className="desktop-break" />
            转译成一个持续生长的数字生命。
          </p>
          <p className="note">保存存在留下的本质，让灵魂以另一种形态，在数字世界继续生长。</p>
        </div>

        <button
          className="scroll-cue"
          type="button"
          onClick={() => soulRef.current?.scrollIntoView({ behavior: 'smooth' })}
          aria-label="向下查看灵魂"
        >
          <span>SCROLL TO AWAKEN</span>
          <i><b /></i>
        </button>

        <div className="hero-index" aria-hidden="true">
          <span>01</span><i /><span>02</span>
        </div>
      </section>

      <section className="soul-section" id="soul" ref={soulRef}>
        <SoulField particles={particles} />
        <div className="field-noise" aria-hidden="true" />

        <header className="soul-header">
          <p className="eyebrow">THE SOUL / 001</p>
          <h2>存在场</h2>
        </header>

        <div className={`soul-state ${isReal ? 'is-live' : ''}`}>
          <span className="live-dot" />
          <div>
            <p>SOUL STATE</p>
            <strong>{statusLabel(field?.status)}</strong>
            <time>
              {field
                ? `${fieldSource === 'github' ? 'GITHUB MEMORY' : 'LOCAL SNAPSHOT'} · ${new Date(field.updated_at).toLocaleString('zh-CN', { hour12: false })}`
                : 'PROCEDURAL FIELD'}
            </time>
          </div>
        </div>

        <div className="soul-meta" aria-label="灵魂状态数据">
          <div><span>ABSTRACT PARTICLES</span><strong>{particles.length.toLocaleString()}</strong></div>
          <div><span>ACTIVE TIME</span><strong>{formatDuration(field?.active_seconds ?? 0)}</strong></div>
          <div><span>FIELD ENERGY</span><strong>{field ? `${Math.round(field.energy * 100)}%` : '—'}</strong></div>
        </div>

        <p className="interaction-hint">
          {isReal ? '真实点云的统计回声 · 不保存身体轮廓' : '移动指针 · 感受能量场'}
        </p>
        <p className="disclaimer">ARTISTIC INTERPRETATION · NOT A MEDICAL OR CONSCIOUSNESS MEASUREMENT</p>
      </section>
    </main>
  );
}
