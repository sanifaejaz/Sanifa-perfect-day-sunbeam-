/* ==========================================================================
   script.js — Perfect Day

   The page has THREE pieces of state: the hour, the weather, the season.

     setWeather('rain')
       → one attribute on <html>
       → CSS repaints the whole world (style.css §2)
       → the clock, the caption and the ticker re-read themselves
       → the sound mix retunes to match, unless you've overridden it

   That's the architecture. Nothing here knows what colour anything is,
   and nothing in the CSS knows what the weather is.

     1. Saving things, safely
     2. The hour, the weather, the season
     3. Building the world (trees, grass, flowers, critters…)
     4. The three dials
     5. The sound
     6. The star jar
     7. Toast + confetti
     8. Flip cards
     9. Riddles
    10. Custom cursor
    11. Scroll: reveal, progress, active link
   ========================================================================== */

'use strict';

const likesMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* ==========================================================================
   1. SAVING THINGS, SAFELY

   localStorage throws rather than returning null when it's disabled or
   full — in a private window, or with site data blocked. Every read and
   write goes through here, so a browser that won't remember anything
   still renders a working page. It just forgets.
   ========================================================================== */
const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (err) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* fine */ }
  },
  getList(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (err) { return []; }
  },
  setList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (err) { /* fine */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (err) { /* fine */ }
  },
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const rand  = (lo, hi) => lo + Math.random() * (hi - lo);
const pick  = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));


/* ==========================================================================
   2. THE HOUR

   Dial one. Four of them, and they own the light: where the sun is, what
   colour the sky is, whether there are stars in it.

   `clock` is the hour this time of day nominally happens at. It is not
   decoration - skyArc reads it to work out where to put the sun, so the
   sky and the sun can never disagree.

   `mix` is the base sound. The weather and the season add to it rather
   than replacing it, so every combination gets its own balance for free.
   ========================================================================== */
const TIMES = {
  sunrise: {
    emoji: '\u{1F305}', clock: '05:40', name: 'sunrise', short: 'sunrise',
    caption: 'everything is pink and nobody is awake to argue. \u{1F338}',
    mix: { rain: 0, wind: 14, waves: 8, birds: 66 },
    ticker: ['the sky did something ridiculous', 'nobody else saw it',
             'birds absolutely going for it', 'still technically night somewhere',
             'worth getting up for. once.'],
  },
  day: {
    emoji: '\u{1F31E}', clock: '12:20', name: 'daytime', short: 'day',
    caption: 'warm, bright, and absolutely nothing due. \u2600\uFE0F',
    /* This is the mix the site opens on, so it is deliberately even:
       breeze, water and birds at roughly equal weight and no rain at all.
       A single channel out in front reads as a sound effect; three balanced
       ones read as a place. */
    mix: { rain: 0, wind: 34, waves: 28, birds: 26 },
    ticker: ['no plans', 'none at all', 'a butterfly landed on the blanket',
             'the sun is showing off', 'somebody bring a second ice cream'],
  },
  sunset: {
    emoji: '\u{1F304}', clock: '19:20', name: 'sunset', short: 'sunset',
    caption: 'the ten minutes where the whole valley turns gold. \u{1F36F}',
    mix: { rain: 0, wind: 24, waves: 30, birds: 34 },
    ticker: ['the light goes gold', 'everything has a long shadow',
             'nobody wants to go in yet', 'the birds are settling down'],
  },
  night: {
    emoji: '\u2728', clock: '23:40', name: 'night', short: 'night',
    caption: 'four hundred stars and nowhere at all to be. \u{1F30C}',
    mix: { rain: 0, wind: 22, waves: 16, birds: 0 },
    /* Spring and summer both add birds, and nothing about that is wrong -
       but they are adding them to midnight. An hour gets the last word on
       what cannot possibly be out in it. */
    caps: { birds: 0 },
    ticker: ['fireflies have taken over', 'the moon looks smug',
             'owls in the trees, watching', 'four hundred stars, minimum',
             'nobody is checking the time'],
  },

  /* Not in the picker. Reached from the sonnet at the bottom of the page,
     because it is one particular morning rather than a time of day - and it
     is the only one with a city in it. */
  poem: {
    emoji: '\u{1F309}', clock: '05:45', name: 'westminster', short: 'morning',
    caption: 'the 3rd of September, 1802. nothing switched on yet. \u{1F54A}\uFE0F',
    mix: { rain: 0, wind: 20, waves: 16, birds: 18 },
    ticker: ['earth has not anything to show more fair',
             'the river glideth at his own sweet will',
             'all that mighty heart is lying still',
             'silent, bare, and smokeless'],
  },
};


/* ==========================================================================
   2b. THE WEATHER

   Dial two, and completely independent of dial one. That independence is
   the point: rain at midnight is night plus rain, not a day of its own,
   which is why it can now happen at all.

   `adj` is how the weather reads in front of the hour - "rainy night",
   "breezy sunrise". `mixBias` is added to the hour's mix and then clamped,
   so rain gets loud without the hour having to know about rain.
   ========================================================================== */
const WEATHER = {
  clear: {
    emoji: '\u2600\uFE0F', name: 'clear', adj: 'clear',
    caption: null,          /* clear weather is the hour on its own */
    mixBias: {},
    /* Autumn adds a little rain to the mix, which is right in a downpour and
       nonsense in sunshine. The weather is what decides whether there is any
       rain at all, so it says so outright. */
    caps: { rain: 0 },
    ticker: [],
  },
  rain: {
    emoji: '\u{1F327}\uFE0F', name: 'rain', adj: 'rainy',
    caption: 'the best possible excuse to stay exactly where you are. \u2615',
    mixBias: { rain: 74, wind: 8, waves: -6, birds: -24 },
    ticker: ['it is absolutely chucking it down', 'and that is fine',
             'puddle count: rising', 'nobody is going anywhere'],
  },
  breeze: {
    emoji: '\u{1F343}', name: 'breeze', adj: 'breezy',
    caption: 'hold onto your hat, the whole valley is showing off. \u{1F388}',
    mixBias: { rain: 0, wind: 34, waves: -4, birds: 2 },
    caps: { rain: 0 },   /* dry */
    ticker: ['dandelion situation: out of hand', 'the trees are having a lovely time',
             'hat: gone', 'everything smells rinsed'],
  },
  seaside: {
    emoji: '\u{1F30A}', name: 'seaside', adj: 'seaside',
    caption: 'close enough to hear it, far enough to keep the sand out. \u{1F41A}',
    mixBias: { rain: 0, wind: 6, waves: 52, birds: -2 },
    caps: { rain: 0 },   /* dry */
    ticker: ['one wave every nine seconds', 'give or take',
             'the water is FRESHER than expected', 'staying till the light goes'],
  },
};


/* ==========================================================================
   2c. THE SEASONS

   Dial three. The hour owns the light, the weather owns the air, the season
   owns the ground. All three are kept independent, which is where the
   variety comes from for very little code: four times four times four.

   `mixBias` nudges the day's sound rather than replacing it: no birds in a
   snowy field, more of them in spring. Added and then clamped, so a day
   that was already loud on one channel does not get pushed past 100.
   ========================================================================== */
