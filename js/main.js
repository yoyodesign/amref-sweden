/*
  AMREF Health Africa — 2025 Impact Microsite
  main.js — Step 1: structural setup, no animations
*/

(function () {
  'use strict';

  /* ── Menu toggle + focus trap ───────────────────────────── */
  const menuBtn = document.querySelector('.site-nav__menu');
  const siteMenu = document.getElementById('site-menu');

  /* ── Menu sizing: scale the story links to fit any number of stories ──
     Sets --menu-count / --menu-rows (used by the CSS font-size fit) and an
     --i index per item for the staggered reveal.  Past MENU_COLUMNS_AFTER
     stories the links switch to two columns so the text stays readable. */
  var MENU_COLUMNS_AFTER = 8;
  (function sizeMenu() {
    var list = siteMenu && siteMenu.querySelector('.site-menu__links');
    if (!list) return;
    var items = list.querySelectorAll('li');
    var count = items.length;
    var columns = count > MENU_COLUMNS_AFTER;
    siteMenu.style.setProperty('--menu-count', count);
    list.style.setProperty('--menu-rows', columns ? Math.ceil(count / 2) : count);
    list.classList.toggle('site-menu__links--columns', columns);
    items.forEach(function (li, i) {
      li.style.setProperty('--i', i);
    });
  })();
  var savedScrollY = 0;

  /* Move focus programmatically without showing a focus ring — used when
     we shift focus ourselves (open/close) rather than the user tabbing,
     so mobile/touch users don't see a ring flash as if Tab was pressed.
     The suppressing class is removed on blur so keyboard users still get
     a normal ring on any focus they trigger themselves afterwards. */
  function focusWithoutRing(el) {
    if (!el) return;
    el.classList.add('js-focus-noring');
    /* rAF ensures the browser repaints with the suppressing class applied
       before :focus-visible is evaluated — needed on iOS Safari where
       adding a class and calling .focus() in the same tick isn't enough. */
    requestAnimationFrame(function () {
      el.focus({ preventScroll: true });
      el.addEventListener('blur', function handler() {
        el.removeEventListener('blur', handler);
        el.classList.remove('js-focus-noring');
      });
    });
  }

  function getFocusable() {
    return Array.from(
      siteMenu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter(function (el) {
      return !el.closest('[hidden]');
    });
  }

  function openMenu() {
    savedScrollY = window.pageYOffset;
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', 'Close navigation menu');
    siteMenu.classList.add('is-open');
    siteMenu.removeAttribute('aria-hidden');
    siteMenu.removeAttribute('inert');
    siteMenu.hidden = false;
    document.body.classList.add('menu-is-open');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.width = '100%';
    /* Focus is not moved to the first link on open — doing so triggered
       iOS Safari's :focus-visible colour change on Coumba's link, making it
       appear in its accent colour as if hovered/selected. Keyboard users can
       Tab into the menu naturally; inert has been removed so the links are
       fully reachable. */
  }

  function closeMenu() {
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Open navigation menu');
    siteMenu.classList.remove('is-open'); /* start wipe */
    siteMenu.setAttribute('aria-hidden', 'true');
    siteMenu.setAttribute('inert', ''); /* pull from tab order immediately */
    focusWithoutRing(menuBtn);
    /* Snap nav back at 300ms — while top of screen still has red covering it.
       Adjust this value: lower = snaps sooner, higher = snaps later (max 350ms). */
    setTimeout(function () {
      document.body.classList.remove('menu-is-open');
    }, 200);
    /* Hide + restore scroll when wipe fully completes */
    siteMenu.addEventListener('transitionend', function handler(e) {
      if (e.propertyName !== 'clip-path') return;
      siteMenu.removeEventListener('transitionend', handler);
      siteMenu.hidden = true;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    });
  }

  if (menuBtn && siteMenu) {
    /* Suppress the focus ring when the menu button is tapped — pointerdown
       fires before the browser's focus event, so the class is already
       present when iOS Safari evaluates :focus-visible from the tap. */
    menuBtn.addEventListener('pointerdown', function () {
      menuBtn.classList.add('js-focus-noring');
      menuBtn.addEventListener('blur', function handler() {
        menuBtn.removeEventListener('blur', handler);
        menuBtn.classList.remove('js-focus-noring');
      });
    }, { passive: true });

    /* Suppress the focus ring on any menu link/button tapped by the user —
       iOS Safari fires :focus-visible on tap, so we intercept pointerdown
       (which fires before focus) and pre-apply the suppressing class to
       whichever element is about to receive focus from the tap. */
    siteMenu.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('a, button');
      if (!el) return;
      el.classList.add('js-focus-noring');
      el.addEventListener('blur', function handler() {
        el.removeEventListener('blur', handler);
        el.classList.remove('js-focus-noring');
      });
    }, { passive: true });

    menuBtn.addEventListener('click', function () {
      if (this.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      } else {
        openMenu();
      }
    });

    siteMenu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
        return;
      }
      if (e.key !== 'Tab') return;

      var focusable = getFocusable();
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          menuBtn.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          menuBtn.focus();
        }
      }
    });

    menuBtn.addEventListener('keydown', function (e) {
      if (menuBtn.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') {
        closeMenu();
        return;
      }
      if (e.key !== 'Tab') return;

      var focusable = getFocusable();
      if (!focusable.length) return;

      if (e.shiftKey) {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      } else {
        e.preventDefault();
        focusable[0].focus();
      }
    });
  }

  /* ── Nav height CSS variable ── */
  const siteNav = document.querySelector('.site-nav');
  function setNavHeight() {
    if (siteNav) {
      document.documentElement.style.setProperty('--nav-h', siteNav.offsetHeight + 'px');
    }
  }
  setNavHeight();
  window.addEventListener('resize', setNavHeight, { passive: true });

  /* ── BFCache focus fix ──
     iOS Safari restores the last focused element when navigating back via the
     back-forward cache (e.g. tap Coumba's story → back → reopen menu → link
     appears purple). Blurring on pageshow prevents the restored :focus-visible
     state from showing the accent colour on the link. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  });

  /* ── Smooth back-to-top ── */
  const backTopLinks = document.querySelectorAll('a[href="#top"]');
  backTopLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.focus();
    });
  });
})();

/* ── Nav scroll-hide ── */
(function () {
  var nav = document.querySelector('.site-nav');
  var lastY = 0;
  var ticking = false;
  var NAV_H = nav ? nav.offsetHeight : 80;

  window.addEventListener(
    'scroll',
    function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          if (document.body.classList.contains('menu-is-open')) {
            ticking = false;
            return;
          }
          var y = window.pageYOffset;
          if (y > lastY && y > NAV_H) {
            nav.style.transitionDuration = '';
            nav.classList.add('site-nav--hidden');
          } else if (y < lastY) {
            nav.style.transition = 'transform 0.30s ease';
            nav.classList.remove('site-nav--hidden');
          }
          lastY = y;
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true },
  );
})();

/* ── Hero video pause toggle ── */
(function () {
  var video = document.querySelector('.hero__video');
  var btn = document.querySelector('.hero__video-toggle');
  if (!video || !btn) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.pause();
    btn.hidden = true;
    return;
  }

  btn.addEventListener('click', function () {
    if (video.paused) {
      video.play();
      btn.setAttribute('aria-label', 'Pause background video');
      btn.classList.remove('is-paused');
    } else {
      video.pause();
      btn.setAttribute('aria-label', 'Play background video');
      btn.classList.add('is-paused');
    }
  });
})();
