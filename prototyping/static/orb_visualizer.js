/**
 * Glowing Fluid Neural Orb Visualizer
 * High-performance Canvas-based procedural audio visualizer.
 * Dynamically reacts to Candidate Microphone and Iris AI WebRTC audio streams.
 */

export class NeuralOrbVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    
    // Animation state
    this.isRunning = false;
    this.animFrameId = null;
    this.time = 0;
    
    // Core visual parameters
    this.baseRadius = 90;
    this.currentRadius = 90;
    this.targetRadius = 90;
    this.layersCount = 4;
    this.pointsCount = 14;
    
    // Audio analysis nodes
    this.micAnalyser = null;
    this.botAnalyser = null;
    this.micDataArray = null;
    this.botDataArray = null;
    
    // Real-time smoothed audio levels (0.0 to 1.0)
    this.micVolume = 0;
    this.botVolume = 0;
    this.combinedEnergy = 0;
    
    // State machine: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
    this.state = 'idle';
    
    // Particle system
    this.particles = [];
    this.maxParticles = 50;
    this.ripples = [];
    
    // State color palettes (primary, secondary, glow, aura)
    this.palettes = {
      idle: {
        core1: '#38bdf8', // sky cyan
        core2: '#6366f1', // indigo
        mantle: 'rgba(56, 189, 248, 0.25)',
        corona: 'rgba(99, 102, 241, 0.15)',
        glow: 'rgba(56, 189, 248, 0.4)',
        particles: '#7dd3fc'
      },
      listening: {
        core1: '#34d399', // emerald
        core2: '#fbbf24', // amber
        mantle: 'rgba(52, 211, 153, 0.35)',
        corona: 'rgba(251, 191, 36, 0.2)',
        glow: 'rgba(52, 211, 153, 0.55)',
        particles: '#6ee7b7'
      },
      thinking: {
        core1: '#c084fc', // purple
        core2: '#f472b6', // pink
        mantle: 'rgba(192, 132, 252, 0.35)',
        corona: 'rgba(244, 114, 182, 0.2)',
        glow: 'rgba(192, 132, 252, 0.55)',
        particles: '#e879f9'
      },
      speaking: {
        core1: '#06b6d4', // cyan
        core2: '#3b82f6', // blue
        mantle: 'rgba(6, 182, 212, 0.45)',
        corona: 'rgba(59, 130, 246, 0.25)',
        glow: 'rgba(6, 182, 212, 0.7)',
        particles: '#a5f3fc'
      },
      error: {
        core1: '#fb7185',
        core2: '#e11d48',
        mantle: 'rgba(251, 113, 133, 0.35)',
        corona: 'rgba(225, 29, 72, 0.2)',
        glow: 'rgba(251, 113, 133, 0.55)',
        particles: '#fda4af'
      }
    };

    this.init();
  }

  init() {
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    this.initParticles();
    this.start();
  }

  handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    // Responsive base radius
    this.baseRadius = Math.min(this.width, this.height) * 0.22;
    if (this.baseRadius < 55) this.baseRadius = 55;
    if (this.baseRadius > 110) this.baseRadius = 110;
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        distance: this.baseRadius * (1.1 + Math.random() * 1.4),
        size: 1 + Math.random() * 2.5,
        speed: (Math.random() * 0.008 + 0.003) * (Math.random() > 0.5 ? 1 : -1),
        alpha: Math.random() * 0.7 + 0.3,
        pulseOffset: Math.random() * Math.PI * 2
      });
    }
  }

  setMicAnalyser(analyser) {
    this.micAnalyser = analyser;
    if (analyser) {
      this.micDataArray = new Uint8Array(analyser.frequencyBinCount);
    }
  }

  setBotAnalyser(analyser) {
    this.botAnalyser = analyser;
    if (analyser) {
      this.botDataArray = new Uint8Array(analyser.frequencyBinCount);
    }
  }

  setState(newState) {
    if (this.palettes[newState] && this.state !== newState) {
      // Trigger voice shockwave ripple when transitioning into speaking or listening
      if (newState === 'speaking' || newState === 'listening') {
        this.addRipple();
      }
      this.state = newState;
    }
  }

  addRipple() {
    this.ripples.push({
      radius: this.baseRadius * 0.9,
      maxRadius: this.baseRadius * 2.4,
      alpha: 0.8,
      speed: 2.2,
      state: this.state
    });
  }

  start() {
    if (!this.isRunning) {
      this.isRunning = true;
      this.render();
    }
  }

  stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  sampleAudio() {
    let micVol = 0;
    let botVol = 0;

    // Sample candidate microphone
    if (this.micAnalyser && this.micDataArray) {
      this.micAnalyser.getByteFrequencyData(this.micDataArray);
      let sum = 0;
      // Focus on human vocal frequencies (first 40% of bins)
      const count = Math.floor(this.micDataArray.length * 0.4);
      for (let i = 0; i < count; i++) {
        sum += this.micDataArray[i];
      }
      micVol = (sum / (count * 255));
    }

    // Sample Iris WebRTC audio output
    if (this.botAnalyser && this.botDataArray) {
      this.botAnalyser.getByteFrequencyData(this.botDataArray);
      let sum = 0;
      const count = Math.floor(this.botDataArray.length * 0.45);
      for (let i = 0; i < count; i++) {
        sum += this.botDataArray[i];
      }
      botVol = (sum / (count * 255));
    }

    // Smooth with low-pass filter
    this.micVolume = this.micVolume * 0.7 + micVol * 0.3;
    this.botVolume = this.botVolume * 0.65 + botVol * 0.35;
    this.combinedEnergy = Math.max(this.micVolume, this.botVolume);
  }

  render() {
    if (!this.isRunning) return;

    this.time += 0.025;
    this.sampleAudio();

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.clearRect(0, 0, w, h);

    const palette = this.palettes[this.state] || this.palettes.idle;

    // Dynamic radius response
    const audioExpansion = this.botVolume * 35 + this.micVolume * 25;
    this.targetRadius = this.baseRadius + audioExpansion + Math.sin(this.time * 2) * 2;
    this.currentRadius = this.currentRadius * 0.8 + this.targetRadius * 0.2;

    // 1. Draw Background Radial Glow Aura
    const auraGradient = ctx.createRadialGradient(
      centerX, centerY, this.currentRadius * 0.2,
      centerX, centerY, this.currentRadius * 2.2
    );
    auraGradient.addColorStop(0, palette.glow);
    auraGradient.addColorStop(0.5, palette.corona);
    auraGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.fillStyle = auraGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.currentRadius * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Draw Concentric Ripples
    this.drawRipples(ctx, centerX, centerY, palette);

    // 3. Draw Orbiting Energy Particles
    this.drawParticles(ctx, centerX, centerY, palette);

    // 4. Draw Multi-layered Fluid Blob Orb (Outer Corona & Mantle)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let layer = this.layersCount; layer >= 1; layer--) {
      const layerOffset = layer * 0.45;
      const layerScale = 1 + (layer - 1) * 0.12;
      const layerSpeed = this.time * (0.8 + layer * 0.2);

      const points = [];
      const pointsTotal = this.pointsCount;

      for (let i = 0; i < pointsTotal; i++) {
        const angle = (i / pointsTotal) * Math.PI * 2;
        
        // Multi-frequency harmonic displacement
        const harmonic1 = Math.sin(angle * 3 + layerSpeed + layerOffset);
        const harmonic2 = Math.cos(angle * 2 - layerSpeed * 1.3);
        const harmonic3 = Math.sin(angle * 4 + this.time * 1.8);

        // Audio reactivity perturbation
        let audioPerturbation = 0;
        if (this.botDataArray && this.botDataArray.length > 0) {
          const binIndex = (i * 3) % this.botDataArray.length;
          audioPerturbation += (this.botDataArray[binIndex] / 255) * 22;
        }
        if (this.micDataArray && this.micDataArray.length > 0) {
          const binIndex = (i * 2) % this.micDataArray.length;
          audioPerturbation += (this.micDataArray[binIndex] / 255) * 16;
        }

        const distortion = (harmonic1 * 6 + harmonic2 * 4 + harmonic3 * 3 + audioPerturbation) * (layer * 0.35);
        const r = (this.currentRadius * layerScale) + distortion;

        points.push({
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r
        });
      }

      // Render smooth spline through points
      this.drawSmoothClosedPath(ctx, points);

      if (layer === 1) {
        // Inner Core Gradient
        const coreGradient = ctx.createLinearGradient(
          centerX - this.currentRadius, centerY - this.currentRadius,
          centerX + this.currentRadius, centerY + this.currentRadius
        );
        coreGradient.addColorStop(0, palette.core1);
        coreGradient.addColorStop(1, palette.core2);
        ctx.fillStyle = coreGradient;
        ctx.fill();
      } else {
        ctx.fillStyle = layer === 2 ? palette.mantle : palette.corona;
        ctx.fill();
      }
    }
    ctx.restore();

    // 5. High-Luminance Center Specular Highlight
    const specularGrad = ctx.createRadialGradient(
      centerX - this.currentRadius * 0.3, centerY - this.currentRadius * 0.35, 2,
      centerX, centerY, this.currentRadius * 0.8
    );
    specularGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    specularGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.25)');
    specularGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.save();
    ctx.fillStyle = specularGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.currentRadius * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.animFrameId = requestAnimationFrame(() => this.render());
  }

  drawSmoothClosedPath(ctx, points) {
    if (points.length < 3) return;

    ctx.beginPath();
    const len = points.length;

    // Start at midpoint between last and first
    let xc = (points[len - 1].x + points[0].x) / 2;
    let yc = (points[len - 1].y + points[0].y) / 2;
    ctx.moveTo(xc, yc);

    for (let i = 0; i < len; i++) {
      const next = (i + 1) % len;
      xc = (points[i].x + points[next].x) / 2;
      yc = (points[i].y + points[next].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.closePath();
  }

  drawRipples(ctx, centerX, centerY, palette) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.radius += r.speed + this.combinedEnergy * 2;
      r.alpha -= 0.015;

      if (r.alpha <= 0 || r.radius >= r.maxRadius) {
        this.ripples.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.strokeStyle = palette.glow;
      ctx.globalAlpha = r.alpha;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx, centerX, centerY, palette) {
    ctx.save();
    ctx.fillStyle = palette.particles;

    for (let p of this.particles) {
      p.angle += p.speed * (1 + this.combinedEnergy * 3);
      const pulse = Math.sin(this.time * 3 + p.pulseOffset) * 4;
      const dist = p.distance + pulse + this.combinedEnergy * 18;

      const px = centerX + Math.cos(p.angle) * dist;
      const py = centerY + Math.sin(p.angle) * dist;

      ctx.globalAlpha = p.alpha * (0.4 + this.combinedEnergy * 0.6);
      ctx.beginPath();
      ctx.arc(px, py, p.size * (1 + this.combinedEnergy * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