const SEASONS = {
  spring: {
    emoji: '\u{1F337}',
    name:  'spring',
    props: { blossom: 26 },
    mixBias: { birds: 18, wind: 4, rain: 0, waves: 0 },
    ticker: ['everything is coming back', 'blossom on the path', 'the birds are showing off'],
  },
  summer: {
    emoji: '\u{1F366}',
    name:  'summer',
    props: { treats: 7 },
    mixBias: { birds: 4, waves: 6, wind: 0, rain: 0 },
    ticker: ['long light', 'something cold to drink', 'the grass is warm'],
  },
  autumn: {
    emoji: '\u{1F342}',
    name:  'autumn',
    props: { leaffall: 24 },
    mixBias: { wind: 16, birds: -8, rain: 4, waves: 0 },
    ticker: ['the whole valley is amber', 'leaves letting go', 'jumper weather'],
  },
  winter: {
    emoji: '\u26C4',
    name:  'winter',
    props: { snow: 40 },
    mixBias: { wind: 12, birds: -20, rain: -20, waves: -6 },
    ticker: ['snow, and nowhere to be', 'bare branches', 'a small friend in the field'],
  },
};

let season = store.get('mpd_season', 'summer');
if (!(season in SEASONS)) season = 'summer';

let time = store.get('mpd_time', 'day');
if (!(time in TIMES)) time = 'day';

let weather = store.get('mpd_weather', 'clear');
if (!(weather in WEATHER)) weather = 'clear';

/* Where the sun has been dragged to, in minutes past midnight, or null to
   leave it at the hour's own nominal clock. Set by the sun slider only. */
let scrub = null;

/* Has the visitor touched a slider? Once they have, changing the day
   stops rewriting their mix. */
let mixIsMine = store.get('mpd_mixmine', 'no') === 'yes';

const navClockTime  = $('#navClockTime');
const navClockLabel = $('#navClockLabel');
const navLogoMark   = $('#navLogoMark');
const heroCaption   = $('#heroCaption');
const marqueeTrack  = $('#marqueeTrack');

/* The ticker text changes with the weather. Content is written twice so
   the marquee loops seamlessly — the animation slides by exactly -50%,
   so the second copy arrives exactly as the first leaves. */
function paintMarquee() {
  /* all three dials get a say, so the ticker knows the hour, the weather
     and the month */
  const bits = TIMES[time].ticker
    .concat(WEATHER[weather].ticker)
    .concat(SEASONS[season].ticker.slice(0, 2));
  const line = '✦ ' + bits.join(' ✦ ') + ' ✦ ';
  marqueeTrack.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const span = document.createElement('span');
    span.textContent = line.repeat(2);
    marqueeTrack.appendChild(span);
  }
}

/* Where the sun sits, worked out from the clock rather than hand-placed.

   The sun rises in the east and sets in the west, so x runs left to right
   across the whole day. Height is a sine arc: nothing at 06:00, highest at
   noon, nothing again at 18:00. That single curve gives dawn, morning,
   midday, afternoon and sunset their own positions for free, and it means
   the sun and the clock can never disagree with each other.

   Outside 06:00-18:00 the sun is below the horizon, so it is parked off the
   bottom and the moon (which runs the same arc, twelve hours offset) takes
   over. */
/* When the sun clears the hills and when it goes back behind them. Read by
   skyArc to place it and by timeForHour to colour the sky, so the two can
   never disagree about whether it is up - which they did, for one minute at
   dusk, when each had its own copy of 19.5. */
const RISE = 5.5;
const SET  = 19.5;

function skyArc(clock, opts = {}) {
  const [h, m] = String(clock).split(':').map(Number);
  const hours = (h || 0) + (m || 0) / 60;

  /* A long summer day: up at half five, down at half seven. Picked so the
     sunrise day at 05:40 lands just above the horizon rather than below
     it, and the sunset day at 19:20 lands just before it goes. */
  const rise = opts.rise != null ? opts.rise : RISE;
  const set  = opts.set  != null ? opts.set  : SET;
  const span = set - rise;

  /* 0 at rise, 1 at set */
  let t = (hours - rise) / span;
  const up = t >= 0 && t <= 1;
  if (!up) t = clamp(t, -0.25, 1.25);

  /* 8% at the eastern edge to 92% at the western one */
  const x = 8 + t * 84;

  /* 64% down at the horizon, 26% at the top of the arc. The top is kept
     below the nav bar on purpose - a midday sun any higher gets clipped. */
  const y = 64 - Math.sin(Math.PI * clamp(t, 0, 1)) * 38;

  /* A low sun looks bigger, the way it actually does. Kept to a narrow
     swing: the full 100-146px range made the midday sun the smallest and
     weakest thing in the sky, which is backwards. */
  const size = 112 + (1 - Math.sin(Math.PI * clamp(t, 0, 1))) * 26;

  return { x, y: up ? y : 124, size, up };
}

function paintSky(clock) {
  const root = document.documentElement.style;
  const sun  = skyArc(clock);
  root.setProperty('--sun-x', sun.x.toFixed(2) + '%');
  root.setProperty('--sun-y', sun.y.toFixed(2) + '%');
  root.setProperty('--sun-size', Math.round(sun.size) + 'px');

  /* the moon runs the same arc, half a day out of step */
  const [h, m] = String(clock).split(':').map(Number);
  const shifted = ((h || 0) + 12) % 24 + ':' + String(m || 0).padStart(2, '0');
  const moon = skyArc(shifted);
  root.setProperty('--moon-x', moon.x.toFixed(2) + '%');
  root.setProperty('--moon-y', (moon.up ? moon.y : 124).toFixed(2) + '%');
}

/* Minutes past midnight as "HH:MM". */
function fmtClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/* The clock the world is currently set to: wherever the sun has been
   dragged, or failing that the hour's own nominal time. */
function currentClock() {
  return scrub == null ? TIMES[time].clock : fmtClock(scrub);
}

/* The hour's mix, nudged by the weather and then by the season, clamped
   back into range. Each dial adds rather than replaces, so a combination
   nobody thought about still comes out balanced. */
function composedMix() {
  const base  = TIMES[time].mix;
  const wBias = WEATHER[weather].mixBias || {};
  const sBias = SEASONS[season].mixBias || {};

  /* An hour or a weather can declare a channel impossible in it, and the
     lower ceiling wins. This is how a season's nudge gets overruled rather
     than clamped: spring adds birds, but not to midnight; autumn adds rain,
     but not to a clear sky. */
  const caps = { ...(TIMES[time].caps || {}), ...(WEATHER[weather].caps || {}) };
  for (const key in TIMES[time].caps || {}) {
    if (key in caps) caps[key] = Math.min(caps[key], TIMES[time].caps[key]);
  }

  const out = {};
  for (const key in base) {
    const ceiling = key in caps ? caps[key] : 100;
    out[key] = clamp(base[key] + (wBias[key] || 0) + (sBias[key] || 0), 0, ceiling);
  }
  return out;
}

/* "rainy night", "breezy sunrise", or just "daytime" when it is clear. */
function dialLabel() {
  if (time === 'poem') return TIMES.poem.name;
  return weather === 'clear'
    ? TIMES[time].name
    : `${WEATHER[weather].adj} ${TIMES[time].short}`;
}

/* The weather's line if there is weather, otherwise the hour's. */
function dialCaption() {
  if (time === 'poem') return TIMES.poem.caption;
  return WEATHER[weather].caption || TIMES[time].caption;
}

/* Which chips look chosen. One pass over every element carrying the
   attribute, so it cannot mark one control and miss another. */
function paintDials() {
  $$('[data-time]').forEach((el) =>
    el.setAttribute('aria-selected', String(el.dataset.time === time)));
  $$('[data-weather]').forEach((el) =>
    el.setAttribute('aria-selected', String(el.dataset.weather === weather)));
  $$('[data-season]').forEach((el) =>
    el.setAttribute('aria-selected', String(el.dataset.season === season)));
}

/* Keep the sun slider and its readout on whatever the world is showing,
   including while the real clock is driving. */
