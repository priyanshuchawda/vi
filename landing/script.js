/* ── NAVBAR SCROLL EFFECT ── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

/* ── HAMBURGER MENU ── */
const hamburger = document.getElementById('hamburger');
const navLinks = document.querySelector('.nav-links');
const navCta = document.querySelector('.nav-cta');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  navCta.classList.toggle('open');
  const isOpen = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', isOpen);
  hamburger.querySelectorAll('span').forEach((span, i) => {
    if (isOpen) {
      if (i === 0) span.style.transform = 'translateY(7px) rotate(45deg)';
      if (i === 1) span.style.opacity = '0';
      if (i === 2) span.style.transform = 'translateY(-7px) rotate(-45deg)';
    } else {
      span.style.transform = '';
      span.style.opacity = '';
    }
  });
});

/* Close menu when a nav link is clicked */
document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navCta.classList.remove('open');
    hamburger.querySelectorAll('span').forEach((span) => {
      span.style.transform = '';
      span.style.opacity = '';
    });
  });
});

/* ── SMOOTH SCROLL for anchor links ── */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

/* ── SCROLL FADE-IN ANIMATIONS ── */
const fadeTargets = document.querySelectorAll(
  '.feature-card, .step-card, .download-card, .faq-item, .stat-item, .tech-badge, .section-header',
);

fadeTargets.forEach((el) => el.classList.add('fade-up'));

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, entry.target.dataset.delay || 0);
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
);

/* Stagger children within groups */
document
  .querySelectorAll('.features-grid, .download-cards, .faq-grid, .tech-logos, .stats-container')
  .forEach((group) => {
    group.querySelectorAll('.fade-up').forEach((el, i) => {
      el.dataset.delay = i * 80;
    });
  });

fadeTargets.forEach((el) => observer.observe(el));

/* ── PLATFORM AUTO-DETECT for hero CTAs ── */
function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform ? navigator.platform.toLowerCase() : '';

  if (ua.includes('win') || platform.includes('win')) return 'windows';
  if (ua.includes('linux') || platform.includes('linux')) return 'linux';
  return 'windows'; // Default to windows if not linux
}

window.addEventListener('DOMContentLoaded', () => {
  const platform = detectPlatform();
  const heroWinBtn = document.getElementById('hero-download-win');

  if (platform === 'linux') {
    heroWinBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download for Linux`;
    heroWinBtn.href = '#download'; // Scrolls to download section where both .AppImage and .deb are
  }
});

/* ── DOWNLOAD BUTTON CLICK TRACKING (console log only) ── */
document.querySelectorAll('[id^="dl-"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    console.log(`[QuickCut] Download initiated: ${btn.id}`);
  });
});

/* ── COUNTER ANIMATION for stats ── */
function animateCounter(el, target, duration = 1500) {
  const isText = isNaN(parseInt(target));
  if (isText) return;

  const start = 0;
  const numTarget = parseInt(target);
  const suffix = target.replace(/[0-9]/g, '');
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (numTarget - start) * eased);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

const statsObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const numEl = entry.target.querySelector('.stat-num');
        if (numEl) {
          const originalText = numEl.textContent.trim();
          animateCounter(numEl, originalText);
        }
        statsObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.5 },
);

document.querySelectorAll('.stat-item').forEach((el) => statsObserver.observe(el));

/* ── ACTIVE NAV LINK on scroll ── */
const sections = document.querySelectorAll('section[id]');
const navItems = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navItems.forEach((link) => {
          link.style.color = '';
          if (link.getAttribute('href') === `#${id}`) {
            link.style.color = 'var(--cyan)';
          }
        });
      }
    });
  },
  { threshold: 0.4 },
);

sections.forEach((section) => sectionObserver.observe(section));
