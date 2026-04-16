"use client";

import { useEffect, useRef } from "react";

/**
 * Slow-moving aurora gradient blobs rendered on a full-screen canvas.
 * Gives the page a living, breathing backdrop without being distracting.
 */
export function AuroraBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Each blob drifts on its own sine-based path
    const blobs = [
      { cx: 0.25, cy: 0.2, rx: 0.35, ry: 0.3, speed: 0.00015, phase: 0, color: [130, 80, 200] },    // purple
      { cx: 0.7, cy: 0.35, rx: 0.3, ry: 0.35, speed: 0.00012, phase: 1.8, color: [80, 60, 180] },    // indigo
      { cx: 0.5, cy: 0.7, rx: 0.4, ry: 0.25, speed: 0.0001, phase: 3.5, color: [100, 40, 160] },     // deep violet
    ];

    let t = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      t++;

      for (const b of blobs) {
        const offsetX = Math.sin(t * b.speed + b.phase) * 0.12;
        const offsetY = Math.cos(t * b.speed * 0.7 + b.phase) * 0.08;
        const x = (b.cx + offsetX) * canvas.width;
        const y = (b.cy + offsetY) * canvas.height;
        const radX = b.rx * canvas.width;
        const radY = b.ry * canvas.height;

        // Pulsing opacity
        const pulse = 0.035 + Math.sin(t * b.speed * 2 + b.phase) * 0.012;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(radX, radY));
        const [r, g, bVal] = b.color;
        grad.addColorStop(0, `rgba(${r}, ${g}, ${bVal}, ${pulse})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${bVal}, ${pulse * 0.4})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${bVal}, 0)`);

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, radY / radX);
        ctx.translate(-x, -y);

        ctx.beginPath();
        ctx.arc(x, y, radX, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ filter: "blur(80px)" }}
      aria-hidden="true"
    />
  );
}
