// ===== EKAM-AI - INTERACTIVE ANIMATIONS =====
document.addEventListener('DOMContentLoaded', () => {
    initCursorGlow();
    initParticles();
    initNeuralNetwork();
    initScrollAnimations();
    initNavbar();
    initCounters();
    initPipelineProgress();
    initMagneticButtons();
    initParallaxOrbs();
});

// ===== CURSOR GLOW =====
function initCursorGlow() {
    const glow = document.getElementById('cursorGlow');
    if (!glow) return;
    let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;
    document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
    function animate() {
        glowX += (mouseX - glowX) * 0.08;
        glowY += (mouseY - glowY) * 0.08;
        glow.style.left = glowX + 'px';
        glow.style.top = glowY + 'px';
        requestAnimationFrame(animate);
    }
    animate();
}

// ===== PARTICLES =====
function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.4;
            this.speedY = (Math.random() - 0.5) * 0.4;
            this.opacity = Math.random() * 0.4 + 0.1;
            this.color = Math.random() > 0.5 ? '0,245,212' : '123,97,255';
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
            if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color},${this.opacity})`;
            ctx.fill();
        }
    }

    const count = Math.min(60, Math.floor(window.innerWidth / 25));
    for (let i = 0; i < count; i++) particles.push(new Particle());

    function connectParticles() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 130) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0,245,212,${(1 - dist / 130) * 0.12})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => { p.update(); p.draw(); });
        connectParticles();
        requestAnimationFrame(animate);
    }
    animate();
}

// ===== NEURAL NETWORK CANVAS =====
function initNeuralNetwork() {
    const canvas = document.getElementById('neuralCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width, height;

    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        width = rect.width;
        height = rect.height;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create a beautiful orbiting particle system
    const orbitals = [];
    const centerX = () => width / 2;
    const centerY = () => height / 2;
    const numRings = 5;
    const particlesPerRing = 12;

    for (let r = 0; r < numRings; r++) {
        const radius = 50 + r * 40;
        const speed = (0.003 + Math.random() * 0.004) * (r % 2 === 0 ? 1 : -1);
        for (let p = 0; p < particlesPerRing; p++) {
            const angle = (Math.PI * 2 / particlesPerRing) * p + Math.random() * 0.5;
            orbitals.push({
                ring: r,
                radius: radius,
                angle: angle,
                speed: speed + (Math.random() - 0.5) * 0.001,
                size: 2 + Math.random() * 3,
                opacity: 0.4 + Math.random() * 0.6,
                pulseSpeed: 0.02 + Math.random() * 0.02,
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
    }

    // Floating data points
    const dataPoints = [];
    for (let i = 0; i < 30; i++) {
        dataPoints.push({
            x: Math.random() * 400 - 200,
            y: Math.random() * 400 - 200,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            size: 1 + Math.random() * 2,
            opacity: 0.2 + Math.random() * 0.4
        });
    }

    let frame = 0;

    function draw() {
        ctx.clearRect(0, 0, width, height);
        frame++;
        const cx = centerX();
        const cy = centerY();

        // Draw orbital rings (faint)
        for (let r = 0; r < numRings; r++) {
            const radius = 50 + r * 40;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 245, 212, ${0.04 + r * 0.01})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        // Draw connections between nearby orbitals
        for (let i = 0; i < orbitals.length; i++) {
            const a = orbitals[i];
            const ax = cx + Math.cos(a.angle) * a.radius;
            const ay = cy + Math.sin(a.angle) * a.radius;
            for (let j = i + 1; j < orbitals.length; j++) {
                const b = orbitals[j];
                if (Math.abs(a.ring - b.ring) > 1) continue;
                const bx = cx + Math.cos(b.angle) * b.radius;
                const by = cy + Math.sin(b.angle) * b.radius;
                const dx = ax - bx, dy = ay - by;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 80) {
                    ctx.beginPath();
                    ctx.moveTo(ax, ay);
                    ctx.lineTo(bx, by);
                    ctx.strokeStyle = `rgba(0, 245, 212, ${(1 - dist / 80) * 0.15})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        // Draw & update orbitals
        orbitals.forEach(o => {
            o.angle += o.speed;
            const x = cx + Math.cos(o.angle) * o.radius;
            const y = cy + Math.sin(o.angle) * o.radius;
            const pulse = Math.sin(frame * o.pulseSpeed + o.pulsePhase) * 0.4 + 0.6;
            const r = o.size * pulse;

            // Glow
            const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
            g.addColorStop(0, `rgba(0, 245, 212, ${0.3 * o.opacity * pulse})`);
            g.addColorStop(1, 'rgba(0, 245, 212, 0)');
            ctx.beginPath();
            ctx.arc(x, y, r * 4, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();

            // Core
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 245, 212, ${o.opacity * pulse})`;
            ctx.fill();
        });

        // Center core glow
        const coreSize = 15 + Math.sin(frame * 0.015) * 5;
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 3);
        coreGrad.addColorStop(0, 'rgba(0, 245, 212, 0.2)');
        coreGrad.addColorStop(0.5, 'rgba(123, 97, 255, 0.08)');
        coreGrad.addColorStop(1, 'rgba(0, 245, 212, 0)');
        ctx.beginPath();
        ctx.arc(cx, cy, coreSize * 3, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, coreSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 245, 212, 0.6)';
        ctx.fill();

        // Floating data points
        dataPoints.forEach(dp => {
            dp.x += dp.vx;
            dp.y += dp.vy;
            if (Math.abs(dp.x) > 200) dp.vx *= -1;
            if (Math.abs(dp.y) > 200) dp.vy *= -1;
            const px = cx + dp.x;
            const py = cy + dp.y;
            ctx.beginPath();
            ctx.arc(px, py, dp.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(123, 97, 255, ${dp.opacity * (0.5 + Math.sin(frame * 0.01) * 0.3)})`;
            ctx.fill();
        });

        requestAnimationFrame(draw);
    }
    draw();
}