function syncSunSlider(clock) {
  const slider = $('#hourSlider');
  const readout = $('#dockClock');
  if (readout) readout.textContent = clock;
  if (!slider) return;
  const [hh, mm] = String(clock).split(':').map(Number);
  const mins = (hh || 0) * 60 + (mm || 0);
  slider.value = String(clamp(Math.round(mins / 5) * 5, 0, 1435));
}

const dockNow = $('#dockNow');

/* The caption fades rather than snapping. */
function paintCaption(text) {
  if (heroCaption.textContent.trim() === text) return;
  heroCaption.classList.add('swap');
  setTimeout(() => {
    heroCaption.textContent = text;
    heroCaption.classList.remove('swap');
  }, likesMotion ? 380 : 0);
}

/* ==========================================================================
   THE ONE FUNCTION THAT CHANGES THE PAGE.

   The three setters below only write their own attribute and then call
   this. Everything downstream of a dial - the nav, the sun, the caption,
   the ticker, the sound - is worked out here from all three at once, which
   is why no combination needs a special case.
   ========================================================================== */
function repaint(opts = {}) {
  /* the hour's nominal clock, or the real one when the clock is driving */
  const clock = opts.clock || currentClock();

  navClockTime.textContent  = clock;
  navClockLabel.textContent = dialLabel();

  /* The panel names the world in full - hour, weather and season - because
     it is now the only place that can tell you what you have built. */
  if (dockNow) {
    dockNow.textContent = time === 'poem'
      ? TIMES.poem.name
      : `${dialLabel()} · ${SEASONS[season].name}`;
  }
  /* the weather wins the logo when there is any, so the dial gives feedback */
  navLogoMark.textContent   = weather === 'clear'
    ? TIMES[time].emoji
    : WEATHER[weather].emoji;

  paintSky(clock);
  syncSunSlider(clock);
  paintCaption(dialCaption());
  paintMarquee();

  /* the sound follows all three, unless the visitor has taken over */
  if (!mixIsMine && !opts.keepMix) applyMix(composedMix());
}

function setTime(next, opts = {}) {
  if (!(next in TIMES)) return;
  time = next;

  document.documentElement.dataset.time = time;
  /* Live mode drives this every minute, and must not overwrite the hour the
     visitor actually chose - that is what it goes back to when it stops. */
  if (!opts.live) store.set('mpd_time', time);

  /* Choosing an hour outright abandons wherever the sun was dragged to.
     Dragging the sun sets the hour too, and passes keepScrub so it doesn't
     immediately undo itself. */
  if (!opts.keepScrub) scrub = null;

  paintDials();
  repaint(opts);
}

function setWeather(next, opts = {}) {
  if (!(next in WEATHER)) return;
  weather = next;

  document.documentElement.dataset.weather = weather;
  store.set('mpd_weather', weather);

  paintDials();
  repaint(opts);
}

function setSeason(next, opts = {}) {
  if (!(next in SEASONS)) return;
  season = next;

  document.documentElement.dataset.season = season;
  store.set('mpd_season', season);

  paintDials();
  repaint(opts);
}


/* ==========================================================================
   2d. HANDING THE CLOCK OVER

   With this on, the page stops being a set of seven pictures and becomes
   one continuous day: the sun sits where it really is right now, moves on
   its own every minute, and the sky follows it from dawn to night.

   The chosen day is deliberately left alone in storage while this runs, so
   switching it off puts you back where you were.
   ========================================================================== */

let liveTime = store.get('mpd_live', 'no') === 'yes';
let liveTimer = null;

function nowClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Which of the four hours a real clock time looks most like. The
   boundaries are the same ones skyArc uses, so the sky and the sun always
   agree: the sun is below the horizon exactly when it is `night`.

   Note that this only ever touches dial one. Whatever weather and season
   you picked are yours - the clock has no opinion about those. */
function timeForHour(hours) {
  if (hours < RISE)  return 'night';
  if (hours < 8)     return 'sunrise';
  if (hours < 17)    return 'day';
  /* <= rather than <, because skyArc still has the sun up at exactly SET -
     the moment it touches the horizon is the last moment of sunset, not the
     first of night. */
  if (hours <= SET)  return 'sunset';
  return 'night';
}

function liveTick() {
  const d = new Date();
  const hours = d.getHours() + d.getMinutes() / 60;
  setTime(timeForHour(hours), { clock: nowClock(), live: true });
}

function setLive(on, opts = {}) {
  liveTime = on;
  store.set('mpd_live', on ? 'yes' : 'no');

  document.documentElement.classList.toggle('live-time', on);
  const btn = $('#liveBtn');
  if (btn) btn.setAttribute('aria-pressed', String(on));
  const note = $('#liveNote');

  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }

  if (on) {
    liveTick();
    /* once a minute is enough - the sun moves 0.1% of the sky in that time */
    liveTimer = setInterval(liveTick, 60000);
    if (note) note.textContent = 'the sun is where it actually is, and still moving';
  } else {
    if (note) note.textContent = 'the sun goes where it actually is, and keeps moving';
    /* back to whatever was picked by hand */
    if (!opts.quiet) setTime(store.get('mpd_time', 'day'));
  }
}


/* ==========================================================================
   3. BUILDING THE WORLD

   Trees, grass, flowers and every critter are generated rather than
   written out, because the interesting part is the randomness —
   hand-placed ones always look hand-placed.
   ========================================================================== */

/* Spread n items across 0-100% but nudge each one. Pure Math.random()
   across a width reliably produces visible gaps and clumps; walking an
   even step and jittering each position looks scattered instead. */
function spread(count, jitter = 0.75) {
  const step = 100 / count;
  return Array.from({ length: count }, (_, i) =>
    clamp(i * step + step / 2 + (Math.random() - 0.5) * step * 2 * jitter, -2, 102));
}

function build(host, count, make) {
  const el = $(host);
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) frag.appendChild(make(i));
  el.appendChild(frag);
}

/* --- ⭐ stars --- */
function buildStars(count = 72) {
  const xs = spread(count);
  build('#worldStars', count, (i) => {
    const s = document.createElement('span');
    /* .tw is the subset that twinkles — see the note on .star in the CSS. */
    s.className = i % 9 < 4 ? 'star tw' : 'star';
    s.style.left = `${xs[i]}%`;
    /* raised to a power so stars bunch towards the top of the sky */
    s.style.top = `${Math.pow(Math.random(), 1.7) * 96}%`;
    const size = rand(2, 4.4);
    s.style.width = s.style.height = `${size}px`;
    s.style.setProperty('--dur', `${rand(2.4, 7)}s`);
    s.style.setProperty('--delay', `${-rand(0, 7)}s`);
    return s;
  });
}

/* --- 🌳 trees ---
   The trunk is a <span> and the leaves are <div>s on purpose: the CSS
   picks leaves with :nth-of-type, which counts by TAG rather than class.
   Make them all divs and the trunk becomes div #1, shifting every leaf
   rule by one and putting the leaves in the wrong places. */
