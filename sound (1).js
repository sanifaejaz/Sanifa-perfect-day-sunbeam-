/* ==========================================================================
   sound.js — the four weathers, built out of noise

   There are no audio files on this page. Every sound is synthesised in the
   browser with the Web Audio API, which means it never loops, never
   repeats itself, and downloads nothing.

   THE TWO TRICKS WORTH KNOWING

   1. Noise, then filters. Rain, wind and waves are all the same raw
      ingredient — a buffer of random numbers — put through different
      filters. Rain is noise with the low end taken out. Wind is noise with
      the high end taken out. Waves are wind that breathes. That's genuinely
      most of it.

   2. Slow oscillators instead of timers. To make wind gust, you need its
      volume and its filter to wander. The obvious way is a setInterval that
      nudges values, which drifts, stutters and stops when the tab is
      hidden. The better way is to run oscillators at fractions of a hertz
      and wire them straight into the parameter. Two LFOs at 0.083 Hz and
      0.037 Hz never line up — 1/0.083 and 1/0.037 aren't whole multiples of
      each other — so their sum wanders for hours without ever repeating,
      and it's the audio thread doing it rather than JavaScript.

   Only rain's droplets and the birds are actually scheduled, because those
   are discrete events rather than a continuous texture.

     1. Setup + the noise buffers
     2. The reverb
     3. Rain
     4. Wind
     5. Waves
     6. Birds
     7. The scheduler
     8. The public controls
   ========================================================================== */