// ===== SCROLL ANIMATIONS =====
function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

// ===== NAVBAR =====
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            hamburger.classList.toggle('active');
        });
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });
    }
}

// ===== COUNTERS =====
function initCounters() {
    const counters = document.querySelectorAll('[data-target]');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    counters.forEach(c => observer.observe(c));
}

function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-target'));
    const duration = 2000;
    const start = performance.now();

    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        let current = Math.floor(eased * target);

        // Format large numbers
        if (target >= 1000000) {
            el.textContent = (current / 1000000).toFixed(2);
        } else if (target >= 10000) {
            el.textContent = (current / 1000).toFixed(1);
        } else {
            el.textContent = current;
        }

        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

// ===== PIPELINE PROGRESS =====
function initPipelineProgress() {
    const pipeline = document.querySelector('.pipeline');
    const progress = document.getElementById('pipelineProgress');
    if (!pipeline || !progress) return;

    window.addEventListener('scroll', () => {
        const rect = pipeline.getBoundingClientRect();
        const wh = window.innerHeight;
        if (rect.top < wh && rect.bottom > 0) {
            const pct = Math.min(Math.max((wh - rect.top) / rect.height * 100, 0), 100);
            progress.style.height = pct + '%';
        }
    });
}

// ===== MAGNETIC BUTTONS =====
function initMagneticButtons() {
    document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const r = btn.getBoundingClientRect();
            const x = e.clientX - r.left - r.width / 2;
            const y = e.clientY - r.top - r.height / 2;
            btn.style.transform = `translate(${x * 0.08}px, ${y * 0.08}px)`;
        });
        btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
}

// ===== PARALLAX ORBS =====
function initParallaxOrbs() {
    document.addEventListener('mousemove', (e) => {
        const orbs = document.querySelectorAll('.orb');
        if (!orbs.length) return;
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        orbs.forEach((orb, i) => {
            const speed = (i + 1) * 8;
            orb.style.transform = `translate(${x * speed}px, ${y * speed}px)`;
        });
    });
}

// ===== BRAND GLOW EFFECT =====
const brand = document.querySelector('.brand-highlight');
if (brand) {
    setInterval(() => {
        brand.style.textShadow = `0 0 ${8 + Math.random() * 12}px rgba(0,245,212,${0.3 + Math.random() * 0.4})`;
    }, 150);
}