function buildTrees(count = 11) {
  const xs = spread(count, 0.85);
  build('#trees', count, (i) => {
    const tree = document.createElement('div');
    tree.className = 'tree';

    const scale = rand(0.55, 1.15);
    tree.style.left   = `${xs[i]}%`;
    tree.style.width  = `${90 * scale}px`;
    tree.style.height = `${150 * scale}px`;
    tree.style.marginLeft = `${-45 * scale}px`;
    tree.style.setProperty('--sway', `${rand(3.8, 7.5)}s`);
    tree.style.setProperty('--delay', `${-rand(0, 6)}s`);

    const trunk = document.createElement('span');
    trunk.className = 'tree-trunk';
    tree.appendChild(trunk);

    for (let l = 0; l < 3; l++) {
      const leaf = document.createElement('div');
      leaf.className = 'tree-leaf';
      leaf.style.animationDelay = `${-rand(0, 5)}s`;
      tree.appendChild(leaf);
    }

    /* An owl in roughly every third tree, awake only on the starry day.
       Not every tree, because a row of identical owls stops being a
       surprise. The <b> tag matters - see the note on .owl in the CSS. */
    if (i % 3 === 1) {
      const owl = document.createElement('b');
      owl.className = 'owl';
      owl.style.setProperty('--perch', `${rand(44, 58)}%`);
      owl.style.setProperty('--blink', `${-rand(0, 3.4)}s`);
      owl.innerHTML =
        '<i class="owl-tuft owl-tuft-l"></i><i class="owl-tuft owl-tuft-r"></i>' +
        '<i class="owl-body"></i><i class="owl-bib"></i>' +
        '<i class="owl-eye owl-eye-l"></i><i class="owl-eye owl-eye-r"></i>' +
        '<i class="owl-beak"></i>';
      tree.appendChild(owl);
    }

    return tree;
  });
}

/* --- 🌱 grass --- */
function buildGrass(count = 56) {
  const xs = spread(count, 0.9);
  build('#grass', count, (i) => {
    const b = document.createElement('span');
    /* One blade in three sways. A still blade between two moving ones is
       invisible at this size, and the meadow is the densest thing here. */
    b.className = i % 3 === 0 ? 'blade sw' : 'blade';
    b.style.left = `${xs[i]}%`;
    b.style.height = `${rand(14, 40)}px`;
    b.style.width = `${rand(3, 6)}px`;
    b.style.opacity = String(rand(0.5, 1));
    b.style.setProperty('--sway', `${rand(2.2, 4.6)}s`);
    b.style.setProperty('--delay', `${-rand(0, 4)}s`);
    return b;
  });
}

/* --- 🌸 flowers ---
   Five petals fanned around a centre. Each petal has its origin at its
   own bottom and sits above the middle, so rotating it swings it out
   into a ring. */
const PETAL_COLOURS = ['#FF8FC7', '#FFD97D', '#C79BFF', '#FF9FA8', '#FFF3B0', '#9BE8D8'];

function buildFlowers(count = 20) {
  const xs = spread(count, 0.9);
  build('#flowers', count, (i) => {
    const f = document.createElement('div');
    f.className = 'flower';
    f.style.left = `${xs[i]}%`;
    f.style.height = `${rand(26, 52)}px`;
    f.style.setProperty('--sway', `${rand(3, 6)}s`);
    f.style.setProperty('--delay', `${-rand(0, 5)}s`);
    f.style.setProperty('--petal', pick(PETAL_COLOURS));

    const stem = document.createElement('span');
    stem.className = 'flower-stem';
    f.appendChild(stem);

    const head = document.createElement('div');
    head.className = 'flower-head';
    for (let p = 0; p < 5; p++) {
      const petal = document.createElement('i');
      petal.className = 'flower-petal';
      petal.style.transform = `rotate(${p * 72}deg)`;
      head.appendChild(petal);
    }
    const core = document.createElement('span');
    core.className = 'flower-core';
    head.appendChild(core);
    f.appendChild(head);

    return f;
  });
}

/* --- 🐦 birds. Two spans flapping in opposite phase is plenty at this size. --- */
function buildBirds(count = 9) {
  build('#birds', count, () => {
    const b = document.createElement('span');
    b.className = 'bird';
    b.innerHTML = '<i></i><i></i>';
    b.style.setProperty('--top', `${rand(6, 34)}%`);
    b.style.setProperty('--dur', `${rand(28, 60)}s`);
    b.style.setProperty('--delay', `${-rand(0, 55)}s`);
    /* smaller birds flap faster, which is both true and free */
    b.style.setProperty('--flap', `${rand(0.24, 0.5)}s`);
    b.style.scale = String(rand(0.5, 1.05));
    return b;
  });
}

/* --- 🦋 butterflies --- */
const WING_COLOURS = ['#FF8FC7', '#FFD97D', '#AE90FF', '#62DDF0', '#FF9FA8'];

function buildButterflies(count = 7) {
  build('#butterflies', count, () => {
    const b = document.createElement('span');
    b.className = 'butterfly';
    b.innerHTML = '<i></i><i></i>';
    b.style.setProperty('--top', `${rand(45, 78)}%`);
    b.style.setProperty('--left', `${rand(-5, 55)}%`);
    b.style.setProperty('--dur', `${rand(18, 34)}s`);
    b.style.setProperty('--delay', `${-rand(0, 30)}s`);
    b.style.setProperty('--flap', `${rand(0.22, 0.4)}s`);
    b.style.setProperty('--wing', pick(WING_COLOURS));
    return b;
  });
}

/* --- ✨ fireflies --- */
function buildFireflies(count = 24) {
  build('#fireflies', count, () => {
    const f = document.createElement('span');
    f.className = 'firefly';
    f.style.setProperty('--top', `${rand(48, 92)}%`);
    f.style.setProperty('--left', `${rand(0, 100)}%`);
    f.style.setProperty('--dur', `${rand(12, 26)}s`);
    f.style.setProperty('--glow', `${rand(1.8, 4.5)}s`);
    f.style.setProperty('--delay', `${-rand(0, 20)}s`);
    return f;
  });
}

/* --- 🌸 petals + 🌾 seeds + 🌧️ rain --- */
function buildPetals(count = 16) {
  const xs = spread(count);
  build('#petals', count, (i) => {
    const p = document.createElement('span');
    p.className = 'petal';
    p.style.left = `${xs[i]}%`;
    p.style.setProperty('--dur', `${rand(7, 14)}s`);
    p.style.setProperty('--delay', `${-rand(0, 12)}s`);
    p.style.setProperty('--petal', pick(PETAL_COLOURS));
    const size = rand(7, 13);
    p.style.width = p.style.height = `${size}px`;
    return p;
  });
}

function buildSeeds(count = 14) {
  build('#seeds', count, () => {
    const s = document.createElement('span');
    s.className = 'seed';
    s.style.setProperty('--top', `${rand(24, 78)}%`);
    s.style.setProperty('--dur', `${rand(16, 32)}s`);
    s.style.setProperty('--delay', `${-rand(0, 28)}s`);
    const size = rand(6, 11);
    s.style.width = s.style.height = `${size}px`;
    return s;
  });
}

function buildRain(count = 64) {
  const xs = spread(count, 1);
  build('#rain', count, (i) => {
    const d = document.createElement('span');
    d.className = 'raindrop';
    d.style.left = `${xs[i]}%`;
    d.style.setProperty('--len', `${rand(30, 96)}px`);
    /* the spread of speeds is what gives the rain depth */
    d.style.setProperty('--dur', `${rand(0.45, 1.1)}s`);
    d.style.setProperty('--delay', `${-rand(0, 2)}s`);
    d.style.opacity = String(rand(0.25, 0.85));
    return d;
  });
}

/* --- the season props ---
   Same generated-not-written approach as the critters. Each one gets its
   own duration and a negative delay, so on the first frame the layer is
   already mid-fall rather than everything starting from the top together. */

const BLOSSOM_COLOURS = ['#FFC2DE', '#FFD9E8', '#FFB3D1', '#FFF0F6', '#F7C8E8'];

function buildBlossom(count = 26) {
  const xs = spread(count);
  build('#blossom', count, (i) => {
    const b = document.createElement('span');
    b.className = 'bloss';
    b.style.setProperty('--left', `${xs[i]}%`);
    b.style.setProperty('--bloss', pick(BLOSSOM_COLOURS));
    b.style.setProperty('--dur', `${rand(11, 20)}s`);
    b.style.setProperty('--delay', `${-rand(0, 20)}s`);
    const size = rand(7, 12);
    b.style.width = b.style.height = `${size}px`;
    return b;
  });
}

