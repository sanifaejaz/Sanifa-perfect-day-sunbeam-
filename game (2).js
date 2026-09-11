/* ==========================================================================
   game.js — Catch the good stuff

   You're a jar. Nice things fall out of the sky, grotty things also fall
   out of the sky, and three grotty things ends your day.

   TWO THINGS WORTH KNOWING

   1. Everything is drawn with emoji, via ctx.fillText('🌻', x, y). No
      image files, no sprite sheets. It's by far the easiest way to make a
      canvas game look good, and it costs nothing to add a new item.

   2. The game reads its colours off the page. The sky behind the canvas
      is a CSS gradient using the current day's variables, and the glows
      and sparkles read those same variables — so picking "starry" up in
      the day picker recolours the game too, for free.

     1. Setup
     2. Sizing
     3. Sound
     4. What falls
     5. State
     6. Input
     7. Start / pause / game over
     8. The loop
     9. Drawing
    10. Buttons
   ========================================================================== */

(function () {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  const ctx        = canvas.getContext('2d');
  const canvasWrap = document.getElementById('canvasWrap');

  const scoreEl     = document.getElementById('gameScore');
  const comboEl     = document.getElementById('gameCombo');
  const levelEl     = document.getElementById('gameLevel');
  const bestEl      = document.getElementById('gameBest');
  const livesEl     = document.getElementById('gameLives');
  const bestComboEl = document.getElementById('gameBestCombo');
  const powerupBar  = document.getElementById('powerupBar');
  const bannerEl    = document.getElementById('levelBanner');

  const overlayEl      = document.getElementById('gameOverlay');
  const overlayTitleEl = document.getElementById('overlayTitle');
  const overlayTextEl  = document.getElementById('overlayText');
  const overlayFootEl  = document.getElementById('overlayFoot');
  const legendEl       = document.getElementById('powerupLegend');
  const playBtn        = document.getElementById('playBtn');
  const soundBtn       = document.getElementById('soundBtn');
  const pauseBtn       = document.getElementById('pauseBtn');

  const likesMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Own storage helpers. game.js sits inside an IIFE so these can't clash
     with script.js's, and it means the game doesn't depend on load order. */
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (err) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* fine */ }
  }


  /* ========================================================================
     1. SETUP

     Every knob that shapes the difficulty is here.
     Easier game? Lower baseFallSpeed or raise catchRadius.
     ======================================================================== */
  const settings = {
    jarWidth:       84,
    jarHeight:      70,
    jarEase:        0.18,  /* how fast the jar catches up to the pointer  */
    keySpeed:       660,   /* px/sec on the arrow keys                    */

    itemSize:       40,
    baseFallSpeed:  150,   /* px/sec at the start                         */
    speedPerPoint:  1.9,   /* extra fall speed per point scored           */
    baseSpawnGap:   820,   /* ms between items at the start               */
    minSpawnGap:    320,   /* the fastest it will ever spawn              */

    startLives:     3,
    maxLives:       5,     /* 💗 can't take you above this                 */
    catchRadius:    50,    /* how close to the jar counts as "caught"     */

    pointsPerLevel: 25,
    comboPerStep:   4,     /* catches per +1 on the multiplier            */
    maxMultiplier:  5,

    slowFactor:     0.45,  /* how much ⏳ slows everything                 */
    magnetPull:     280,   /* how hard 🧲 drags good things sideways       */
    powerupGapMin:  7000,
    powerupGapMax:  13000,

    starPer:        20,    /* points per real ⭐ handed to the jar         */
    motes:          30,
  };


  /* ========================================================================
     2. SIZING

     A canvas has two sizes: how big it looks (CSS) and how many pixels it
     paints (the drawing buffer). If they don't match, the picture
     stretches. fitCanvas copies one onto the other whenever the box
     changes.

     Every size above is in "design pixels" and goes through px(), which
     scales it for the real canvas. Without that, a 40px sunflower would
     fill a third of a phone and look like a speck on a desktop — same
     game, completely different difficulty.
     ======================================================================== */
  let sizeScale = 1;
  const px = (n) => n * sizeScale;

  const groundY = () => canvas.height - px(16);

  function fitCanvas() {
    const box = canvasWrap.getBoundingClientRect();
    if (!box.width) return;

    /* Cap the pixel ratio: a 3× phone screen triples the fill cost for a
       difference nobody can see on a canvas this size. */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width  = Math.round(box.width  * dpr);
    canvas.height = Math.round(box.height * dpr);

    /* 900 is the width every number above was chosen against */
    sizeScale = canvas.width / 900;

    if (state) {
      state.jarX    = Math.min(state.jarX,    canvas.width);
      state.targetX = Math.min(state.targetX, canvas.width);
    }
  }


  /* ------------------------------------------------------------------------
     Colours come from the page, so the game is lit by whatever day the
     visitor picked. Read once and cached — getComputedStyle is a layout
     read and doing it every frame would be the most expensive thing here.
     ------------------------------------------------------------------------ */
  let palette = {};

  function readPalette() {
    const css = getComputedStyle(document.documentElement);
    const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    palette = {
      light:  get('--sun-core', '#FFFBE0'),
      glow:   get('--sun-glow', '#FFD34E'),
      accent: get('--accent',   '#FF5FA2'),
      accent2:get('--accent-2', '#FFC93C'),
      ink:    get('--ink',      '#4A3358'),
      cream:  get('--cream',    '#FFF9F0'),
    };
  }
  readPalette();

  /* Re-read whenever either dial moves. Only the day owns the colours the
     game actually uses today, but watching both means the game cannot drift
     out of sync if a season ever starts setting one of them. */
  new MutationObserver(readPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-time', 'data-weather', 'data-season'],
  });


  /* ========================================================================
     3. SOUND

     Short tones built on the fly — no audio files. Kept in its own
     AudioContext so the game's 🔊 is independent of the page's ambience
     mixer: muting one shouldn't mute the other.

     The catch note comes from a major pentatonic scale, which has no
     semitone steps in it — so no two notes it can play will ever clash,
     and a long combo climbing the scale always sounds better rather than
     just faster.
     ======================================================================== */
  const PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
  const BASE_HZ = 261.63;   /* middle C */

  let audio = null;
  let soundOn = load('mpd_gamesound', 'yes') === 'yes';

  function audioCtx() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audio = new AC(); } catch (err) { return null; }
    return audio;
  }

  /* one bell. Two slightly detuned sine voices beating against each other
     is what makes it sound struck rather than beeped. */
  function bell(step, gain = 0.14) {
    if (!soundOn) return;
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();

    const octave = Math.floor(step / PENTATONIC.length);
    const hz = BASE_HZ * PENTATONIC[step % PENTATONIC.length] * Math.pow(2, octave);

    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(ac.destination);

    [1, 1.004].forEach((detune, i) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz * detune;
      const g = ac.createGain();
      g.gain.value = i ? 0.4 : 1;
      osc.connect(g).connect(out);
      osc.start();
      osc.stop(ac.currentTime + 1.4);
    });

    /* fast attack, long release — a struck bell, not a held note */
    const t = ac.currentTime;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  }

  /* a rude buzz for taking a hit */
  function buzz() {
    if (!soundOn) return;
    const ac = audioCtx();
    if (!ac) return;

    const osc = ac.createOscillator();
    osc.type = 'square';
    const g = ac.createGain();
    g.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    osc.connect(lp).connect(g).connect(ac.destination);

    const t = ac.currentTime;
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.26);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc.start(t);
    osc.stop(t + 0.34);
  }

  /* a little rising arpeggio for a power-up */
  function sparkleSound() {
    if (!soundOn) return;
    [0, 2, 4, 6].forEach((step, i) => setTimeout(() => bell(step + 5, 0.1), i * 70));
  }

  /* a descending sad-trombone-ish run for game over */
  function gameOverSound() {
    if (!soundOn) return;
    [7, 5, 3, 0].forEach((step, i) => setTimeout(() => bell(step, 0.13), i * 170));
  }

  function paintSoundBtn() {
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.title = soundOn ? 'Game sound on' : 'Game sound off';
  }


  /* ========================================================================
     4. WHAT FALLS

     `points: 0` means it's a baddie. `weight` is how often it turns up —
     bigger number, more common.
     ======================================================================== */
  const itemTypes = [
    { emoji: '🌻', points: 1,  weight: 26 },   /* the everyday one          */
    { emoji: '🍀', points: 2,  weight: 16 },
    { emoji: '🦋', points: 3,  weight: 12 },
    { emoji: '🍎', points: 4,  weight: 8  },
    { emoji: '🌈', points: 6,  weight: 4  },
    { emoji: '🌟', points: 10, weight: 2  },   /* the whole point           */
    { emoji: '🐝', points: 0,  weight: 16 },   /* wasp. bad!                */
    { emoji: '🌩️', points: 0,  weight: 8  },   /* storm cloud. also bad!    */
  ];

  /* Power-ups get their own spawn timer so they stay special instead of
     being drowned out by all the sunflowers. */
  const powerupTypes = [
    { key: 'magnet', emoji: '🧲', label: 'magnet',  seconds: 6, weight: 5 },
    { key: 'shield', emoji: '🛡️', label: 'shield',  seconds: 0, weight: 5 },
    { key: 'slow',   emoji: '⏳', label: 'slow-mo', seconds: 5, weight: 4 },
    { key: 'double', emoji: '💎', label: '2×',      seconds: 8, weight: 4 },
    { key: 'heart',  emoji: '💗', label: '+life',   seconds: 0, weight: 3 },
  ];

  function pickWeighted(list) {
    const total = list.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * total;
    for (const t of list) {
      roll -= t.weight;
      if (roll <= 0) return t;
    }
    return list[0];
  }


  /* ========================================================================
     5. STATE
     ======================================================================== */
  let state = null;

  /* Background motes, stored as FRACTIONS of the canvas rather than
     pixels, so a resize moves them with the box instead of bunching them
     in one corner. */
  function makeMotes() {
    return Array.from({ length: settings.motes }, () => ({
      fx:    Math.random(),
      fy:    Math.random(),
      size:  0.9 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.04 + Math.random() * 0.12,
    }));
  }

  /* The power-up chips on screen, keyed by name. Declared up here because
     reset() clears them and reset() runs immediately below — a const
     further down the file wouldn't exist yet. */
  const chips = {};

  function clearChips() {
    powerupBar.innerHTML = '';
    Object.keys(chips).forEach((k) => delete chips[k]);
  }

  function reset() {
    /* match the canvas to its box first, so the sizes below are right.
       On the very first call `state` is null, which fitCanvas checks. */
    fitCanvas();

    state = {
      phase:   'ready',           /* ready | playing | paused | over */
      jarX:    canvas.width / 2,
      targetX: canvas.width / 2,

      items:     [],
      particles: [],
      pops:      [],
      motes:     makeMotes(),

      score:     0,
      lives:     settings.startLives,
      level:     1,
      combo:     0,
      bestCombo: 0,
      awarded:   0,               /* real ⭐ already handed over */

      /* The score to beat, frozen when the run starts - set in start()
         rather than here, because reset() also runs once at load, before
         `best` has been read out of storage. */
      bestAtStart: 0,

      spawnTimer:   0,
      powerupTimer: settings.powerupGapMin,
      hurtTimer:    0,
      catchTimer:   0,
      glow:         0,
      time:         0,

      timers:  { magnet: 0, slow: 0, double: 0 },
      shields: 0,                 /* 🛡️ is a charge, not a timer */
    };

    clearChips();
  }
  reset();

  /* records that survive between visits */
  let best      = Number(load('mpd_best', 0)) || 0;
  let bestCombo = Number(load('mpd_bestcombo', 0)) || 0;
  let hasPlayed = load('mpd_played', 'no') === 'yes';

  function multiplier() {
    const base = Math.min(
      settings.maxMultiplier,
      1 + Math.floor(state.combo / settings.comboPerStep)
    );
    return state.timers.double > 0 ? base * 2 : base;
  }

  function fallSpeed() {
    return settings.baseFallSpeed + state.score * settings.speedPerPoint;
  }

  function spawnGap() {
    return Math.max(settings.minSpawnGap,
      settings.baseSpawnGap - state.score * 3.4);
  }

  function paintHud() {
    scoreEl.textContent     = String(state.score);
    levelEl.textContent     = String(state.level);
    bestEl.textContent      = String(best);
    bestComboEl.textContent = String(bestCombo);

    const mult = multiplier();
    comboEl.textContent = `x${mult}`;
    comboEl.classList.toggle('hot', mult > 1);

    /* hearts, plus a ring for each shield charge */
    livesEl.textContent =
      '💗'.repeat(Math.max(0, state.lives)) + '🛡️'.repeat(state.shields);
  }

  function kickCombo() {
    if (!likesMotion) return;
    comboEl.classList.remove('kick');
    void comboEl.offsetWidth;      /* force a reflow so it replays */
    comboEl.classList.add('kick');
  }


  /* --- power-up chips --- */
  function addChip(type) {
    if (!type.seconds) return;     /* shield and hearts aren't timed */

    let chip = chips[type.key];
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'powerup-chip';
      chip.innerHTML =
        `<b>${type.emoji}</b> ${type.label}<span class="powerup-chip-bar"></span>`;
      powerupBar.appendChild(chip);
      chips[type.key] = chip;
    }
    chip.dataset.total = String(type.seconds);
  }

  function paintChips() {
    Object.keys(chips).forEach((key) => {
      const chip = chips[key];
      const left = state.timers[key] || 0;
      if (left <= 0) {
        chip.remove();
        delete chips[key];
        return;
      }
      const total = Number(chip.dataset.total) || 1;
      const bar = chip.querySelector('.powerup-chip-bar');
      if (bar) bar.style.width = `${(left / total) * 100}%`;
    });
  }


  /* ========================================================================
     6. INPUT
     ======================================================================== */
  const keys = { left: false, right: false };

  /* Turn a page coordinate into a canvas coordinate. The canvas is scaled
     by CSS, so a click 100px across the element is not 100px across the
     drawing buffer. */
  function canvasX(clientX) {
    const box = canvas.getBoundingClientRect();
    return ((clientX - box.left) / box.width) * canvas.width;
  }

  canvasWrap.addEventListener('mousemove', (e) => {
    if (state.phase === 'playing') state.targetX = canvasX(e.clientX);
  });

  canvasWrap.addEventListener('touchmove', (e) => {
    if (state.phase !== 'playing') return;
    e.preventDefault();
    state.targetX = canvasX(e.touches[0].clientX);
  }, { passive: false });

  canvasWrap.addEventListener('touchstart', (e) => {
    if (state.phase === 'playing') state.targetX = canvasX(e.touches[0].clientX);
  }, { passive: true });

  /* Is the game actually on screen? Space and the arrows should still
     scroll the page everywhere else — stealing them globally is rude. */
  function isOnScreen() {
    const box = canvasWrap.getBoundingClientRect();
    return box.top < window.innerHeight * 0.75 && box.bottom > 0;
  }

  window.addEventListener('keydown', (e) => {
    if (!isOnScreen()) return;

    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();

    if (e.key === 'p' || e.key === 'P') togglePause();

    if (e.key === ' ') {
      e.preventDefault();
      if (state.phase === 'ready' || state.phase === 'over') start();
      else togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });


  /* ========================================================================
     7. START / PAUSE / GAME OVER
     ======================================================================== */
  function start() {
    reset();
    state.phase = 'playing';

    /* `best` climbs during play, so comparing the final score against it at
       game over would call every single run a new record. Freeze it here. */
    state.bestAtStart = best;

    overlayEl.classList.add('hidden');
    if (legendEl) legendEl.style.display = '';

    if (!hasPlayed) {
      hasPlayed = true;
      save('mpd_played', 'yes');
      if (window.addStars) window.addStars(1, '+1 ⭐ · first go!');
    }
    paintHud();
  }

  function togglePause() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      overlayTitleEl.textContent = 'paused ⏸';
      overlayTextEl.innerHTML =
        'Take your time — nothing is falling.<br /><b>P</b> or the button to carry on.';
      playBtn.textContent = '▶ carry on';
      if (legendEl) legendEl.style.display = 'none';
      if (overlayFootEl) overlayFootEl.textContent = 'the jar will wait';
      overlayEl.classList.remove('hidden');
    } else if (state.phase === 'paused') {
      state.phase = 'playing';
      overlayEl.classList.add('hidden');
    }
  }

  /* Fun messages, so the end of a run isn't a scolding. */
  const OVER_LINES = [
    { at: 0,   title: 'oh no 🐝',       text: 'The wasps got you. It happens to everyone.' },
    { at: 20,  title: 'not bad! 🌻',    text: 'A respectable jarful. The bees are pleased.' },
    { at: 60,  title: 'good day! 🍀',   text: 'That is a genuinely good haul of nice things.' },
    { at: 120, title: 'brilliant! 🌈',  text: 'You have gathered a frankly excessive amount of joy.' },
    { at: 220, title: 'incredible! 👑', text: 'Sunflower royalty. Somebody give this jar a medal.' },
  ];

  function gameOver() {
    state.phase = 'over';
    gameOverSound();

    /* the last band whose threshold the score cleared */
    const band = OVER_LINES.filter((l) => state.score >= l.at).pop();

    const isBest = state.score > 0 && state.score > state.bestAtStart;

    overlayTitleEl.textContent = band.title;
    overlayTextEl.innerHTML =
      `${band.text}<br /><b>${state.score}</b> caught · longest chain ` +
      `<b>${state.bestCombo}</b>${isBest ? ' · <b>new best!</b> 🏆' : ''}`;
    playBtn.textContent = '↻ go again';
    if (legendEl) legendEl.style.display = 'none';
    if (overlayFootEl) overlayFootEl.textContent = 'space or the button to restart';
    overlayEl.classList.remove('hidden');

    if (isBest && state.score > 0) {
      if (window.confetti) window.confetti(50);
      if (window.addStars) window.addStars(1, '+1 ⭐ · new high score!');
    }
    paintHud();
  }


  /* ========================================================================
     8. THE LOOP
     ======================================================================== */

  /* Hand whole ⭐ to the page's jar as the score passes each threshold.
     Tracked with a counter rather than compared against the score, so a
     multiplier that jumps the score by 20 in one go can't skip an award. */
  function awardStars() {
    const owed = Math.floor(state.score / settings.starPer);
    while (state.awarded < owed) {
      state.awarded += 1;
      if (window.addStars) window.addStars(1, '+1 ⭐ · from the game!');
    }
  }

  function makeFaller(emoji, points, power) {
    return {
      emoji, points, power,
      x:      px(36) + Math.random() * (canvas.width - px(72)),
      y:      -px(settings.itemSize),
      speed:  px(fallSpeed() * (0.85 + Math.random() * 0.3)),
      angle:  0,
      spin:   (Math.random() - 0.5) * 1.6,
      /* a gentle sideways sway, so nothing falls in a dead straight line */
      phase:  Math.random() * Math.PI * 2,
      sway:   px(10 + Math.random() * 16),
      fade:   1,
      caught: false,
    };
  }

  function spawnItem() {
    const type = pickWeighted(itemTypes);
    state.items.push(makeFaller(type.emoji, type.points, null));
  }

  function spawnPowerup() {
    const type = pickWeighted(powerupTypes);
    state.items.push(makeFaller(type.emoji, 0, type));
  }

  function applyPowerup(type) {
    sparkleSound();

    if (type.key === 'shield') {
      state.shields += 1;
    } else if (type.key === 'heart') {
      if (state.lives < settings.maxLives) state.lives += 1;
    } else {
      state.timers[type.key] = type.seconds;
      addChip(type);
    }

    state.pops.push({
      x: state.jarX, y: groundY() - px(90),
      text: type.label, age: 0, life: 1.3, big: true,
    });
    paintHud();
  }

  function burst(x, y, colour, count = 14) {
    if (!likesMotion) return;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const speed = px(50 + Math.random() * 120);
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - px(40),
        life: 0.45 + Math.random() * 0.5,
        age: 0,
        size: px(1.8 + Math.random() * 3),
        colour,
      });
    }
  }

  function levelUp() {
    state.level += 1;
    levelEl.textContent = String(state.level);
    bannerEl.textContent = `level ${state.level}! 🎉`;
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    bell(9, 0.13);
  }

  function hit() {
    /* a shield eats the hit instead of a heart */
    if (state.shields > 0) {
      state.shields -= 1;
      bell(2, 0.1);
      burst(state.jarX, groundY() - px(40), palette.accent2, 18);
      paintHud();
      return;
    }

    state.lives -= 1;
    state.combo = 0;
    state.hurtTimer = 0.4;
    buzz();

    if (likesMotion) {
      canvasWrap.classList.remove('shake');
      void canvasWrap.offsetWidth;
      canvasWrap.classList.add('shake');
      setTimeout(() => canvasWrap.classList.remove('shake'), 420);
    }

    paintHud();
    if (state.lives <= 0) gameOver();
  }

  function update(dt) {
    /* ⏳ slows the whole world, spawn timers included */
    const slow = state.timers.slow > 0 ? settings.slowFactor : 1;
    const sdt = dt * slow;

    state.time += dt;
    state.glow = Math.max(0, state.glow - dt * 2);
    state.hurtTimer = Math.max(0, state.hurtTimer - dt);
    state.catchTimer = Math.max(0, state.catchTimer - dt);

    /* tick the timed power-ups down in real time, not slowed time —
       otherwise ⏳ would extend itself */
    let chipsChanged = false;
    Object.keys(state.timers).forEach((key) => {
      if (state.timers[key] > 0) {
        state.timers[key] = Math.max(0, state.timers[key] - dt);
        chipsChanged = true;
      }
    });
    if (chipsChanged) paintChips();

    /* --- the jar ---
       Keyboard moves the target; the jar then eases towards it, so mouse
       and keyboard feel the same. */
    if (keys.left)  state.targetX -= px(settings.keySpeed) * dt;
    if (keys.right) state.targetX += px(settings.keySpeed) * dt;

    const half = px(settings.jarWidth) / 2;
    state.targetX = Math.max(half, Math.min(canvas.width - half, state.targetX));

    /* Frame-rate independent easing. A plain `x += (target - x) * k`
       moves further per second on a 144Hz screen than on a 60Hz one;
       raising the remainder to the power of dt makes the approach take
       the same real time on any display. */
    const k = 1 - Math.pow(1 - settings.jarEase, dt * 60);
    state.jarX += (state.targetX - state.jarX) * k;

    /* --- spawning --- */
    state.spawnTimer -= sdt * 1000;
    if (state.spawnTimer <= 0) {
      spawnItem();
      state.spawnTimer = spawnGap() * (0.75 + Math.random() * 0.5);
    }

    state.powerupTimer -= sdt * 1000;
    if (state.powerupTimer <= 0) {
      spawnPowerup();
      state.powerupTimer = settings.powerupGapMin +
        Math.random() * (settings.powerupGapMax - settings.powerupGapMin);
    }

    /* --- everything falling --- */
    const jarY = groundY() - px(settings.jarHeight) / 2;

    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i];

      if (item.caught) {
        item.fade -= dt * 3.6;
        if (item.fade <= 0) state.items.splice(i, 1);
        continue;
      }

      item.y += item.speed * slow * dt;
      item.angle += item.spin * sdt;

      const swayX = Math.sin(state.time * 0.9 + item.phase) * item.sway;
      item.drawX = item.x + swayX;

      /* 🧲 drags the good stuff towards you. Wasps and storms are immune —
         a magnet that pulled those in would be a curse, not a power-up. */
      if (state.timers.magnet > 0 && (item.points > 0 || item.power)) {
        const dir = Math.sign(state.jarX - item.x);
        item.x += dir * px(settings.magnetPull) * dt;
      }

      const dx = item.drawX - state.jarX;
      const dy = item.y - jarY;

      if (Math.sqrt(dx * dx + dy * dy) < px(settings.catchRadius)) {
        item.caught = true;

        if (item.power) {
          applyPowerup(item.power);
          burst(item.drawX, item.y, palette.accent2, 20);
          continue;
        }

        if (item.points === 0) {
          /* a baddie caught in the jar */
          hit();
          burst(item.drawX, item.y, '#8A6A9A', 16);
          continue;
        }

        const mult = multiplier();
        const gained = item.points * mult;

        state.score += gained;
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.glow = 1;
        state.catchTimer = 0.3;

        /* the note climbs with the combo, so a long chain sounds better */
        bell(Math.min(state.combo, 14), 0.1 + Math.min(item.points, 6) * 0.01);

        if (state.combo % settings.comboPerStep === 0) kickCombo();

        burst(item.drawX, item.y, palette.glow, 12 + item.points * 2);
        state.pops.push({
          x: item.drawX, y: item.y,
          text: `+${gained}`, age: 0, life: 1, big: item.points >= 6,
        });

        if (state.score > best) {
          best = state.score;
          save('mpd_best', String(best));
        }
        if (state.bestCombo > bestCombo) {
          bestCombo = state.bestCombo;
          save('mpd_bestcombo', String(bestCombo));
        }

        if (Math.floor(state.score / settings.pointsPerLevel) + 1 > state.level) levelUp();

        awardStars();
        paintHud();
        continue;
      }

      /* --- off the bottom --- */
      if (item.y > canvas.height + px(30)) {
        state.items.splice(i, 1);

        /* Missing a good one breaks the chain, so playing greedily costs
           you. Missing a POWER-UP doesn't — missing one is punishment
           enough on its own. */
        if (item.points > 0 && !item.power) {
          state.combo = 0;
          paintHud();
        }
      }
    }

    /* --- particles --- */
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.age += dt;
      if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += px(240) * dt;      /* a little gravity, so they arc */
      p.vx *= 0.98;
    }

    /* --- the floating "+3" texts --- */
    for (let i = state.pops.length - 1; i >= 0; i--) {
      const pop = state.pops[i];
      pop.age += dt;
      if (pop.age >= pop.life) state.pops.splice(i, 1);
      else pop.y -= px(40) * dt;
    }
  }


  /* ========================================================================
     9. DRAWING

     The canvas stays transparent and only paints what's in it — the sky
     behind is the CSS gradient on .canvas-wrap, already lit by the
     current day. So the game re-themes itself for free.
     ======================================================================== */

  function drawMotes() {
    state.motes.forEach((m) => {
      const y = ((m.fy - state.time * m.speed * 0.05) % 1 + 1) % 1;
      const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(state.time * 0.7 + m.phase));
      ctx.globalAlpha = twinkle * 0.45;
      ctx.fillStyle = palette.light;
      ctx.beginPath();
      ctx.arc(m.fx * canvas.width, y * canvas.height, px(m.size), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* A soft radial bloom. Used behind the jar and each falling thing —
     it's what stops the emoji looking like text pasted on a page. */
  function bloom(x, y, radius, colour, strength) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = strength;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawItems() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    state.items.forEach((item) => {
      const size = px(settings.itemSize) * (1 + Math.min(item.points, 10) * 0.022);
      const x = item.drawX != null ? item.drawX : item.x;

      ctx.save();
      ctx.globalAlpha = item.fade;
      ctx.translate(x, item.y);
      /* a caught thing flares outwards as it fades */
      if (item.caught) {
        const s = 1 + (1 - item.fade) * 0.9;
        ctx.scale(s, s);
      }
      ctx.rotate(item.angle);

      /* power-ups get a glowing ring so you can tell them from the rest */
      if (item.power) {
        bloom(0, 0, size * 1.5, palette.accent2, 0.6 * item.fade);
        ctx.strokeStyle = palette.accent2;
        ctx.lineWidth = px(3);
        ctx.globalAlpha = item.fade * (0.5 + 0.5 * Math.abs(Math.sin(state.time * 4)));
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = item.fade;
      } else if (item.points > 0) {
        bloom(0, 0, size * 1.3, palette.glow, 0.4 * item.fade);
      }

      ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.fillText(item.emoji, 0, 0);
      ctx.restore();
    });
  }

  /* The jar. A tapered glass body with a rim, and light pooling in the
     bottom that brightens with your combo. */
  function drawJar() {
    const w = px(settings.jarWidth);
    const h = px(settings.jarHeight) * (1 + state.catchTimer * 0.35);
    const x = state.jarX;
    const y = groundY();

    const topW = w * 0.88;
    const botW = w * 0.68;

    const held = Math.min(1, state.combo / (settings.comboPerStep * settings.maxMultiplier));
    bloom(x, y - h * 0.45, w * (0.9 + state.glow * 0.7), palette.glow,
          0.3 + state.glow * 0.45 + held * 0.2);

    ctx.save();

    /* a hit flashes the jar */
    if (state.hurtTimer > 0) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 30));

    ctx.beginPath();
    ctx.moveTo(x - topW / 2, y - h);
    ctx.lineTo(x + topW / 2, y - h);
    ctx.lineTo(x + botW / 2, y - h * 0.16);
    ctx.quadraticCurveTo(x + botW / 2, y, x + botW / 2 - px(9), y);
    ctx.lineTo(x - botW / 2 + px(9), y);
    ctx.quadraticCurveTo(x - botW / 2, y, x - botW / 2, y - h * 0.16);
    ctx.closePath();

    const glass = ctx.createLinearGradient(x, y - h, x, y);
    glass.addColorStop(0,    'rgba(255,255,255,0.22)');
    glass.addColorStop(0.55, 'rgba(255,255,255,0.34)');
    glass.addColorStop(1,    palette.glow);
    ctx.fillStyle = glass;
    ctx.fill();

    ctx.lineWidth = px(3.5);
    ctx.strokeStyle = palette.ink;
    ctx.stroke();

    /* the rim */
    ctx.beginPath();
    ctx.ellipse(x, y - h, topW / 2, px(6), 0, 0, Math.PI * 2);
    ctx.lineWidth = px(3.5);
    ctx.stroke();

    /* a highlight down one side, so it reads as glass */
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x - topW / 2 + px(8), y - h + px(10));
    ctx.lineTo(x - botW / 2 + px(10), y - h * 0.3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = px(2.5);
    ctx.stroke();
    ctx.restore();

    /* 🛡️ rings around the jar, one per charge */
    for (let s = 0; s < state.shields; s++) {
      ctx.globalAlpha = 0.5 - s * 0.1;
      ctx.strokeStyle = palette.accent2;
      ctx.lineWidth = px(2.5);
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.5, w * (0.68 + s * 0.12), h * (0.72 + s * 0.12), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      const life = 1 - p.age / p.life;
      ctx.globalAlpha = life;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    state.pops.forEach((pop) => {
      const life = 1 - pop.age / pop.life;
      ctx.globalAlpha = life;
      ctx.font = `700 ${px(pop.big ? 22 : 16)}px "Space Mono", monospace`;
      ctx.lineWidth = px(4);
      ctx.strokeStyle = palette.cream;
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = palette.ink;
      ctx.fillText(pop.text, pop.x, pop.y);
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMotes();
    drawItems();
    drawParticles();
    drawJar();
    drawPops();
  }

  /* --- the frame loop ---
     dt is capped: switching tabs away and back produces one enormous gap,
     and without a cap everything on screen would teleport. */
  let last = performance.now();

  function frame(nowMs) {
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;

    if (state.phase === 'playing') update(dt);
    draw();

    requestAnimationFrame(frame);
  }


  /* ========================================================================
     10. BUTTONS
     ======================================================================== */
  playBtn.addEventListener('click', () => {
    if (state.phase === 'paused') togglePause();
    else start();
  });

  pauseBtn.addEventListener('click', togglePause);

  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    save('mpd_gamesound', soundOn ? 'yes' : 'no');
    paintSoundBtn();
    if (soundOn) bell(4, 0.12);
  });

  /* Pause when the page is hidden, so you don't come back to an empty jar
     and two lost lives. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.phase === 'playing') togglePause();
  });

  window.addEventListener('resize', fitCanvas);
  if ('ResizeObserver' in window) new ResizeObserver(fitCanvas).observe(canvasWrap);

  fitCanvas();
  paintHud();
  paintSoundBtn();
  requestAnimationFrame(frame);
})();
