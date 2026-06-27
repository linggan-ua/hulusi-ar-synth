class GuitarProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.strings = [];
    this.port.onmessage = (e) => {
      if (e.data.type === 'pluck') this.addString(e.data.freq, e.data.velocity, e.data.params);
    };
  }

  generateExcitation(size, style, velocity) {
    const buf = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      let n = (Math.random() * 2 - 1) * velocity;
      switch (style) {
        case 'folk':
        case 'classical':
        case 'bossa':

          if (i > 1) n = buf[i-2]*0.15 + buf[i-1]*0.55 + n*0.30;
          break;
        case 'rock':
        case 'country':

          n = Math.tanh(n * 2.0) * 0.85;
          break;
        case 'metal':
        case 'funk':

          n = Math.sign(n) * Math.min(Math.abs(n * 4.0), 1.0) * 0.9;
          break;
        case 'jazz':
        case 'blues':

          if (i > 0) n = buf[i-1]*0.45 + n*0.55;
          break;
        case 'shoegaze':

          n = Math.tanh(n * 1.6) * 0.9;
          break;
        case 'ambient':

          if (i > 2) n = buf[i-3]*0.1 + buf[i-2]*0.2 + buf[i-1]*0.5 + n*0.2;
          break;
      }
      buf[i] = n;
    }
    return buf;
  }

  distort(x, drive) { return Math.tanh(x * drive) / Math.tanh(drive); }
  lp(x, prev, a) { return prev + a * (x - prev); }
  hp(x, prev, a) { return a * (prev + x - prev); } // Simple first-order highpass

  addString(freq, velocity, params) {
    const size = Math.round(sampleRate / freq);
    this.strings.push({
      buf: this.generateExcitation(size, params.style, velocity),
      size, pos: 0,
      style: params.style,
      p: params,
      env: { phase: 'attack', amp: 0 },
      f: { lp1: 0, lp2: 0, hp1: 0 },
      lfo: 0,
      alive: true,
    });
  }

  processString(s) {
    const dt = 1 / sampleRate;
    const env = s.env;
    const p = s.p;

    let e = 0;
    if (env.phase === 'attack') {
      env.amp += dt / p.attack;
      if (env.amp >= 1) { env.amp = 1; env.phase = 'decay'; }
      e = env.amp;
    } else if (env.phase === 'decay') {
      env.amp -= dt / p.decay * (1 - p.sustain);
      if (env.amp <= p.sustain) { env.amp = p.sustain; env.phase = 'sustain'; }
      e = env.amp;
    } else if (env.phase === 'sustain') {
      e = p.sustain;
    } else if (env.phase === 'release') {
      env.amp -= dt / p.release * p.sustain;
      if (env.amp <= 0.0005) { s.alive = false; return 0; }
      e = env.amp;
    }

    const next = (s.pos + 1) % s.size;
    let ks = (s.buf[s.pos] + s.buf[next]) * 0.5 * p.brightness;
    s.lfo += dt;

    let out = 0;
    switch (s.style) {

      case 'folk': {

        ks = this.lp(ks, s.f.lp1, 0.30); s.f.lp1 = ks;
        ks = this.lp(ks, s.f.lp2, 0.50); s.f.lp2 = ks;
        out = ks;
        break;
      }

      case 'classical': {

        ks = this.lp(ks, s.f.lp1, 0.22); s.f.lp1 = ks;
        ks = this.lp(ks, s.f.lp2, 0.35); s.f.lp2 = ks;
        out = ks;
        break;
      }

      case 'rock': {

        ks = this.lp(ks, s.f.lp1, 0.70); s.f.lp1 = ks;
        let dist = this.distort(ks * 4.0, p.drive);

        s.f.hp1 = 0.85 * (s.f.hp1 + dist - ks);
        out = dist * 0.6 + s.f.hp1 * 0.4;
        break;
      }

      case 'metal': {

        ks = this.lp(ks, s.f.lp1, 0.85); s.f.lp1 = ks;
        let dist = Math.max(-0.7, Math.min(0.7, ks * p.drive));

        s.f.hp1 = 0.90 * (s.f.hp1 + dist - s.f.lp2);
        s.f.lp2 = dist;
        out = dist * 0.5 + s.f.hp1 * 0.5;
        break;
      }

      case 'jazz': {

        ks = this.lp(ks, s.f.lp1, 0.20); s.f.lp1 = ks;
        ks = this.lp(ks, s.f.lp2, 0.30); s.f.lp2 = ks;
        const chorus = Math.sin(s.lfo * 3.1) * 0.012;
        out = ks * (1 + chorus);
        break;
      }

      case 'blues': {

        ks = this.lp(ks, s.f.lp1, 0.40); s.f.lp1 = ks;
        let od = this.distort(ks * 2.5, 2.0);

        s.f.lp2 = this.lp(od, s.f.lp2, 0.15);
        out = od * 0.65 + s.f.lp2 * 0.35;
        break;
      }

      case 'country': {

        ks = this.lp(ks, s.f.lp1, 0.75); s.f.lp1 = ks;
        const twang = ks - s.f.lp2;
        s.f.lp2 = ks;
        out = ks * 0.45 + twang * 0.55;
        break;
      }

      case 'funk': {

        ks = this.lp(ks, s.f.lp1, 0.60); s.f.lp1 = ks;
        out = this.distort(ks * 2.2, 1.8) * Math.pow(e, 3.0);
        e = 1; // Envelope already embedded, no longer multiplied externally
        break;
      }

      case 'shoegaze': {

        ks = this.lp(ks, s.f.lp1, 0.55); s.f.lp1 = ks;
        let dist = this.distort(ks * 3.0, 2.5);
        const c1 = Math.sin(s.lfo * 2.3) * 0.05;
        const c2 = Math.sin(s.lfo * 3.7) * 0.04;
        const c3 = Math.sin(s.lfo * 1.1) * 0.03;
        out = dist * (1 + c1 + c2 + c3);
        break;
      }

      case 'bossa': {

        ks = this.lp(ks, s.f.lp1, 0.28); s.f.lp1 = ks;
        ks = this.lp(ks, s.f.lp2, 0.42); s.f.lp2 = ks;
        const vib = 1 + Math.sin(s.lfo * 5.5) * 0.006;
        out = ks * vib;
        break;
      }

      case 'ambient': {

        ks = this.lp(ks, s.f.lp1, 0.18); s.f.lp1 = ks;
        ks = this.lp(ks, s.f.lp2, 0.25); s.f.lp2 = ks;
        const swell = 1 + Math.sin(s.lfo * 0.8) * 0.02;
        out = ks * swell;
        break;
      }

      default:
        ks = this.lp(ks, s.f.lp1, p.cutoff); s.f.lp1 = ks;
        out = ks;
    }

    s.buf[s.pos] = ks;
    s.pos = next;
    return out * e;
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (const str of this.strings) if (str.alive) s += this.processString(str);
      this.strings = this.strings.filter(x => x.alive);
      out[i] = Math.tanh(s * 0.45);
    }
    return true;
  }
}
registerProcessor('guitar-processor', GuitarProcessor);