const LEAF_COLOURS = ['#E07B32', '#F2B33D', '#C4552A', '#D98F3C', '#A8442A', '#E8A94E'];

function buildLeafFall(count = 24) {
  const xs = spread(count);
  build('#leaffall', count, (i) => {
    const l = document.createElement('span');
    l.className = 'fleaf';
    l.style.setProperty('--left', `${xs[i]}%`);
    l.style.setProperty('--fl', pick(LEAF_COLOURS));
    l.style.setProperty('--dur', `${rand(8, 15)}s`);
    l.style.setProperty('--delay', `${-rand(0, 15)}s`);
    const w = rand(10, 17);
    l.style.width = `${w}px`;
    l.style.height = `${w * 0.75}px`;
    return l;
  });
}

function buildSnow(count = 40) {
  const xs = spread(count);
  build('#snow', count, (i) => {
    const f = document.createElement('span');
    f.className = 'flake';
    f.style.setProperty('--left', `${xs[i]}%`);
    f.style.setProperty('--size', `${rand(3, 8)}px`);
    f.style.setProperty('--dur', `${rand(9, 18)}s`);
    f.style.setProperty('--delay', `${-rand(0, 18)}s`);
    return f;
  });
}

/* The one place the world uses emoji instead of drawing the thing. An ice
   lolly built out of divs looks like a diagram of an ice lolly. */
const TREATS = ['\u{1F366}', '\u{1F367}', '\u{1F349}', '\u{1F379}', '\u{1F9C3}', '\u{1F368}', '\u{1F34B}'];

/* --- 🌉 the city on the far bank ---
   Ships, towers, domes, theatres and temples, in that order of how much
   detail they get. Generated rather than written out so the roofline is
   uneven, but the landmarks are placed by hand: a skyline is recognisable
   because of its few big shapes, not its many small ones.

   Only ever seen on the poem day. */
function buildCity() {
  const host = $('#londonCity');
  if (!host) return;

  const frag = document.createDocumentFragment();

  /* masts down at the wharf, on the left where the river runs out */
  for (let i = 0; i < 7; i++) {
    const m = document.createElement('span');
    m.className = 'mast';
    m.style.setProperty('--left', `${2 + i * 2.4 + rand(-0.6, 0.6)}%`);
    m.style.setProperty('--h', `${rand(22, 40)}px`);
    frag.appendChild(m);
  }

  /* the roofline. Kept low either side of the middle so St Paul's dome
     still reads as the tallest thing on it. */
  const xs = spread(22, 0.5);
  for (let i = 0; i < 22; i++) {
    const b = document.createElement('span');
    const middle = Math.abs(xs[i] - 50) < 12;
    const roll = Math.random();

    let cls = 'bldg';
    if (roll > 0.86)      cls += ' spire';   /* a church */
    else if (roll > 0.62) cls += ' roof';    /* pitched */
    if (Math.random() > 0.72) cls += ' lit'; /* one window awake */
    b.className = cls;

    b.style.setProperty('--left', `${xs[i]}%`);
    b.style.setProperty('--w', `${rand(12, 30)}px`);
    b.style.setProperty('--h', `${middle ? rand(16, 30) : rand(24, 58)}px`);
    frag.appendChild(b);
  }

  /* St Paul's, a little right of centre */
  const dome = document.createElement('span');
  dome.className = 'dome';
  dome.style.setProperty('--left', '47%');
  frag.appendChild(dome);

  host.appendChild(frag);
}

function buildTreats(count = 7) {
  const xs = spread(count, 0.6);
  build('#treats', count, (i) => {
    const t = document.createElement('span');
    t.className = 'treat';
    t.textContent = TREATS[i % TREATS.length];
    t.style.setProperty('--left', `${xs[i]}%`);
    t.style.setProperty('--bottom', `${rand(1.5, 9)}%`);
    t.style.setProperty('--size', `${rand(20, 32)}px`);
    t.style.setProperty('--dur', `${rand(2.8, 4.6)}s`);
    t.style.setProperty('--delay', `${-rand(0, 4)}s`);
    return t;
  });
}

function buildSparkles(count = 16) {
  const xs = spread(count);
  build('#lakeSparkles', count, (i) => {
    const s = document.createElement('span');
    s.className = 'lake-sparkle';
    s.style.left = `${xs[i]}%`;
    s.style.top = `${rand(4, 88)}%`;
    s.style.setProperty('--dur', `${rand(2, 5.5)}s`);
    s.style.setProperty('--delay', `${-rand(0, 5)}s`);
    return s;
  });
}

buildStars();
buildTrees();
buildGrass();
buildFlowers();
buildSparkles();

/* Summer's props just sit on the grass, so they are worth building even
   for someone who has asked for less motion. Same for the city, which does
   not move at all. */
buildTreats();
buildCity();

/* The moving critters are the only expensive part of the world and are
   purely decorative — so a device asking for less motion doesn't get
   them built at all. */
if (likesMotion) {
  buildBirds();
  buildButterflies();
  buildFireflies();
  buildPetals();
  buildSeeds();
  buildRain();
  buildBlossom();
  buildLeafFall();
  buildSnow();
}


/* ==========================================================================
   4. THE THREE DIALS
   ========================================================================== */
$('#liveBtn').addEventListener('click', () => {
  setLive(!liveTime);
  showToast(liveTime ? '\u{1F552}' : '\u{1F3A8}',
    liveTime ? `following the clock \u00b7 ${nowClock()}` : 'back to picking it yourself');
});

/* One handler for all three dials. It binds every BUTTON carrying the
   attribute, wherever it is, so the panel's chips needed no special casing
   when the picker sections went - and a fourth hour could be added to the
   markup tomorrow without touching this. */
function wireDial(attr, table, setter, prize) {
  $$(`[data-${attr}]`).filter((el) => el.tagName === 'BUTTON').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset[attr];
      if (!(key in table)) return;

      /* choosing anything by hand takes the wheel back off the clock */
      if (attr === 'time' && liveTime) setLive(false, { quiet: true });

      setter(key);
      showToast(table[key].emoji, `${table[key].name}! nice pick.`);

      if (claim(`${attr}-${key}`)) {
        /* Counts the buttons rather than the table, because `poem` has no
           card - keying the bonus off the table would put it permanently
           out of reach. */
        const pickable = Array.from(new Set(
          $$(`[data-${attr}]`).filter((el) => el.tagName === 'BUTTON')
            .map((el) => el.dataset[attr])));
        const seen = pickable.filter((k) => claimed.includes(`${attr}-${k}`));
        if (seen.length === pickable.length) {
          addStars(3, `+3 ⭐ · ${prize}`);
          confetti(60);
        } else {
          addStars(1, '+1 ⭐ · a whole new valley');
        }
      }
    });
  });
}

wireDial('time',    TIMES,    setTime,    'every hour of the day!');
wireDial('weather', WEATHER,  setWeather, 'every kind of weather!');
wireDial('season',  SEASONS,  setSeason,  'all four seasons!');

$('#sonnetDay').addEventListener('click', () => {
  mixIsMine = false;
  store.set('mpd_mixmine', 'no');
  if (liveTime) setLive(false, { quiet: true });
  setTime('poem');
  $('#top').scrollIntoView({ behavior: likesMotion ? 'smooth' : 'auto' });
  showToast('🌉', 'Westminster Bridge, 3rd September 1802');
});


/* ==========================================================================
   5. THE SOUND MIXER
   ========================================================================== */
