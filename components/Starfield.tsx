"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
}

interface Ping {
  x: number;
  y: number;
  start: number;
}

const STAR_COUNT = 260;
const PING_DURATION_MS = 900;
const PING_COLOR = "255, 47, 109"; // --signal

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let stars: Star[] = [];
    let pings: Ping[] = [];
    let frameId = 0;
    let lastTime = 0;

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      stars = Array.from({ length: STAR_COUNT }, () => {
        const radius = Math.random() * 1.4 + 0.3;
        // Bigger stars drift faster, giving a sense of depth in the motion.
        const speed = 0.006 + radius * 0.014;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: -speed,
          vy: speed * 0.28,
          radius,
          baseAlpha: Math.random() * 0.5 + 0.35,
          twinkleSpeed: Math.random() * 0.0015 + 0.0004,
          phase: Math.random() * Math.PI * 2,
        };
      });
    }

    function drawStatic() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(242, 240, 233, 1)";
      for (const s of stars) {
        ctx.globalAlpha = s.baseAlpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function draw(time: number) {
      if (!ctx) return;
      const dt = lastTime ? time - lastTime : 16;
      lastTime = time;
      ctx.clearRect(0, 0, width, height);

      for (const s of stars) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < -10) s.x = width + 10;
        if (s.x > width + 10) s.x = -10;
        if (s.y < -10) s.y = height + 10;
        if (s.y > height + 10) s.y = -10;

        const twinkle =
          0.55 + 0.45 * Math.sin(time * s.twinkleSpeed + s.phase);
        ctx.globalAlpha = s.baseAlpha * twinkle;
        ctx.fillStyle = "rgba(242, 240, 233, 1)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      pings = pings.filter((p) => time - p.start < PING_DURATION_MS);
      for (const p of pings) {
        const age = (time - p.start) / PING_DURATION_MS;
        const radius = age * 60;
        const alpha = 1 - age;
        ctx.strokeStyle = `rgba(${PING_COLOR}, ${alpha * 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      frameId = requestAnimationFrame(draw);
    }

    function handleClick(e: MouseEvent) {
      pings.push({ x: e.clientX, y: e.clientY, start: performance.now() });
      if (reduceMotion) {
        // Draw a single instant ring instead of an animated one.
        if (!ctx) return;
        ctx.strokeStyle = `rgba(${PING_COLOR}, 0.6)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.clientX, e.clientY, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("click", handleClick);

    if (reduceMotion) {
      drawStatic();
    } else {
      frameId = requestAnimationFrame(draw);
    }

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("click", handleClick);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