window.Ambience = (function () {
  'use strict';

  /* Levels live out here, not in the audio graph, so the sliders work
     before the browser has let us make any sound at all. Whatever is set
     while muted is simply applied the moment audio is unlocked. */
  const levels = { rain: 0, wind: 0, waves: 0, birds: 0 };
  let masterLevel = 0.7;
  let enabled = false;

  let ctx = null;
  let master = null;
  let reverb = null;
  const ch = {};              /* per-channel gain nodes, by name */
  let scheduler = null;

  /* How loud each channel is at slider 100. Set by ear: rain is broadband
     and reads as loud, birds are sparse and read as quiet, so they can't
     share a scale. */
  /* Per-channel ceilings, so a slider at 100 is "as loud as this sound should
   ever be" rather than "as loud as a gain of 1". The breeze carries the most
   of the mix now, so it gets the most headroom. */
const CEILING = { rain: 0.34, wind: 0.46, waves: 0.33, birds: 0.22 };

  const now = () => ctx.currentTime;

  /* Ramp rather than jump. Every gain change on this page goes through
     here — a direct assignment to .value produces an audible click, since
     it's a step change in the waveform. */
  function ramp(param, value, seconds = 0.25) {
    param.setTargetAtTime(value, now(), seconds / 3);
  }


  /* ========================================================================
     1. SETUP + THE NOISE BUFFERS
     ======================================================================== */

  /* White noise: every sample independent and random. Equal energy at
     every frequency, which sounds like static or heavy rain. */
  function whiteBuffer(seconds) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* Pink noise: energy falls off at 3dB per octave rather than brown's 6.
     That half-step matters here. Brown noise is all bottom end and reads as
     a rumble; pink keeps enough air in it to sound like moving air and open
     water. This is the Paul Kellett filter bank — six one-pole filters
     summed, which approximates the 1/f slope closely enough that nobody has
     ever been able to tell. */
  function pinkBuffer(seconds) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  /* A looping noise source. The buffer is several seconds long and the
     filters downstream are always moving, so the loop point never becomes
     audible the way a looped recording would. */
  function noiseSource(buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  /* A very slow oscillator wired into an AudioParam. Several of these can
     target the same param — Web Audio sums every connection into a param,
     which is what lets three wandering curves add up to one that never
     repeats. */
  function lfo(rate, depth, target, type = 'sine') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = depth;
    osc.connect(amp).connect(target);
    osc.start();
    return osc;
  }

  /* One gain node per channel, all feeding the master. Channels are built
     once and left running at zero gain — starting and stopping sources on
     demand costs more and clicks. */
  function channel(name) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    ch[name] = g;
    return g;
  }


  /* ========================================================================
     2. THE REVERB

     A convolver needs an impulse response, which is normally a recording of
     a real room. We can fake a perfectly good one: noise that decays
     exponentially IS the impulse response of a diffuse space. Two channels
     generated independently gives it stereo width.
     ======================================================================== */
  function makeReverb(seconds, decay) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);

    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }

    const conv = ctx.createConvolver();
    conv.buffer = buf;

    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    conv.connect(wet).connect(master);
    return conv;
  }


  /* ========================================================================
     3. RAIN

     Two layers, because real rain is two sounds: a broadband hiss (rain in
     the air, everywhere at once) and individual impacts (rain hitting
     things near you). One without the other sounds like a radio between
     stations.
     ======================================================================== */
  function buildRain() {
    const out = channel('rain');
    const white = whiteBuffer(4);

    /* --- the hiss --- */
    const hiss = noiseSource(white);

    /* Take out the bottom. Rain has almost no low end; leaving it in is
       what makes synthetic rain sound like a waterfall. */
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 620;

    /* And roll off the very top, so it's rain rather than static. */
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7200;

    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.62;

    hiss.connect(hp).connect(lp).connect(hissGain).connect(out);

    /* The shower drifts in intensity — heavier for a while, then lighter.
       Two slow LFOs on the low-pass cutoff, at rates that don't divide
       into each other. */
    lfo(0.041, 1400, lp.frequency);
    lfo(0.017, 900,  lp.frequency);
    lfo(0.029, 0.14, hissGain.gain);

    /* --- the droplets --- */
    const dropBus = ctx.createGain();
    dropBus.gain.value = 1;
    dropBus.connect(out);

    /* The reverb send is taken AFTER the channel gain, and that placement
       is the whole point. An earlier version sent from dropBus, which sits
       BEFORE it — so the wet path skipped the rain slider completely and
       droplets went on echoing at full level with rain turned all the way
       down. It measured as broadband low-frequency energy leaking into
       every other channel, and you could hear it as a phantom drip under
       the birds. A send must always come off the far side of the fader it
       is supposed to obey. */
    const send = ctx.createGain();
    send.gain.value = 0.22;
    out.connect(send).connect(reverb);

    return { out, dropBus, white };
  }

  /* One drop. A tiny burst of noise through a resonant bandpass: the filter
     rings at its centre frequency, and that ring is the pitch you hear when
     water hits a surface. Random frequency per drop = drops landing on
     different things. */
  function dropletAt(time, rain) {
    const src = ctx.createBufferSource();
    src.buffer = rain.white;
    /* start somewhere random in the buffer so no two drops are identical */
    const offset = Math.random() * 3;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 2600;
    bp.Q.value = 5 + Math.random() * 9;

    const env = ctx.createGain();
    env.gain.value = 0;

    src.connect(bp).connect(env).connect(rain.dropBus);

    const peak = 0.04 + Math.random() * 0.11;
    const decay = 0.035 + Math.random() * 0.09;

    /* fast attack, exponential decay — the shape of any small impact */
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    src.start(time, offset, decay + 0.05);
    src.stop(time + decay + 0.06);
  }


  /* ========================================================================
     4. WIND

     Brown noise, heavily filtered, with everything wandering. A gust is not
     a volume change — it's a volume change AND the filter opening at the
     same time, because faster air makes a brighter sound. Move only the
     volume and it reads as someone turning a knob.
     ======================================================================== */
  function buildWind() {
    const out = channel('wind');
    const src = noiseSource(pinkBuffer(7));

    /* A breeze is air moving PAST something, and what you actually hear is
       a band of frequencies sliding around — not a low rumble getting
       louder. So the shaping is a bandpass that wanders, with a lowpass
       above it to take the fizz off the top. Brown noise through a lowpass
       (what this used to be) can only ever sound like distant traffic. */
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    /* Base and depths are chosen together: the LFO depths SUM, and if base
       minus that sum crosses zero the filter clamps and the breeze drops
       out for part of every cycle. 420 against 265 keeps it in 155-685Hz. */
    bp.frequency.value = 420;
    bp.Q.value = 1.1;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1250;
    lp.Q.value = 0.5;

    const body = ctx.createGain();
    body.gain.value = 0.85;

    src.connect(bp).connect(lp).connect(body).connect(out);

    /* Two very slow, incommensurate rates on the band. 0.06Hz is one sweep
       every ~17s, 0.013Hz one every ~77s; summed, no two gusts land the
       same way and the pattern never comes back round. */
    lfo(0.060, 170, bp.frequency);
    lfo(0.013, 95,  bp.frequency);

    /* Volume moves with it, but on its own rate — so the loudest moment
       and the brightest moment don't coincide. That mismatch is most of
       what makes it read as weather rather than a fader. */
    lfo(0.090, 0.22, body.gain);
    lfo(0.031, 0.12, body.gain, 'triangle');

    /* Gusts: a second, brighter path that opens now and then. A real gust
       arrives as a burst of high air well before the body of it lands, so
       this sits an octave up and swings harder than the bed does. */
    const gust = ctx.createBiquadFilter();
    gust.type = 'bandpass';
    gust.frequency.value = 1400;
    gust.Q.value = 2.4;

    const gustGain = ctx.createGain();
    gustGain.gain.value = 0.14;

    src.connect(gust).connect(gustGain).connect(out);
    lfo(0.047, 620,  gust.frequency);
    lfo(0.023, 0.11, gustGain.gain);

    /* And a thread of leaf rustle over the top — the thing you actually
       hear in a garden. Kept very quiet: at any real level it turns into
       radio static. */
    const leaves = ctx.createBiquadFilter();
    leaves.type = 'highpass';
    leaves.frequency.value = 3200;

    const leafGain = ctx.createGain();
    leafGain.gain.value = 0.045;

    src.connect(leaves).connect(leafGain).connect(out);
    lfo(0.077, 0.035, leafGain.gain);

    return out;
  }


  /* ========================================================================
     5. WAVES

     The swell is the whole thing. A wave is a slow rise, a brief bright
     break, and a long recede — and crucially the gaps between them are
     uneven. Summing two LFOs at 0.105 Hz and 0.071 Hz gives a swell that
     peaks roughly every nine seconds but never twice the same, which is
     what the sea actually does.
     ======================================================================== */
  function buildWaves() {
    const out = channel('waves');
    const src = noiseSource(pinkBuffer(8));

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.7;

    /* The swell rides on a floor, so the sea never goes fully silent
       between waves — there is always some wash. */
    const swell = ctx.createGain();
    swell.gain.value = 0.5;

    /* Pink noise through a 700Hz lowpass leaves a lot of energy below
       40Hz. You cannot hear it on any normal speaker, but it is the
       loudest thing in the mix by the meter, so it eats headroom and
       makes the compressor duck everything else. Take it off the bottom. */
    const sub = ctx.createBiquadFilter();
    sub.type = 'highpass';
    sub.frequency.value = 45;
    /* 0.707 is the flat setting. The default Q of 1 puts a small resonant
       bump right at the cutoff, which is the opposite of the point. */
    sub.Q.value = 0.707;

    src.connect(lp).connect(sub).connect(swell).connect(out);

    /* Two rates make the rhythm: 0.08Hz is the wave itself, about one
       every twelve seconds, and 0.021Hz is the set — the slow business of
       waves arriving in groups of bigger and smaller. Summed depth stays
       under the 0.5 floor so the gain never crosses zero, because a
       negative gain inverts phase rather than muting, and noise sounds
       identical inverted. */
    lfo(0.080, 0.28, swell.gain);
    lfo(0.021, 0.13, swell.gain);

    /* The filter opens as each wave breaks. That brightening is the crash,
       and it is the whole reason this reads as surf and not as a fan. */
    lfo(0.080, 300, lp.frequency);

    /* A separate hiss layer for foam, swelling with the wave.

       This was originally written with a negative base gain, on the idea
       that the foam would sit "below zero" and be silent between waves.
       That is not what a negative gain does — see the note above. A
       GainNode cannot gate; it can only scale. So the base stays positive
       and small, and the LFOs ride on top of it. */
    const foam = noiseSource(whiteBuffer(4));

    const foamHp = ctx.createBiquadFilter();
    foamHp.type = 'highpass';
    foamHp.frequency.value = 1900;

    const foamGain = ctx.createGain();
    foamGain.gain.value = 0.05;

    foam.connect(foamHp).connect(foamGain).connect(out);
    /* 0.030 + 0.016 stays just inside the 0.05 base. Overshoot it and the
       foam swings negative, which is the inverted-phase bug all over
       again. */
    lfo(0.080, 0.030, foamGain.gain);
    lfo(0.021, 0.016, foamGain.gain);

    return out;
  }


  /* ========================================================================
     6. BIRDS

     A chirp is a pitch sweep, not a note. Sine wave, frequency ramped up
     and back down inside about a tenth of a second, with a fast envelope.
     Sweep direction and distance are what make one species sound different
     from another.

     Birds also never sing evenly. They sing a phrase of a few notes, then
     stop for a few seconds. So: random phrases, random gaps, and each
     phrase gets its own base pitch so it sounds like different birds at
     different distances.
     ======================================================================== */
  function buildBirds() {
    const out = channel('birds');

    /* wet send — birds outdoors are always slightly far away */
    const send = ctx.createGain();
    send.gain.value = 0.55;
    out.connect(send).connect(reverb);

    return out;
  }

  function chirpAt(time, base, dur, up) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';

    const env = ctx.createGain();
    env.gain.value = 0;

    /* a touch of the second harmonic stops it sounding like a test tone */
    const harm = ctx.createOscillator();
    harm.type = 'sine';
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.18;

    osc.connect(env);
    harm.connect(harmGain).connect(env);
    env.connect(ch.birds);

    const top = base * (up ? 1.7 : 0.62);

    /* the sweep: up fast, then settle back part of the way */
    osc.frequency.setValueAtTime(base, time);
    osc.frequency.exponentialRampToValueAtTime(top, time + dur * 0.42);
    osc.frequency.exponentialRampToValueAtTime(base * 1.08, time + dur);

    harm.frequency.setValueAtTime(base * 2, time);
    harm.frequency.exponentialRampToValueAtTime(top * 2, time + dur * 0.42);
    harm.frequency.exponentialRampToValueAtTime(base * 2.16, time + dur);

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.5, time + dur * 0.13);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.start(time);  osc.stop(time + dur + 0.02);
    harm.start(time); harm.stop(time + dur + 0.02);
  }

  /* One bird's phrase: two to five chirps, all from the same throat. */
  function phraseAt(time) {
    const base  = 1500 + Math.random() * 2100;
    const notes = 2 + Math.floor(Math.random() * 4);
    const up    = Math.random() > 0.28;

    let t = time;
    for (let i = 0; i < notes; i++) {
      const dur = 0.06 + Math.random() * 0.1;
      /* wobble the pitch a little per note, within the same voice */
      chirpAt(t, base * (0.92 + Math.random() * 0.16), dur, up);
      t += dur + 0.03 + Math.random() * 0.11;
    }
    return t;
  }


  /* ========================================================================
     7. THE SCHEDULER

     Droplets and birds are discrete events, so something has to place them.
     The rule with Web Audio is to schedule ahead of time against the audio
     clock and never against setInterval — the interval only has to wake up
     often enough to keep the queue full.

     That matters because a hidden tab throttles timers to about once a
     second while the audio clock keeps perfect time. A two-second lookahead
     means even a throttled tick still has a second of slack, so nothing
     bunches up or gaps out when you switch away and come back.
     ======================================================================== */
  const LOOKAHEAD = 2.0;   /* seconds of events kept queued */
  const TICK      = 500;   /* ms between checks             */

  let rainRig     = null;
  let nextDrop    = 0;
  let nextPhrase  = 0;

  function tick() {
    const horizon = now() + LOOKAHEAD;

    /* --- droplets. Density follows the slider: at a light setting you get
       the occasional tap, at full you get a downpour. --- */
    if (levels.rain > 0.01) {
      const gap = 0.55 - levels.rain * 0.48;   /* 0.55s → 0.07s */
      while (nextDrop < horizon) {
        if (nextDrop > now()) dropletAt(nextDrop, rainRig);
        nextDrop += gap * (0.35 + Math.random() * 1.5);
      }
    } else {
      nextDrop = now();
    }

    /* --- bird phrases. The gap shortens as the slider rises, but never
       becomes constant — a bird that sang on a timer would be unbearable. */
    if (levels.birds > 0.01) {
      const gap = 7.5 - levels.birds * 5.6;    /* 7.5s → 1.9s */
      while (nextPhrase < horizon) {
        if (nextPhrase > now()) {
          const end = phraseAt(nextPhrase);
          nextPhrase = end + gap * (0.4 + Math.random() * 1.6);
        } else {
          nextPhrase += gap;
        }
      }
    } else {
      nextPhrase = now();
    }
  }


  /* ========================================================================
     8. THE PUBLIC CONTROLS
     ======================================================================== */

  /* Build the graph. Must be called from inside a real user gesture — a
     browser will hand back a suspended AudioContext otherwise, and every
     sound would be scheduled correctly into silence. */
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    try {
      ctx = new AC();
    } catch (err) {
      return false;
    }

    master = ctx.createGain();
    master.gain.value = 0;

    /* A gentle compressor across everything. Four independent noise beds
       whose peaks land wherever they like will occasionally all swell at
       once; without this, that moment jumps out at you. Slow release so it
       leans on the loud parts instead of pumping. */
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value      = 12;
    glue.ratio.value     = 3;
    glue.attack.value    = 0.01;
    glue.release.value   = 0.30;

    master.connect(glue).connect(ctx.destination);

    reverb  = makeReverb(1.9, 2.6);
    rainRig = buildRain();
    buildWind();
    buildWaves();
    buildBirds();

    nextDrop   = now();
    nextPhrase = now() + 1.2;

    scheduler = setInterval(tick, TICK);
    apply();
    return true;
  }

  /* Push every stored level into the graph. Called after any change, and
     once at startup — so the state of the sliders is the single source of
     truth and the audio graph just follows it. */
  function apply() {
    if (!ctx) return;
    ramp(master.gain, enabled ? masterLevel : 0, 0.5);
    for (const name in CEILING) {
      if (ch[name]) ramp(ch[name].gain, levels[name] * CEILING[name], 0.35);
    }
  }

  return {
    /* Set one channel, 0..100. Returns nothing; call from an input event. */
    set(name, percent) {
      if (!(name in levels)) return;
      levels[name] = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
      apply();
    },

    master(percent) {
      masterLevel = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
      apply();
    },

    /* Turn the whole thing on. Only works from a user gesture the first
       time; after that it's free. Returns whether sound is now on. */
    on() {
      if (!ensure()) return false;
      enabled = true;
      apply();
      return true;
    },

    off() {
      enabled = false;
      apply();
      return false;
    },

    toggle() { return enabled ? this.off() : this.on(); },

    isOn()   { return enabled; },

    /* Whether anything is actually audible — sound on, master up, and at
       least one channel raised. The nav button uses this. */
    isAudible() {
      if (!enabled || masterLevel <= 0.01) return false;
      return Object.keys(levels).some((k) => levels[k] > 0.01);
    },

    levels()      { return { ...levels }; },
    masterValue() { return Math.round(masterLevel * 100); },

    /* Set all four at once, from a preset or a shared link. Values 0..100. */
    setAll(next) {
      for (const name in levels) {
        if (name in next) {
          levels[name] = Math.max(0, Math.min(100, Number(next[name]) || 0)) / 100;
        }
      }
      apply();
    },

    /* Used by the page to decide whether it's worth prompting for sound. */
    exists() { return !!ctx; },
  };
})();