/* Every channel now has TWO sliders - one in the mixer section, one in the
   panel - and neither is the master copy. They are found by their
   data-mix attribute and moved together, which is cheaper than keeping two
   widgets in sync and makes it impossible for them to disagree. */
const CHANNELS = ['rain', 'wind', 'waves', 'birds'];

const inputsFor = (name) => $$(`[data-mix="${name}"]`);

/* Kept for the places that only need one of them to read a value off. */
const sliders = {
  rain:  $('[data-mix="rain"]'),
  wind:  $('[data-mix="wind"]'),
  waves: $('[data-mix="waves"]'),
  birds: $('[data-mix="birds"]'),
};

const readouts = {
  rain:  $('#mixRainVal'),
  wind:  $('#mixWindVal'),
  waves: $('#mixWavesVal'),
  birds: $('#mixBirdsVal'),
};

const masterSliders = $$('#dockMaster');
const masterSlider  = masterSliders[0];
const masterValue   = $('#mixMasterVal');
const navSound      = $('#navSound');

/* One channel changed: move the number, the lit state and the audio.
   Everything that changes a level goes through here. */
function paintChannel(name, source) {
  const els = inputsFor(name);
  if (!els.length) return;

  const value = Number((source || els[0]).value);
  /* move the twin, but never the one being dragged - writing .value mid-drag
     is what makes a slider feel like it is fighting your finger */
  els.forEach((el) => { if (el !== source) el.value = String(value); });

  if (readouts[name]) readouts[name].textContent = String(value);
  /* whatever is wrapping this channel - a row in the panel - lights up when
     it is actually making a sound */
  $$(`[data-channel="${name}"]`).forEach((row) =>
    row.classList.toggle('live', value > 0));
  window.Ambience.set(name, value);
}

function saveMix() {
  store.setList('mpd_mix', CHANNELS.map((n) => Number(inputsFor(n)[0].value)));
}

/* Set all four at once — from a preset or a change of weather. */
function applyMix(mix, opts = {}) {
  CHANNELS.forEach((name) => {
    if (name in mix) {
      inputsFor(name).forEach((el) => { el.value = String(Math.round(mix[name])); });
    }
    paintChannel(name);
  });

  if (opts.mine) {
    mixIsMine = true;
    store.set('mpd_mixmine', 'yes');
  }

  saveMix();
  paintSoundBtn();
}

function paintSoundBtn() {
  const on = window.Ambience.isOn();
  navSound.setAttribute('aria-pressed', String(on));
  navSound.querySelector('.nav-sound-text').textContent = on ? 'sound on' : 'sound';
}

/* --- the sliders ---
   'input' fires continuously as you drag, which is what we want: the
   audio should follow your finger, not wait for you to let go. */
CHANNELS.forEach((name) => {
  inputsFor(name).forEach((el) => {
    el.addEventListener('input', () => {
      /* touching a slider is the visitor taking over the mix */
      mixIsMine = true;
      store.set('mpd_mixmine', 'yes');

      /* and it's a real user gesture, so it's a legal moment to start audio */
      if (!window.Ambience.isOn() && Number(el.value) > 0) window.Ambience.on();

      paintChannel(name, el);
      saveMix();
      paintSoundBtn();
    });
  });
});

masterSliders.forEach((el) => {
  el.addEventListener('input', () => {
    const value = Number(el.value);
    masterSliders.forEach((other) => {
      if (other !== el) other.value = String(value);
    });
    if (masterValue) masterValue.textContent = String(value);
    window.Ambience.master(value);
    store.set('mpd_master', String(value));
    if (!window.Ambience.isOn() && value > 0) window.Ambience.on();
    paintSoundBtn();
  });
});

/* --- the nav toggle ---
   If everything sits at zero, turning sound on would produce silence and
   look broken. So it loads the mix for whatever is on screen first. */
navSound.addEventListener('click', () => {
  if (window.Ambience.isOn()) {
    window.Ambience.off();
    showToast('🤫', 'sound off');
  } else {
    window.Ambience.on();
    const silent = CHANNELS.every((n) => Number(inputsFor(n)[0].value) === 0);
    if (silent) applyMix(composedMix());
    showToast('🔊', 'sound on — turn it up!');
    if (claim('turned-on-sound')) addStars(1, '+1 ⭐ · you found the sound');
  }
  paintSoundBtn();
});

/* --- presets --- */
const PRESETS = {
  porch:   { rain: 76, wind: 30, waves: 8,  birds: 0  },
  garden:  { rain: 0,  wind: 12, waves: 0,  birds: 66 },
  shore:   { rain: 0,  wind: 34, waves: 82, birds: 14 },
  hill:    { rain: 0,  wind: 72, waves: 6,  birds: 20 },
  silence: { rain: 0,  wind: 0,  waves: 0,  birds: 0  },
};

$$('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    if (btn.dataset.preset !== 'silence') window.Ambience.on();
    applyMix(preset, { mine: true });
    paintSoundBtn();
    showToast('🎚️', btn.textContent.trim().toLowerCase());
  });
});


/* ==========================================================================
   5b. THE PANEL

   This is the only control surface on the site. There were two sections
   further down the page repeating it - a day picker and a sound mixer - and
   they are gone, because scrolling away from the valley to change the
   valley is the wrong way round.

   Most of it is already wired: the chips by wireDial in section 4, the
   channels by section 5, the real-time switch just above. What is left here
   is the fold-away, the sun slider, and the button in the hero that opens
   the thing.
   ========================================================================== */
const dock = $('#dock');
const dockToggle = $('#dockToggle');

function setDock(open) {
  dock.classList.toggle('closed', !open);
  dockToggle.setAttribute('aria-expanded', String(open));
  store.set('mpd_dock', open ? 'open' : 'closed');
}

dockToggle.addEventListener('click', () => {
  setDock(dock.classList.contains('closed'));
});

/* Start folded on a narrow screen, where it would otherwise cover half the
   valley, and open everywhere else. */
setDock(store.get('mpd_dock', window.innerWidth < 760 ? 'closed' : 'open') === 'open');

/* The hero's button used to scroll down to a picker section. There isn't
   one any more, so it opens the panel instead - and wobbles it, because a
   thing that is already open would otherwise appear to do nothing at all
   when you press the button that opens it. */
const heroControls = $('#heroControls');
if (heroControls) {
  heroControls.addEventListener('click', () => {
    setDock(true);
    dock.classList.remove('nudge');
    /* restart the animation rather than letting a second press be ignored */
    void dock.offsetWidth;
    dock.classList.add('nudge');
    setTimeout(() => dock.classList.remove('nudge'), 2000);
  });
}

/* --- the sun slider ---
   Drag this and the sun really travels: the same skyArc that places it for
   each hour is fed the dragged clock instead. The hour dial follows along,
   so the sky can never disagree with where the sun is. */
const hourSlider = $('#hourSlider');

hourSlider.addEventListener('input', () => {
  /* moving the sun by hand takes the wheel back off the clock */
  if (liveTime) setLive(false, { quiet: true });

  scrub = Number(hourSlider.value);
  const next = timeForHour(scrub / 60);

  /* keepScrub, or setTime would throw away the drag that caused it */
  if (next !== time) setTime(next, { keepScrub: true });
  else repaint();
});

hourSlider.addEventListener('change', () => {
  if (claim('dragged-the-sun')) addStars(1, '+1 \u2b50 \u00b7 you moved the sun');
});


/* ==========================================================================
   5c. TAKE ME THERE

   The about page describes a handful of specific moments. These put the
   valley into them, which is the whole reason the dials are separate: each
   button is just an hour and a weather.
   ========================================================================== */
