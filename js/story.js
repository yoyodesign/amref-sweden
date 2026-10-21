// Scroll text effect using GSAP and ScrollTrigger
gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin);

function initHighlightText() {
  let splitHeadingTargets = document.querySelectorAll('[data-highlight-text]');
  splitHeadingTargets.forEach((heading) => {
    const scrollStart = heading.getAttribute('data-highlight-scroll-start') || 'top 50%';
    const scrollEnd = heading.getAttribute('data-highlight-scroll-end') || 'bottom 50%';
    const scrubValue = Number(heading.getAttribute('data-highlight-scrub') || 1.5);
    const fadedValue = heading.getAttribute('data-highlight-fade') || 0.2;
    const staggerValue = heading.getAttribute('data-highlight-stagger') || 0.75;

    new SplitText(heading, {
      type: 'words, chars',
      autoSplit: true,
      onSplit(self) {
        let ctx = gsap.context(() => {
          let tl = gsap.timeline({
            scrollTrigger: {
              scrub: scrubValue,
              trigger: heading,
              start: scrollStart,
              end: scrollEnd,
            },
          });
          tl.from(self.chars, {
            color: getComputedStyle(document.documentElement)
              .getPropertyValue('--story-accent')
              .trim(),
            stagger: staggerValue,
            ease: 'power2.out',
          });
        });
        return ctx;
      },
    });
  });
}

function initDrawPatternOnScroll() {
  let svgPathTargets = document.querySelectorAll('[data-draw-path-scroll]');
  svgPathTargets.forEach((path) => {
    const scrollStart = path.getAttribute('data-draw-scroll-start') || 'top 80%';
    const scrollEnd = path.getAttribute('data-draw-scroll-end') || 'bottom 20%';
    const triggerEl = path.closest('section') || path;

    gsap.fromTo(
      path,
      { drawSVG: '0%', opacity: 1 },
      {
        drawSVG: '100%',
        ease: 'power2.out',
        scrollTrigger: {
          scrub: true,
          trigger: triggerEl,
          start: scrollStart,
          end: scrollEnd,
          once: true,
        },
      },
    );
  });
}

function initDrawPatternOnEnter() {
  const drawSpeed = 300;

  let svgPathTargets = document.querySelectorAll('[data-draw-path-enter]');
  svgPathTargets.forEach((path) => {
    const scrollStart = path.getAttribute('data-draw-enter-start') || 'top 85%';
    let durationValue = Number(path.getAttribute('data-draw-enter-duration')) || 4;
    if (path.closest('.story-hero__lines')) {
      durationValue = path.getTotalLength() / drawSpeed;
    }
    const triggerEl = path;

    gsap.fromTo(
      path,
      { drawSVG: '0%', opacity: 1 },
      {
        drawSVG: '100%',
        duration: durationValue,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: triggerEl,
          start: scrollStart,
          once: true,
        },
      },
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Skip the scroll-driven highlight and line-draw effects; the decorative
    // paths are hidden in CSS until GSAP reveals them, so show them fully drawn.
    gsap.set('[data-draw-path-scroll], [data-draw-path-enter]', { opacity: 1 });
  } else {
    initHighlightText();
    initDrawPatternOnScroll();
    initDrawPatternOnEnter();
  }

  // At mobile the desktop SVG is hidden — pick whichever is currently visible.
  const storyHeroLinesSvg =
    Array.from(document.querySelectorAll('.story-hero__lines')).find(
      (el) => getComputedStyle(el).display !== 'none',
    ) || null;
  const storyHeroMedia = document.querySelector('.story-hero__media');
  const storyHeroVideo = storyHeroMedia ? storyHeroMedia.querySelector('video.hero__video') : null;
  const storyHeroEmbed = storyHeroMedia
    ? storyHeroMedia.querySelector('.hero__video--youtube')
    : null;
  const storyHeroPlay = storyHeroMedia ? storyHeroMedia.querySelector('.story-hero__play') : null;

  if (storyHeroMedia) {
    storyHeroMedia.addEventListener(
      'animationend',
      function (e) {
        if (e.animationName === 'story-media-reveal') {
          storyHeroMedia.style.animation = 'none';
        }
      },
      { once: true },
    );
  }

  // When resizing across the 540px breakpoint, the CSS swaps which hero SVG
  // is visible but opacity:0 was only cleared on the SVG that was visible at
  // DOMContentLoaded — so restore opacity on the newly revealed one.
  window.matchMedia('(max-width: 540px)').addEventListener('change', function () {
    document.querySelectorAll('.story-hero__lines').forEach(function (svg) {
      if (getComputedStyle(svg).display !== 'none') {
        gsap.set(svg, { opacity: 1 });
      }
    });
  });

  if (storyHeroLinesSvg) {
    // Reveal the SVG — starts opacity:0 in CSS to prevent flash on load.
    gsap.set(storyHeroLinesSvg, { opacity: 1 });
  }

  if (storyHeroMedia && storyHeroVideo) {
    const playHeroVideo = () => {
      if (!storyHeroVideo.paused) return;
      storyHeroMedia.classList.add('is-clicked');
      storyHeroVideo.controls = true;
      const done = () => {
        storyHeroMedia.classList.add('is-playing');
        storyHeroMedia.removeEventListener('click', playHeroVideo);
      };
      const playPromise = storyHeroVideo.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => setTimeout(done, 300)).catch(() => {});
      } else {
        setTimeout(done, 300);
      }
    };

    storyHeroMedia.addEventListener('click', playHeroVideo);

    if (storyHeroPlay) {
      storyHeroPlay.addEventListener('click', function (event) {
        event.stopPropagation();
        playHeroVideo();
      });
    }
  }

  if (storyHeroMedia && storyHeroEmbed) {
    const playHeroEmbed = () => {
      if (storyHeroMedia.classList.contains('is-playing')) return;
      storyHeroMedia.classList.add('is-clicked');
      const embedSrc = storyHeroEmbed.getAttribute('data-embed-src');
      if (embedSrc) {
        storyHeroEmbed.src = embedSrc;
      }
      setTimeout(() => {
        storyHeroMedia.classList.add('is-playing');
        storyHeroMedia.removeEventListener('click', playHeroEmbed);
      }, 300);
    };

    storyHeroMedia.addEventListener('click', playHeroEmbed);

    if (storyHeroPlay) {
      storyHeroPlay.addEventListener('click', function (event) {
        event.stopPropagation();
        playHeroEmbed();
      });
    }
  }
});