$$('.about-scene').forEach((btn) => {
  btn.addEventListener('click', () => {
    const [t, w] = String(btn.dataset.scene).split(':');
    if (liveTime) setLive(false, { quiet: true });
    mixIsMine = false;
    store.set('mpd_mixmine', 'no');
    setWeather(w, { keepMix: true });
    setTime(t);
    $('#top').scrollIntoView({ behavior: likesMotion ? 'smooth' : 'auto' });
    showToast(TIMES[t].emoji, btn.textContent.trim().toLowerCase());
  });
});


/* ==========================================================================
   6. THE STAR JAR
   ========================================================================== */
const starCountEl  = $('#starCount');
const footerStarEl = $('#footerStars');
const starJarEl    = $('#starJar');

let stars   = Number(store.get('mpd_stars', 0)) || 0;
let claimed = store.getList('mpd_claimed');

const milestones = [
  { at: 1,  emoji: '⭐', text: 'one star! it begins.' },
  { at: 5,  emoji: '🌟', text: 'five! you are properly into this now.' },
  { at: 12, emoji: '🎉', text: 'twelve — the last page just cracked open!' },
  { at: 20, emoji: '🏆', text: 'twenty. that is a very well made day.' },
  { at: 30, emoji: '👑', text: 'thirty! there is nothing left to find.' },
];

const LAST_PAGE_AT    = 12;
const lastPageEl      = $('#lastPage');
const lastPageStarsEl = $('#lastPageStars');

/* paintJar runs once at startup, before the toast and confetti should be
   allowed to fire — otherwise a returning visitor gets confetti for
   nothing the moment the page loads. */
let firstPaint = true;

function paintJar() {
  starCountEl.textContent  = String(stars);
  footerStarEl.textContent = String(stars);
  lastPageStarsEl.textContent = String(Math.min(stars, LAST_PAGE_AT));

  const unlocked = stars >= LAST_PAGE_AT;
  const wasLocked = lastPageEl.classList.contains('locked');
  lastPageEl.classList.toggle('locked', !unlocked);

  if (unlocked && wasLocked && !firstPaint) {
    showToast('🎉', 'the last page is open!');
    confetti(50);
  }
  firstPaint = false;
}

/* game.js calls this too, which is why it goes on window. */
function addStars(amount, message) {
  stars += amount;
  store.set('mpd_stars', String(stars));

  const hit = milestones.find((m) => m.at === stars);
  if (hit) {
    showToast(hit.emoji, hit.text);
    confetti(50);
  } else {
    showToast('⭐', message || `+${amount} star!`);
  }
  paintJar();
}
window.addStars = addStars;

/* Has this particular thing already paid out? Facts, riddles and days
   each pay once, and the claimed list is what survives a reload. */
function claim(id) {
  if (claimed.includes(id)) return false;
  claimed.push(id);
  store.setList('mpd_claimed', claimed);
  return true;
}

function resetEverything() {
  ['mpd_stars', 'mpd_claimed', 'mpd_facts', 'mpd_riddles', 'mpd_mix',
   'mpd_mixmine', 'mpd_best', 'mpd_bestcombo', 'mpd_played']
    .forEach((k) => store.remove(k));
  location.reload();
}

starJarEl.addEventListener('dblclick', resetEverything);
$('#footerReset').addEventListener('click', resetEverything);


/* ==========================================================================
   7. TOAST + CONFETTI
   ========================================================================== */
const toastEl      = $('#toast');
const toastEmojiEl = $('#toastEmoji');
const toastTextEl  = $('#toastText');
let toastTimer;

function showToast(emoji, text) {
  toastEmojiEl.textContent = emoji;
  toastTextEl.textContent  = text;

  /* Restart the animation. Removing the class isn't enough on its own —
     the browser batches the remove with the re-add and sees no change at
     all, so forcing a reflow in between is what actually replays it. */
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}
window.showToast = showToast;

const CONFETTI_COLOURS = ['#FF6FB0', '#FFD97D', '#BCEF6A', '#62DDF0', '#AE90FF', '#FF8FC7'];

function confetti(count = 50) {
  if (!likesMotion) return;
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = pick(CONFETTI_COLOURS);
    p.style.setProperty('--cx', `${(Math.random() - 0.5) * 240}px`);
    p.style.setProperty('--cr', `${Math.random() * 1000}deg`);
    p.style.setProperty('--cd', `${rand(2.2, 4.4)}s`);
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    if (Math.random() > 0.5) p.style.borderRadius = '50%';
    frag.appendChild(p);
    setTimeout(() => p.remove(), 5400);
  }
  document.body.appendChild(frag);
}
window.confetti = confetti;


/* ==========================================================================
   8. FLIP CARDS
   ========================================================================== */
const flippedBefore = store.getList('mpd_facts');

$$('.fact-card').forEach((card, i) => {
  if (flippedBefore.includes(i)) card.classList.add('flipped');

  card.addEventListener('click', () => {
    card.classList.toggle('flipped');

    if (!flippedBefore.includes(i)) {
      flippedBefore.push(i);
      store.setList('mpd_facts', flippedBefore);
      if (claim(`fact-${i}`)) addStars(1, '+1 ⭐ · a brand new one');

      if (flippedBefore.length === 6 && claim('all-facts')) {
        addStars(2, '+2 ⭐ · all six flipped!');
        confetti(40);
      }
    }
  });
});


/* ==========================================================================
   9. RIDDLES

   Answers are read off data-answers in the HTML, so a new riddle is a
   copy-pasted block and no JavaScript at all.
   ========================================================================== */
const riddles        = $$('.riddle');
const riddleSolvedEl = $('#riddleSolved');
const riddleBarEl    = $('#riddleBarFill');
const riddleState    = store.getList('mpd_riddles');

/* Tidy an answer so "  The MOON!! " and "moon" both match: lowercase,
   strip punctuation, collapse spaces, drop a leading article. */
function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the)\s+/, '');
}

const wrongReplies = [
  'nope! but I like your thinking.',
  'not that one. try the hint? 💡',
  'close enough to be really annoying.',
  'no — have another go.',
  'that is a better answer than mine, but no.',
];

function paintRiddleProgress() {
  const solved = riddleState.filter((s) => s.endsWith('-solved')).length;
  riddleSolvedEl.textContent = String(solved);
  riddleBarEl.style.width = `${(riddleState.length / riddles.length) * 100}%`;
}

riddles.forEach((riddle, i) => {
  const raw     = riddle.dataset.answers || '';
  const answers = raw.split('|').map(normalise);
  const shown   = raw.split('|')[0];
  const hint    = riddle.dataset.hint || '';

  const input    = riddle.querySelector('.riddle-input');
  const feedback = riddle.querySelector('.riddle-feedback');

  /* already finished on a previous visit */
  const prior = riddleState.find((s) => s.startsWith(`${i}-`));
  if (prior) {
    riddle.classList.add('done');
    feedback.className = 'riddle-feedback good';
    feedback.textContent = prior.endsWith('-solved')
      ? `⭐ ${shown} — you had this one!`
      : `${shown}.`;
  }

  function finish(how) {
    riddle.classList.add('done');
    if (how === 'solved' && likesMotion) {
      riddle.classList.add('just-solved');
      setTimeout(() => riddle.classList.remove('just-solved'), 600);
    }

    riddleState.push(`${i}-${how}`);
    store.setList('mpd_riddles', riddleState);
    paintRiddleProgress();

    if (how === 'solved' && claim(`riddle-${i}`)) {
      addStars(2, '+2 ⭐ · solved it!');
      confetti(34);
    }

    if (riddleState.length === riddles.length) {
      setTimeout(() => showToast('🧩', 'all six! that is the afternoon gone.'), 1000);
    }
  }

  function check() {
    const guess = normalise(input.value);
    if (!guess) return;

    if (answers.includes(guess)) {
      feedback.className = 'riddle-feedback good';
      feedback.textContent = `⭐ ${shown}. yes!`;
      finish('solved');
    } else {
      feedback.className = 'riddle-feedback';
      feedback.textContent = pick(wrongReplies);
      input.select();
    }
  }

  riddle.querySelector('.riddle-check').addEventListener('click', check);

  /* Enter should submit — nobody reaches for the button. */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); check(); }
  });

  riddle.querySelector('.riddle-hint-btn').addEventListener('click', () => {
    feedback.className = 'riddle-feedback';
    feedback.textContent = `💡 ${hint}`;
  });

  riddle.querySelector('.riddle-reveal-btn').addEventListener('click', () => {
    feedback.className = 'riddle-feedback good';
    feedback.textContent = `${shown}. no ⭐ for that one though!`;
    finish('revealed');
  });
});

paintRiddleProgress();


/* ==========================================================================
   10. CUSTOM CURSOR

   The real pointer is replaced by a little face with a rainbow halo and a
   tail of dots.

   THE TAIL'S TRICK: each dot chases the one IN FRONT of it, not the
   mouse. That chain is what makes it curl and whip round corners instead
   of following in a straight line. The loop walks the list BACKWARDS on
   purpose — forwards, each dot would chase a leader that had already
   moved this frame, and the whole tail would snap tight instantly.

   The face itself does NOT ease towards the mouse. It sits exactly on it,
   because it's standing in for the pointer and any easing there just
   reads as lag.

   The (pointer: fine) check is deliberate — a phone has no pointer to
   replace, so nothing is built and nothing is hidden.
   ========================================================================== */
const TAIL_LENGTH  = 14;
const TAIL_COLOURS = ['#FF6FB0', '#FFD97D', '#BCEF6A', '#62DDF0', '#AE90FF', '#FF8FC7'];

if (likesMotion && window.matchMedia('(pointer: fine)').matches) {
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML =
    '<span class="cursor-buddy">' +
      '<span class="cursor-ring"></span>' +
      '<span class="cursor-face"><span class="cursor-eye"></span><span class="cursor-eye"></span></span>' +
    '</span>';
  document.body.appendChild(cursor);

  const dots = Array.from({ length: TAIL_LENGTH }, (_, i) => {
    const dot = document.createElement('span');
    dot.className = 'cursor-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.background = TAIL_COLOURS[i % TAIL_COLOURS.length];
    const scale = 1 - i / TAIL_LENGTH;
    dot.dataset.scale = String(scale);
    dot.style.opacity = String(scale * 0.75);
    document.body.appendChild(dot);
    return { el: dot, x: 0, y: 0, scale };
  });

  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let size = 1;
  let target = 1;

  window.addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    cursor.classList.add('on');

    /* grow over anything clickable */
    const over = e.target.closest('a, button, input, .fact-card, .day-card, label');
    target = over ? 1.5 : 1;
  }, { passive: true });

  window.addEventListener('mousedown', () => { target = 0.7; });
  window.addEventListener('mouseup',   () => { target = 1; });
  document.addEventListener('mouseleave', () => cursor.classList.remove('on'));

  /* the game canvas is its own pointer, so hide ours over it */
  const wrap = $('#canvasWrap');
  if (wrap) {
    wrap.addEventListener('mouseenter', () => cursor.classList.remove('on'));
    wrap.addEventListener('mouseleave', () => cursor.classList.add('on'));
  }

  function tick() {
    size += (target - size) * 0.2;

    /* JS owns this transform: position AND scale are the same property,
       so they have to be written together in one line. */
    cursor.style.transform = `translate(${mx}px, ${my}px) scale(${size})`;

    /* backwards, so each dot chases where its leader was LAST frame */
    for (let i = dots.length - 1; i > 0; i--) {
      const dot = dots[i];
      const lead = dots[i - 1];
      dot.x += (lead.x - dot.x) * 0.35;
      dot.y += (lead.y - dot.y) * 0.35;
      dot.el.style.transform =
        `translate(${dot.x - 4}px, ${dot.y - 4}px) scale(${dot.scale})`;
    }
    dots[0].x += (mx - dots[0].x) * 0.35;
    dots[0].y += (my - dots[0].y) * 0.35;
    dots[0].el.style.transform =
      `translate(${dots[0].x - 4}px, ${dots[0].y - 4}px) scale(${dots[0].scale})`;

    requestAnimationFrame(tick);
  }

  /* Only now hide the real pointer — everything above succeeded. */
  document.documentElement.classList.add('custom-cursor');
  requestAnimationFrame(tick);
}


/* ==========================================================================
   11. SCROLL: REVEAL, PROGRESS, ACTIVE LINK
   ========================================================================== */
if (likesMotion && 'IntersectionObserver' in window) {
  const targets = $$('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
  targets.forEach((el) => io.observe(el));
} else {
  /* no observer, no animation — show everything rather than nothing */
  $$('.reveal').forEach((el) => el.classList.add('in'));
}

const progressEl = $('#scrollProgress');
const navLinks   = $$('.nav-links a');
const sections   = navLinks
  .map((a) => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

/* One handler for both jobs, rAF-throttled — scroll fires far more often
   than the screen can repaint, so doing layout reads on every event is
   wasted work. */
let scrollQueued = false;

function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;

  requestAnimationFrame(() => {
    const top = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressEl.style.width = `${max > 0 ? (top / max) * 100 : 0}%`;

    /* whichever section is nearest a third of the way down the screen */
    const line = top + window.innerHeight * 0.33;
    let current = -1;
    sections.forEach((section, i) => {
      if (section.offsetTop <= line) current = i;
    });
    navLinks.forEach((a, i) => a.classList.toggle('active', i === current));

    scrollQueued = false;
  });
}

window.addEventListener('scroll', onScroll, { passive: true });


/* ==========================================================================
   STARTUP

   Order matters: restore the saved mix BEFORE the dials, so a returning
   visitor's own levels aren't overwritten by the defaults.
   ========================================================================== */
const savedMaster = Number(store.get('mpd_master', 70));
masterSliders.forEach((el) => { el.value = String(savedMaster); });
if (masterValue) masterValue.textContent = String(savedMaster);
window.Ambience.master(savedMaster);

const savedMix = store.getList('mpd_mix');
if (savedMix.length === 4) {
  const mix = {};
  CHANNELS.forEach((n, i) => { mix[n] = savedMix[i]; });
  applyMix(mix);
}

/* All three dials, then the sound once at the end - so a visitor's own
   levels survive, and a first-time visitor gets one composed mix rather
   than three half-applied ones. */
setSeason(season,  { keepMix: true });
setWeather(weather, { keepMix: true });
setTime(time,      { keepMix: savedMix.length === 4 });

/* if the clock was driving last time, let it carry on */
if (liveTime) setLive(true);

/* the caption isn't set by the fade path on the very first paint */
heroCaption.textContent = dialCaption();

paintJar();
paintSoundBtn();
onScroll();

/* A ripple on every button press. One listener on the document rather
   than one per button, so anything added later gets it too. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || !likesMotion) return;

  const box = btn.getBoundingClientRect();
  const size = Math.max(box.width, box.height) * 1.3;
  const ring = document.createElement('span');
  ring.className = 'btn-ripple';
  ring.style.width = ring.style.height = `${size}px`;
  ring.style.left = `${e.clientX - box.left - size / 2}px`;
  ring.style.top  = `${e.clientY - box.top  - size / 2}px`;
  btn.appendChild(ring);
  setTimeout(() => ring.remove(), 660);
});
