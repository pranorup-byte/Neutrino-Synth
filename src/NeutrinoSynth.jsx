import { useState, useRef, useEffect, useCallback } from "react";

/* ════════════════════════════════════════════════════════════════════════
   NEUTRINO — wavetable synthesizer
   UI: Vital-style 3-column signal flow · Japanese dusk art direction
   Engine: unchanged SynthEngine (control-rate modulation, per-voice filters)
   ════════════════════════════════════════════════════════════════════════ */

/* ─── DESIGN TOKENS · "Fuji at dusk" ────────────────────────────────────────
   Roles per the art direction: coral/peach = warmth & selection, amber/gold =
   filter emphasis & active states, dusk teal = LFO motion, lavender = macros,
   indigo/charcoal = structure, cream = primary text.                        */
const T = {
  // structure
  night:   "#0d0e1e",            // page ground (charcoal-indigo)
  sky:     ["#1a1c38","#2b2547","#4a3358","#7d4152"], // far background dusk ramp
  panel:   "rgba(24,26,50,0.82)",
  panelHi: "rgba(34,36,66,0.9)",
  inset:   "rgba(12,13,28,0.75)",
  line:    "#33355c",
  lineSoft:"#262848",
  // text
  ink:     "#f2ead9",            // soft cream
  inkDim:  "#a49dbd",            // grey-lavender
  inkFaint:"#645f82",
  // section accents (each is a 2-stop gradient)
  osc:  ["#ff8f6b","#ffc38a"],   // sunset coral → peach   (sources)
  filt: ["#ffb054","#ffe0a1"],   // warm amber → gold      (tone)
  env:  ["#ff9db0","#ffcfa8"],   // dusk rose → peach      (envelope)
  lfo:  ["#5fc4bd","#a8ecd9"],   // twilight teal          (motion)
  mod:  ["#a08cff","#d0b8ff"],   // wisteria lavender      (macros/routing)
  arp:  ["#e0736b","#ffb08a"],   // vermilion              (performance)
  glow: "#ffb054",
  font: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif",
  disp: "'Yuji Syuku','Shippori Mincho', serif",
  mono: "'DM Mono', ui-monospace, monospace",
};
const grad = c => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
const c0 = c => c[0];

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
const WAVEFORMS    = ["sine","triangle","sawtooth","square"];
const FILTER_TYPES = ["lp12","lp24","hp","bp","notch","ladder","comb","formant"];
const FILTER_LBLS  = ["LP12","LP24","HP","BP","NCH","LDR","CMB","FMT"];
const NOTE_NAMES   = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const POLY_MODES   = ["poly","mono","legato"];
const ARP_MODES    = ["up","down","updown","random","played"];
const MOD_DESTS = [
  "Filt1 Cutoff","Filt1 Res","Filt2 Cutoff","Master Vol",
  "Osc1 Pitch","Osc2 Pitch","Osc3 Pitch","Osc1 Vol","Osc2 Vol","Osc3 Vol",
  "Reverb Mix","Delay Mix","Chorus Mix","Dist Drive","Pan Spread",
];
const MOD_CURVES = ["linear","log","exp","s-curve"];
const SRC_GROUPS = [
  { label:"LFO",   color:T.lfo, srcs:["LFO 1","LFO 2","LFO 3"] },
  { label:"ENV",   color:T.env, srcs:["Env 1"] },
  { label:"MACRO", color:T.mod, srcs:["Macro 1","Macro 2","Macro 3","Macro 4"] },
  { label:"PERF",  color:T.osc, srcs:["Velocity","Keytrack","Mod Wheel"] },
];
function srcColor(src){ for(const g of SRC_GROUPS) if(g.srcs.includes(src)) return g.color; return [T.inkDim,T.inkDim]; }

const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function waveValue(wave, phase){
  switch(wave){
    case "sine":     return Math.sin(phase*2*Math.PI);
    case "triangle": return phase<0.5 ? 4*phase-1 : 3-4*phase;
    case "sawtooth": return 2*phase-1;
    case "square":   return phase<0.5 ? 1 : -1;
    default:         return Math.sin(phase*2*Math.PI);
  }
}
function applyCurve(v, curve){
  const s = v<0?-1:1, a = Math.abs(v);
  switch(curve){
    case "log":     return s*Math.pow(a,0.5);
    case "exp":     return s*Math.pow(a,2.2);
    case "s-curve": return s*(a*a*(3-2*a));
    default:        return v;
  }
}
function makeDistCurve(drive){
  const n=512, c=new Float32Array(n);
  for(let i=0;i<n;i++){ const x=(2*i/(n-1))-1;
    if(drive<0.01){ c[i]=x; continue; }
    const k=drive*120; c[i]=(Math.PI+k)*x/(Math.PI+k*Math.abs(x)); }
  return c;
}
function makeBitCurve(bits){
  const n=512, steps=Math.pow(2,Math.max(1,bits)), c=new Float32Array(n);
  for(let i=0;i<n;i++){ const x=(2*i/(n-1))-1; c[i]=Math.round(x*steps)/steps; }
  return c;
}
function applyFiltType(node, type, cut, res){
  const c = clamp(cut,20,20000);
  switch(type){
    case "lp12":   node.type="lowpass";  node.frequency.value=c; node.Q.value=res; break;
    case "lp24":   node.type="lowpass";  node.frequency.value=c; node.Q.value=res*1.4; break;
    case "hp":     node.type="highpass"; node.frequency.value=c; node.Q.value=res; break;
    case "bp":     node.type="bandpass"; node.frequency.value=c; node.Q.value=res; break;
    case "notch":  node.type="notch";    node.frequency.value=c; node.Q.value=res; break;
    case "ladder": node.type="lowpass";  node.frequency.value=c; node.Q.value=clamp(res*1.8,0.1,20); break;
    case "comb":   node.type="bandpass"; node.frequency.value=c; node.Q.value=Math.max(res*4,2); break;
    case "formant":node.type="bandpass"; node.frequency.value=clamp(c,300,2600); node.Q.value=8; break;
    default:       node.type="lowpass";  node.frequency.value=c; node.Q.value=res;
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SYNTH ENGINE — all Web Audio lives here. React calls public methods only.
   ════════════════════════════════════════════════════════════════════════ */
class SynthEngine {
  constructor(){
    this.ctx = null;
    this.voices = new Map();        // midi -> voice
    this.state = null;              // latest UI snapshot
    this.lfoPhase = [0,0,0];
    this.cc = { 1:0 };
    this.lastVel = 0.8;
    this.lastRandom = 0.5;
    this.lastEnv = 0;
    this.lastMidi = 60;
    this.rrIndex = 0;               // round-robin pointer
    this.activeDests = new Set();
    this.modTimer = null;
    this.onActiveChange = null;     // callback(set of midi)
  }

  init(){
    if(this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // ── post-voice processing chain ──
    const drive = ctx.createWaveShaper(); drive.curve = makeDistCurve(0); drive.oversample="2x";
    const eqLow = ctx.createBiquadFilter(); eqLow.type="lowshelf";  eqLow.frequency.value=200;
    const eqMid = ctx.createBiquadFilter(); eqMid.type="peaking";   eqMid.frequency.value=1000; eqMid.Q.value=1;
    const eqHi  = ctx.createBiquadFilter(); eqHi.type="highshelf";  eqHi.frequency.value=6000;
    const dist  = ctx.createWaveShaper(); dist.curve = makeDistCurve(0); dist.oversample="2x";
    const bit   = ctx.createWaveShaper(); bit.curve = makeBitCurve(16); bit.oversample="none";
    const preFX = ctx.createGain();
    const master= ctx.createGain(); master.gain.value=0.72;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value=-3; limiter.ratio.value=20; limiter.attack.value=0.003; limiter.release.value=0.1;

    drive.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHi);
    eqHi.connect(dist); dist.connect(bit); bit.connect(preFX);

    // dry
    preFX.connect(master);

    // chorus (3 modulated delay lines)
    const chorWet = ctx.createGain(); chorWet.gain.value=0;
    this.chorDelays=[]; this.chorLFOs=[];
    for(let i=0;i<3;i++){
      const d=ctx.createDelay(0.05); d.delayTime.value=0.01+i*0.004;
      const lfo=ctx.createOscillator(); lfo.type="sine"; lfo.frequency.value=0.5+i*0.35;
      const lg=ctx.createGain(); lg.gain.value=0.003;
      lfo.connect(lg); lg.connect(d.delayTime); lfo.start();
      preFX.connect(d); d.connect(chorWet);
      this.chorDelays.push({node:d,lfoGain:lg}); this.chorLFOs.push(lfo);
    }
    chorWet.connect(master);

    // delay (feedback)
    const dly=ctx.createDelay(2); dly.delayTime.value=0.25;
    const dlyFb=ctx.createGain(); dlyFb.gain.value=0;
    const dlyWet=ctx.createGain(); dlyWet.gain.value=0;
    preFX.connect(dly); dly.connect(dlyFb); dlyFb.connect(dly); dly.connect(dlyWet); dlyWet.connect(master);

    // reverb (convolution, generated IR)
    const rvb=ctx.createConvolver();
    const irLen=Math.floor(ctx.sampleRate*2.5), ir=ctx.createBuffer(2,irLen,ctx.sampleRate);
    for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch);
      for(let i=0;i<irLen;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/irLen,2.6); }
    rvb.buffer=ir;
    const rvbWet=ctx.createGain(); rvbWet.gain.value=0;
    preFX.connect(rvb); rvb.connect(rvbWet); rvbWet.connect(master);

    master.connect(limiter); limiter.connect(ctx.destination);

    // analyser for the master scope
    const analyser=ctx.createAnalyser(); analyser.fftSize=1024;
    master.connect(analyser);

    this.nodes = { drive, eqLow, eqMid, eqHi, dist, bit, preFX, master, limiter,
                   chorWet, dly, dlyFb, dlyWet, rvbWet, analyser };

    // start modulation loop (~90 Hz)
    this.modTimer = setInterval(()=>this._modTick(), 11);
  }

  resume(){ if(this.ctx && this.ctx.state==="suspended") this.ctx.resume(); }

  // ── apply non-modulated base parameters whenever UI state changes ──
  setState(S){
    this.state = S;
    if(!this.ctx) return;
    const t=this.ctx.currentTime, n=this.nodes;
    // base filter (per-voice live filters updated in mod tick; set base here)
    this.baseCut1 = S.filt1.cut;
    // EQ
    n.eqLow.gain.setTargetAtTime(S.fx.eqLow*15, t, 0.05);
    n.eqMid.gain.setTargetAtTime(S.fx.eqMid*15, t, 0.05);
    n.eqHi.gain.setTargetAtTime(S.fx.eqHigh*15, t, 0.05);
    // dist / bit
    n.dist.curve = makeDistCurve(S.fx.distDrive*S.fx.distMix);
    n.bit.curve  = S.fx.bcMix>0.01 ? makeBitCurve(S.fx.bcBits) : makeDistCurve(0);
    // chorus
    n.chorWet.gain.setTargetAtTime(S.fx.chorMix, t, 0.05);
    this.chorDelays.forEach((cd,i)=>{ cd.lfoGain.gain.setTargetAtTime(S.fx.chorDepth,t,0.05);
      this.chorLFOs[i].frequency.setTargetAtTime(S.fx.chorRate*(1+i*0.3),t,0.05); });
    // delay
    n.dly.delayTime.setTargetAtTime(S.fx.dlyT,t,0.05);
    n.dlyFb.gain.setTargetAtTime(S.fx.dlyF,t,0.05);
    n.dlyWet.gain.setTargetAtTime(S.fx.dlyM,t,0.05);
    // reverb base mix (mod can add)
    n.rvbWet.gain.setTargetAtTime(S.fx.rvbMix,t,0.08);
    // master base
    n.master.gain.setTargetAtTime(S.vol,t,0.03);
    // precompute which destinations have active modulation
    const d=new Set();
    S.mods.forEach(m=>d.add(m.dest));
    if(S.xy){ d.add(S.xy.xDest); d.add(S.xy.yDest); }
    this.activeDests=d;
    // refresh live filters on existing voices (type/cutoff/res/keytrack changes)
    this.voices.forEach(v=>{
      v.baseCut = clamp(S.filt1.cut*Math.pow(2,(v.midi-60)*S.filt1.keytrack/12),20,20000);
      applyFiltType(v.filter, S.filt1.type, v.baseCut, S.filt1.res);
      v.filter2 && applyFiltType(v.filter2, S.filt2.type, S.filt2.cut, S.filt2.res);
    });
  }

  // ── source value lookup, returns roughly -1..1 (or 0..1 for unipolar perf) ──
  _src(name){
    if(name.startsWith("LFO")){ const i=+name.slice(4)-1; const cfg=this.state.lfos[i];
      return cfg.on ? waveValue(cfg.wave, this.lfoPhase[i]) : 0; }
    if(name.startsWith("Macro")){ const m=this.state.macros[+name.slice(6)-1];
      return m.bipolar ? (m.val*2-1) : m.val; }
    if(name==="Velocity")   return this.lastVel;
    if(name==="Keytrack")   return clamp((this.lastMidi-60)/36, -1, 1);
    if(name==="Mod Wheel")  return this.cc[1]||0;
    if(name==="Aftertouch") return this.cc.at||0;
    if(name==="Random")     return this.lastRandom*2-1;
    if(name==="Env 1")      return this.lastEnv;
    return 0;
  }

  // ── modulation engine: runs ~90Hz, sums routings, drives params ──
  _modTick(){
    const ctx=this.ctx, S=this.state; if(!ctx||!S) return;
    try{
      const t=ctx.currentTime, dt=0.011;
      // advance LFO phases
      for(let i=0;i<3;i++){ const cfg=S.lfos[i];
        this.lfoPhase[i]=(this.lfoPhase[i]+cfg.rate*dt)%1; }
      // approximate global envelope follower (avg of active voice env)
      let envSum=0,envN=0;
      this.voices.forEach(v=>{ envSum+=v.vca.gain.value; envN++; });
      this.lastEnv = envN? envSum/envN : 0;

      if(this.activeDests.size===0){ this.modAccum={}; return; }  // nothing routed → skip cheap

      // accumulate routings
      const acc={};
      const add=(d,v)=>{ acc[d]=(acc[d]||0)+v; };
      for(const m of S.mods){
        let v=this._src(m.src);
        if(m.invert) v=-v;
        if(!m.bipolar) v=(v+1)/2;
        v=applyCurve(v,m.curve);
        let amt=m.amt;
        if(m.depthSrc && m.depthSrc!=="none") amt*=(this._src(m.depthSrc)+1)/2;
        add(m.dest, v*amt);
      }
      if(S.xy){ add(S.xy.xDest,(S.xy.x*2-1)*0.6); add(S.xy.yDest,(S.xy.y*2-1)*0.6); }
      this.modAccum = acc;   // expose for UI modulation rings

      // apply GLOBAL destinations
      const n=this.nodes;
      if("Master Vol" in acc) n.master.gain.setTargetAtTime(clamp(S.vol*(1+acc["Master Vol"]),0,1.2),t,0.02);
      if("Reverb Mix" in acc) n.rvbWet.gain.setTargetAtTime(clamp(S.fx.rvbMix+acc["Reverb Mix"],0,1),t,0.02);
      if("Delay Mix"  in acc) n.dlyWet.gain.setTargetAtTime(clamp(S.fx.dlyM+acc["Delay Mix"],0,1),t,0.02);
      if("Chorus Mix" in acc) n.chorWet.gain.setTargetAtTime(clamp(S.fx.chorMix+acc["Chorus Mix"],0,1),t,0.02);
      if("Dist Drive" in acc) n.dist.curve=makeDistCurve(clamp(S.fx.distDrive*S.fx.distMix+acc["Dist Drive"],0,1));

      // apply PER-VOICE destinations
      const cut1Mod=acc["Filt1 Cutoff"]||0, res1Mod=acc["Filt1 Res"]||0;
      const cut2Mod=acc["Filt2 Cutoff"]||0;
      const pitchMod=[acc["Osc1 Pitch"]||0,acc["Osc2 Pitch"]||0,acc["Osc3 Pitch"]||0];
      const volMod=[acc["Osc1 Vol"]||0,acc["Osc2 Vol"]||0,acc["Osc3 Vol"]||0];
      const panSpread=acc["Pan Spread"]||0;
      this.voices.forEach(v=>{
        // filter cutoff modulated in octaves (cut1Mod ~ -1..1 → ±4 oct)
        const cut=clamp(v.baseCut*Math.pow(2,cut1Mod*4),20,20000);
        v.filter.frequency.setTargetAtTime(cut,t,0.012);
        if(res1Mod) v.filter.Q.setTargetAtTime(clamp(S.filt1.res+res1Mod*10,0.1,24),t,0.02);
        if(v.filter2 && cut2Mod) v.filter2.frequency.setTargetAtTime(clamp(S.filt2.cut*Math.pow(2,cut2Mod*4),20,20000),t,0.012);
        // per-osc pitch & vol
        v.units.forEach(u=>{
          if(pitchMod[u.idx]) u.osc.detune.setTargetAtTime(u.baseDetune+pitchMod[u.idx]*1200,t,0.01);
          if(volMod[u.idx])   u.gain.gain.setTargetAtTime(clamp(u.baseGain*(1+volMod[u.idx]),0,1.5),t,0.02);
          if(panSpread && u.pan) u.pan.pan.setTargetAtTime(clamp(u.basePan+panSpread*u.spreadSign,-1,1),t,0.02);
        });
      });
    }catch(e){ /* never let a mod glitch kill audio */ }
  }

  // ── voice allocation with stealing modes ──
  _steal(){
    const S=this.state, max=S.global.voiceCount;
    if(this.voices.size<max) return;
    const keys=[...this.voices.keys()];
    let victim=keys[0];
    const mode=S.global.voiceSteal||"oldest";
    if(mode==="lowest")  victim=Math.min(...keys);
    else if(mode==="highest") victim=Math.max(...keys);
    else if(mode==="roundrobin"){ victim=keys[this.rrIndex%keys.length]; this.rrIndex++; }
    this._killVoice(victim, true);
  }

  _killVoice(midi, fast){
    const v=this.voices.get(midi); if(!v) return;
    const ctx=this.ctx, now=ctx.currentTime, rel=fast?0.02:this.state.env.r;
    try{
      v.vca.gain.cancelScheduledValues(now);
      v.vca.gain.setValueAtTime(v.vca.gain.value,now);
      v.vca.gain.linearRampToValueAtTime(0,now+rel);
    }catch(e){}
    setTimeout(()=>{ v.units.forEach(u=>{try{u.osc.stop();}catch(e){}}); try{v.vca.disconnect();}catch(e){} },(rel+0.1)*1000);
    this.voices.delete(midi);
  }

  noteOn(midi, vel=0.8){
    this.init(); this.resume();
    const S=this.state, ctx=this.ctx; if(!ctx) return;
    this.lastVel=vel; this.lastMidi=midi; this.lastRandom=Math.random();
    if(this.voices.has(midi)) this._killVoice(midi,true);
    if(S.global.polyMode==="poly") this._steal();
    else { [...this.voices.keys()].forEach(m=>this._killVoice(m,true)); }

    const now=ctx.currentTime;
    const freq=midiToFreq(midi+S.global.tune);
    const baseCut=clamp(S.filt1.cut*Math.pow(2,(midi-60)*S.filt1.keytrack/12),20,20000);

    // per-voice filter(s)
    const filter=ctx.createBiquadFilter(); applyFiltType(filter,S.filt1.type,baseCut,S.filt1.res);
    let filter2=null;
    if(S.filt2.on){ filter2=ctx.createBiquadFilter(); applyFiltType(filter2,S.filt2.type,S.filt2.cut,S.filt2.res); }
    // VCA (envelope)
    const vca=ctx.createGain(); vca.gain.setValueAtTime(0,now);
    const {a,d,s,r}=S.env;
    const peak=clamp(0.3+vel*0.7,0,1);
    vca.gain.linearRampToValueAtTime(peak,now+Math.max(0.001,a));
    vca.gain.linearRampToValueAtTime(peak*s,now+a+d);

    // routing: units → filter → (filter2) → vca → drive
    const units=[];
    S.oscs.forEach((osc,oi)=>{
      if(!osc.on) return;
      const uniV=Math.max(1,Math.round(osc.uniV));
      for(let u=0;u<uniV;u++){
        const spread = uniV>1 ? (u-(uniV-1)/2)/((uniV-1)/2) : 0;
        const o=ctx.createOscillator(); o.type=osc.wave;
        o.frequency.value=freq*Math.pow(2,osc.oct)*Math.pow(2,osc.semi/12);
        const baseDetune=spread*osc.uniD+osc.fine;
        o.detune.value=baseDetune;
        const g=ctx.createGain(); const baseGain=osc.vol/uniV; g.gain.value=baseGain;
        const pan=ctx.createStereoPanner(); const basePan=clamp(osc.pan+spread*osc.uniS*0.6,-1,1); pan.pan.value=basePan;
        o.connect(g); g.connect(pan); pan.connect(filter);
        o.start(now);
        units.push({ osc:o, gain:g, pan, idx:oi, baseDetune, baseGain, basePan, spreadSign:spread>=0?1:-1 });
      }
    });
    if(filter2){ filter.connect(filter2); filter2.connect(vca); }
    else filter.connect(vca);
    vca.connect(this.nodes.drive);

    this.voices.set(midi,{ units, filter, filter2, vca, baseCut, midi });
    this.onActiveChange && this.onActiveChange(new Set(this.voices.keys()));
  }

  noteOff(midi){
    this._killVoice(midi,false);
    this.onActiveChange && this.onActiveChange(new Set(this.voices.keys()));
  }

  setCC(num,val){ this.cc[num]=val; }
  getScope(buf){ if(this.nodes&&this.nodes.analyser) this.nodes.analyser.getByteTimeDomainData(buf); }
  getSpectrum(buf){ if(this.nodes&&this.nodes.analyser) this.nodes.analyser.getByteFrequencyData(buf); }
  getMod(dest){ return (this.modAccum && this.modAccum[dest]) || 0; }
  getLfoPhase(i){ return this.lfoPhase[i]||0; }
  getActiveCount(){ return this.voices.size; }
  dispose(){ if(this.modTimer) clearInterval(this.modTimer); if(this.ctx) this.ctx.close(); }
}

/* ════════════════════════════════════════════════════════════════════════
   VISUAL COMPONENTS — reactive, dusk-toned
   ════════════════════════════════════════════════════════════════════════ */

// Center-column filter graph: live spectrum (coral haze) + response curve (amber)
function FilterGraph({ engine, filt1, h=132 }){
  const ref=useRef(null); const st=useRef(filt1); st.current=filt1;
  useEffect(()=>{
    let raf; const spec=new Uint8Array(512);
    const mag=(type,w,Q)=>{ const d=Math.sqrt(Math.pow(1-w*w,2)+Math.pow(w/Q,2))||1e-6;
      switch(type){ case "hp":return (w*w)/d; case "bp": case "comb": case "formant":return (w/Q)/d;
        case "notch":return Math.abs(1-w*w)/d; default:return 1/d; } };
    const draw=()=>{ const c=ref.current;
      if(c){ const w=c.clientWidth||520; c.width=w; const ctx=c.getContext("2d"); ctx.clearRect(0,0,w,h);
        // log-freq gridlines
        ctx.strokeStyle="rgba(242,234,217,0.05)"; ctx.lineWidth=1;
        [100,1000,10000].forEach(f=>{ const x=(Math.log(f/20)/Math.log(1000))*w;
          ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); });
        // live spectrum — soft coral haze
        if(engine.current){ engine.current.getSpectrum(spec);
          const bars=110, step=Math.floor(spec.length/bars);
          for(let i=0;i<bars;i++){ let v=0; for(let j=0;j<step;j++) v=Math.max(v,spec[i*step+j]);
            const bh=(v/255)*h*0.9, x=(i/bars)*w;
            const g=ctx.createLinearGradient(0,h,0,h-bh);
            g.addColorStop(0,"rgba(255,143,107,0.06)"); g.addColorStop(1,"rgba(255,195,138,0.42)");
            ctx.fillStyle=g; ctx.fillRect(x,h-bh,w/bars-1,bh); } }
        // filter response — amber brushstroke
        const S=st.current, fc=S.cut, Q=Math.max(0.4,S.res);
        ctx.beginPath();
        for(let px=0;px<=w;px+=2){ const f=20*Math.pow(1000,px/w);
          const db=20*Math.log10(Math.max(mag(S.type,f/fc,Q),1e-4));
          const y=h*0.48-(db/48)*h*0.5; px===0?ctx.moveTo(px,clamp(y,0,h)):ctx.lineTo(px,clamp(y,0,h)); }
        const lg=ctx.createLinearGradient(0,0,w,0); lg.addColorStop(0,T.filt[0]); lg.addColorStop(1,T.filt[1]);
        ctx.strokeStyle=lg; ctx.lineWidth=2.6; ctx.shadowBlur=14; ctx.shadowColor=T.filt[0]; ctx.stroke(); ctx.shadowBlur=0;
        // cutoff lantern
        const cx=(Math.log(fc/20)/Math.log(1000))*w;
        ctx.strokeStyle="rgba(255,176,84,0.28)"; ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,h); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx,h*0.48,5.5,0,7); ctx.fillStyle=T.filt[1];
        ctx.shadowBlur=16; ctx.shadowColor=T.glow; ctx.fill(); ctx.shadowBlur=0;
      } raf=requestAnimationFrame(draw); };
    draw(); return ()=>cancelAnimationFrame(raf);
  },[engine,h]);
  return <canvas ref={ref} height={h} style={{ width:"100%", height:h, display:"block", borderRadius:10,
    background:"linear-gradient(180deg, rgba(13,14,30,0.5), rgba(13,14,30,0.85))" }}/>;
}

function OscWave({ wave, accent, engine, live, h=32 }){
  const ref=useRef(null); const wr=useRef(wave); wr.current=wave;
  useEffect(()=>{ let raf, phase=0;
    const draw=()=>{ const c=ref.current; if(c){ const w=c.clientWidth||230; c.width=w;
      const ctx=c.getContext("2d"); ctx.clearRect(0,0,w,h); phase=(phase+0.005)%1;
      let amp=0; if(engine&&engine.current&&live) amp=Math.min(1,engine.current.getActiveCount()*0.5);
      ctx.beginPath(); const N=w;
      for(let i=0;i<=N;i++){ const ph=((i/N)*2+phase)%1; const y=waveValue(wr.current,ph);
        const x=(i/N)*w, py=h/2-y*(h/2-5)*(0.82+amp*0.18); i===0?ctx.moveTo(x,py):ctx.lineTo(x,py); }
      const lg=ctx.createLinearGradient(0,0,w,0); lg.addColorStop(0,accent[0]); lg.addColorStop(1,accent[1]);
      ctx.strokeStyle=lg; ctx.lineWidth=2.2; ctx.shadowBlur=6+amp*12; ctx.shadowColor=accent[0]; ctx.stroke(); ctx.shadowBlur=0;
    } raf=requestAnimationFrame(draw); };
    draw(); return ()=>cancelAnimationFrame(raf);
  },[accent,engine,live,h]);
  return <canvas ref={ref} height={h} style={{ width:"100%", height:h, borderRadius:8, display:"block", background:T.inset }}/>;
}

function LFOScope({ wave, engine, idx, on, h=40 }){
  const ref=useRef(null); const wr=useRef(wave); wr.current=wave;
  useEffect(()=>{ let raf;
    const draw=()=>{ const c=ref.current; if(c){ const w=c.clientWidth||300; c.width=w;
      const ctx=c.getContext("2d"); ctx.clearRect(0,0,w,h);
      const col=on?T.lfo:[T.inkFaint,T.inkFaint];
      ctx.beginPath(); for(let i=0;i<=w;i++){ const ph=i/w; const y=waveValue(wr.current,ph);
        const py=h/2-y*(h/2-6); i===0?ctx.moveTo(i,py):ctx.lineTo(i,py); }
      const lg=ctx.createLinearGradient(0,0,w,0); lg.addColorStop(0,col[0]); lg.addColorStop(1,col[1]);
      ctx.strokeStyle=lg; ctx.lineWidth=2.2; ctx.shadowBlur=on?8:0; ctx.shadowColor=col[0]; ctx.stroke(); ctx.shadowBlur=0;
      if(on&&engine&&engine.current){ const p=engine.current.getLfoPhase(idx);
        const x=p*w, y=h/2-waveValue(wr.current,p)*(h/2-6);
        ctx.beginPath(); ctx.arc(x,y,4.5,0,7); ctx.fillStyle=col[1]; ctx.shadowBlur=12; ctx.shadowColor=col[1]; ctx.fill(); ctx.shadowBlur=0; }
    } raf=requestAnimationFrame(draw); };
    draw(); return ()=>cancelAnimationFrame(raf);
  },[engine,idx,on,h]);
  return <canvas ref={ref} height={h} style={{ width:"100%", height:h, borderRadius:8, display:"block", background:T.inset }}/>;
}

function ADSRView({ a,d,s,r, h=54 }){
  const ref=useRef(null);
  useEffect(()=>{ const c=ref.current; if(!c) return; const W=c.clientWidth||300; c.width=W;
    const ctx=c.getContext("2d"); ctx.clearRect(0,0,W,h);
    const pad=11, w=W-pad*2, hh=h-pad-7;
    const lg=v=>Math.log1p(v*8); const aT=lg(a),dT=lg(d),sT=0.8,rT=lg(r),tot=aT+dT+sT+rT||1;
    const xA=pad+(aT/tot)*w, xD=xA+(dT/tot)*w, xS=xD+(sT/tot)*w, xR=xS+(rT/tot)*w;
    const yB=pad+hh, yT=pad, yS=pad+hh*(1-s);
    const fill=ctx.createLinearGradient(0,yT,0,yB); fill.addColorStop(0,`${T.env[0]}44`); fill.addColorStop(1,`${T.env[0]}06`);
    ctx.beginPath(); ctx.moveTo(pad,yB); ctx.lineTo(xA,yT); ctx.lineTo(xD,yS); ctx.lineTo(xS,yS); ctx.lineTo(xR,yB); ctx.closePath();
    ctx.fillStyle=fill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pad,yB); ctx.lineTo(xA,yT); ctx.lineTo(xD,yS); ctx.lineTo(xS,yS); ctx.lineTo(xR,yB);
    const lg2=ctx.createLinearGradient(0,0,W,0); lg2.addColorStop(0,T.env[0]); lg2.addColorStop(1,T.env[1]);
    ctx.strokeStyle=lg2; ctx.lineWidth=2.4; ctx.shadowBlur=9; ctx.shadowColor=T.env[0]; ctx.lineJoin="round"; ctx.stroke(); ctx.shadowBlur=0;
    [[pad,yB],[xA,yT],[xD,yS],[xS,yS],[xR,yB]].forEach(([x,y])=>{ ctx.beginPath(); ctx.arc(x,y,3.2,0,7); ctx.fillStyle=T.env[1]; ctx.fill(); });
  },[a,d,s,r,h]);
  return <canvas ref={ref} height={h} style={{ width:"100%", height:h, borderRadius:8, display:"block", background:T.inset }}/>;
}

// output meter (RMS from time-domain scope)
function Meter({ engine }){
  const ref=useRef(null);
  useEffect(()=>{ let raf; const buf=new Uint8Array(1024); let smooth=0;
    const draw=()=>{ const c=ref.current; if(c){ const w=70,h=9; c.width=w; c.height=h;
      const ctx=c.getContext("2d"); ctx.clearRect(0,0,w,h);
      ctx.fillStyle=T.inset; ctx.fillRect(0,0,w,h);
      if(engine.current){ engine.current.getScope(buf);
        let sum=0; for(let i=0;i<buf.length;i++){ const v=(buf[i]-128)/128; sum+=v*v; }
        const rms=Math.sqrt(sum/buf.length); smooth=Math.max(rms,smooth*0.92);
        const len=Math.min(1,smooth*2.4)*w;
        const g=ctx.createLinearGradient(0,0,w,0);
        g.addColorStop(0,T.lfo[0]); g.addColorStop(0.7,T.filt[0]); g.addColorStop(1,"#ff6b5f");
        ctx.fillStyle=g; ctx.fillRect(0,0,len,h); }
    } raf=requestAnimationFrame(draw); };
    draw(); return ()=>cancelAnimationFrame(raf);
  },[engine]);
  return <canvas ref={ref} style={{ width:70, height:9, borderRadius:5, border:`1px solid ${T.lineSoft}` }}/>;
}

/* ════════════════════════════════════════════════════════════════════════
   CONTROLS — design system primitives
   ════════════════════════════════════════════════════════════════════════ */
function Knob({ value, min, max, label, onChange, accent=T.osc, display, log=false, size=50, engine, modDest }){
  const drag=useRef({a:false,y:0,v:0}); const ringRef=useRef(null);
  const norm=v=> log ? (Math.log(Math.max(v,min))-Math.log(min))/(Math.log(max)-Math.log(min)) : (v-min)/(max-min);
  const pct=clamp(norm(value),0,1); const ang=-135+pct*270;
  const cx=size/2, cy=size/2, capR=size/2-9, arcR=size/2-4;
  const rad=a=>a*Math.PI/180;
  const ptr={x:cx+(capR-2)*Math.sin(rad(ang)), y:cy-(capR-2)*Math.cos(rad(ang))};
  const arcXY=a=>({x:cx+arcR*Math.sin(rad(a)), y:cy-arcR*Math.cos(rad(a))});
  const sP=arcXY(-135), eP=arcXY(ang), fP=arcXY(135);
  const down=e=>{ e.preventDefault(); drag.current={a:true,y:e.clientY,v:value};
    const mv=me=>{ if(!drag.current.a)return; const dy=(drag.current.y-me.clientY)/180;
      if(log){const lo=Math.log(min),hi=Math.log(max);onChange(clamp(Math.exp(Math.log(drag.current.v)+dy*(hi-lo)),min,max));}
      else onChange(clamp(drag.current.v+dy*(max-min),min,max)); };
    const up=()=>{drag.current.a=false;window.removeEventListener("mousemove",mv);window.removeEventListener("mouseup",up);};
    window.addEventListener("mousemove",mv); window.addEventListener("mouseup",up); };
  const dbl=()=>onChange(log?Math.sqrt(min*max):(min+max)/2);
  const shown = display ?? (log?(value>=1000?(value/1000).toFixed(1)+"k":value.toFixed(0)):value.toFixed(2));
  useEffect(()=>{ if(!modDest||!engine) return; let raf;
    const draw=()=>{ const c=ringRef.current; if(c){ c.width=size; c.height=size; const ctx=c.getContext("2d"); ctx.clearRect(0,0,size,size);
      const m=engine.current?engine.current.getMod(modDest):0;
      if(Math.abs(m)>0.001){ const base=-135+pct*270; const modAng=clamp(base+clamp(m,-1,1)*135,-135,135);
        ctx.beginPath(); const a0=Math.min(base,modAng), a1=Math.max(base,modAng);
        ctx.arc(cx,cy,arcR,rad(a0)-Math.PI/2,rad(a1)-Math.PI/2);
        ctx.strokeStyle=accent[1]; ctx.lineWidth=3; ctx.shadowBlur=9; ctx.shadowColor=accent[1]; ctx.globalAlpha=0.95; ctx.stroke();
        ctx.globalAlpha=1; ctx.shadowBlur=0;
        const mp=arcXY(modAng); ctx.beginPath(); ctx.arc(mp.x,mp.y,3,0,7); ctx.fillStyle=accent[1]; ctx.fill(); }
    } raf=requestAnimationFrame(draw); };
    draw(); return ()=>cancelAnimationFrame(raf);
  },[modDest,engine,pct,size,accent]);
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1.5, userSelect:"none" }}>
      <div style={{ position:"relative", width:size, height:size }}>
        <svg width={size} height={size} onMouseDown={down} onDoubleClick={dbl} style={{ cursor:"ns-resize", position:"absolute", inset:0 }}>
          <defs>
            <linearGradient id={`ka${label}${size}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={accent[0]}/><stop offset="100%" stopColor={accent[1]}/></linearGradient>
            <radialGradient id={`kc${label}${size}`} cx="38%" cy="30%"><stop offset="0%" stopColor="#3a3c68"/><stop offset="70%" stopColor="#1e2040"/><stop offset="100%" stopColor="#12132a"/></radialGradient>
          </defs>
          <path d={`M${sP.x},${sP.y} A${arcR},${arcR} 0 1 1 ${fP.x},${fP.y}`} fill="none" stroke="#262848" strokeWidth={3.2} strokeLinecap="round"/>
          {pct>0.004 && <path d={`M${sP.x},${sP.y} A${arcR},${arcR} 0 ${pct>0.5?1:0} 1 ${eP.x},${eP.y}`} fill="none" stroke={`url(#ka${label}${size})`} strokeWidth={3.2} strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${accent[0]}88)`}}/>}
          <circle cx={cx} cy={cy} r={capR} fill={`url(#kc${label}${size})`} stroke="#0a0b18" strokeWidth={1}/>
          <line x1={cx} y1={cy} x2={ptr.x} y2={ptr.y} stroke={accent[1]} strokeWidth={2.4} strokeLinecap="round"/>
          <circle cx={cx} cy={cy} r={1.8} fill="#0a0b18"/>
        </svg>
        {modDest && <canvas ref={ringRef} style={{ position:"absolute", inset:0, pointerEvents:"none" }}/>}
      </div>
      <span style={{ fontFamily:T.font, fontSize:9, fontWeight:500, letterSpacing:"0.04em", color:T.inkDim }}>{label}</span>
      <span style={{ fontFamily:T.mono, fontSize:9.5, color:T.ink }}>{shown}</span>
    </div>
  );
}
function KnobRow({ children, gap=4 }){ return <div style={{ display:"flex", justifyContent:"space-around", alignItems:"flex-start", gap }}>{children}</div>; }

function Toggle({ value, onChange, accent=T.osc }){
  return (
    <div onClick={()=>onChange(!value)} style={{ width:32, height:16, borderRadius:8, cursor:"pointer", position:"relative", flexShrink:0,
      background:value?grad(accent):T.inset, border:`1px solid ${value?"transparent":T.line}`,
      boxShadow:value?`0 0 10px ${accent[0]}55`:"none", transition:"all .18s" }}>
      <div style={{ width:10, height:10, borderRadius:"50%", position:"absolute", top:3, left:value?19:3,
        background:T.ink, boxShadow:"0 1px 3px #00000090", transition:"all .18s" }}/>
    </div>
  );
}

const WAVE_PATHS={ sine:"M2,12 C6,3 10,3 14,12 C18,21 22,21 26,12", triangle:"M2,12 L10,3 L18,21 L26,12",
  sawtooth:"M2,3 L20,21 M20,3 L26,3", square:"M2,12 L2,4 L13,4 L13,20 L24,20 L24,12" };
function WaveBtn({ type, selected, onClick, accent }){
  return (
    <button onClick={onClick} title={type} style={{ flex:1, background:selected?grad(accent):T.inset,
      border:`1px solid ${selected?"transparent":T.lineSoft}`, borderRadius:6, padding:"3px 0", cursor:"pointer",
      display:"flex", alignItems:"center", justifyContent:"center", boxShadow:selected?`0 2px 8px ${accent[0]}44`:"none", transition:"all .13s" }}>
      <svg width={20} height={12} viewBox="2 0 26 24" fill="none">
        <path d={WAVE_PATHS[type]} stroke={selected?"#1a1408":T.inkFaint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function Pill({ label, selected, onClick, accent=T.osc, small }){
  return (
    <button onClick={onClick} style={{ padding:small?"2px 7px":"3px 9px", fontFamily:T.font, fontSize:small?10:11, fontWeight:600,
      background:selected?grad(accent):T.inset, border:`1px solid ${selected?"transparent":T.lineSoft}`,
      color:selected?"#221607":T.inkDim, borderRadius:7, cursor:"pointer",
      boxShadow:selected?`0 2px 8px ${accent[0]}44`:"none", transition:"all .13s", textTransform:"capitalize" }}>{label}</button>
  );
}

// Section panel — indigo glass with a coral hairline eyebrow
function Panel({ title, accent, children, style={}, right, tight }){
  return (
    <div style={{ background:T.panel, backdropFilter:"blur(10px)", border:`1px solid ${T.lineSoft}`,
      borderRadius:9, padding:tight?"7px 9px":"8px 10px", boxShadow:"0 6px 24px #00000045",
      display:"flex", flexDirection:"column", gap:6, ...style }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ width:3, height:11, borderRadius:2, background:grad(accent), boxShadow:`0 0 6px ${accent[0]}` }}/>
          <span style={{ fontFamily:T.font, fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", color:T.ink, textTransform:"uppercase" }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Piano({ active, onOn, onOff }){
  const keys=[]; for(let oct=3;oct<=5;oct++) NOTE_NAMES.forEach((n,i)=>keys.push({n,oct,midi:(oct+1)*12+i,black:n.includes("#")}));
  keys.push({n:"C",oct:6,midi:84,black:false});
  const whites=keys.filter(k=>!k.black), KW=25, KH=58;
  return (
    <div style={{ position:"relative", height:KH, width:whites.length*KW, margin:"0 auto" }}>
      {whites.map((k,i)=>{ const lit=active.has(k.midi); return (
        <div key={k.midi} onMouseDown={()=>onOn(k.midi)} onMouseUp={()=>onOff(k.midi)} onMouseLeave={()=>active.has(k.midi)&&onOff(k.midi)}
          style={{ position:"absolute", left:i*KW, top:0, width:KW-2, height:KH,
            background:lit?grad(T.osc):"linear-gradient(180deg,#efe9dc,#d7cfc0)", border:"1px solid #0a0b18",
            borderRadius:"0 0 5px 5px", cursor:"pointer", boxShadow:lit?`0 0 16px ${T.osc[0]}77`:"inset 0 -3px 5px #00000018", transition:"all .04s" }}>
          <span style={{ position:"absolute", bottom:4, left:0, right:0, textAlign:"center", fontFamily:T.mono, fontSize:8.5, color:lit?"#221607":"#948b7a" }}>{k.n}{k.oct}</span>
        </div> ); })}
      {(()=>{ let wi=0; return keys.map(k=>{ if(!k.black){wi++;return null;} const lit=active.has(k.midi); const left=(wi-1)*KW+KW*0.66; return (
        <div key={k.midi} onMouseDown={e=>{e.stopPropagation();onOn(k.midi);}} onMouseUp={e=>{e.stopPropagation();onOff(k.midi);}} onMouseLeave={()=>active.has(k.midi)&&onOff(k.midi)}
          style={{ position:"absolute", left, top:0, zIndex:2, width:KW*0.58, height:36,
            background:lit?grad(T.osc):"linear-gradient(180deg,#2c2646,#141428)", border:"1px solid #000",
            borderRadius:"0 0 4px 4px", cursor:"pointer", boxShadow:lit?`0 0 12px ${T.osc[0]}`:"1px 3px 6px #000000aa", transition:"all .04s" }}/> ); }); })()}
    </div>
  );
}

// Far-background dusk scenery: painted sky + Fuji + pagoda silhouettes
function DuskBackdrop(){
  return (
    <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", overflow:"hidden" }}>
      <div style={{ position:"absolute", inset:0,
        background:`linear-gradient(180deg, ${T.sky[3]} 0%, ${T.sky[2]} 26%, ${T.sky[1]} 55%, ${T.sky[0]} 82%, ${T.night} 100%)` }}/>
      {/* painterly cloud bands */}
      <div style={{ position:"absolute", top:"6%", left:"-10%", width:"70%", height:90, borderRadius:"50%",
        background:"radial-gradient(ellipse, rgba(255,176,138,0.14), transparent 70%)", filter:"blur(6px)" }}/>
      <div style={{ position:"absolute", top:"14%", right:"-6%", width:"55%", height:70, borderRadius:"50%",
        background:"radial-gradient(ellipse, rgba(255,157,176,0.10), transparent 70%)", filter:"blur(8px)" }}/>
      <svg viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice"
        style={{ position:"absolute", bottom:0, left:0, width:"100%", height:"38vh", opacity:0.16 }}>
        {/* distant ridge behind Fuji */}
        <path d="M0,320 L120,232 L250,286 L360,238 L470,320 Z" fill="#0c0d20" opacity="0.55"/>
        {/* Fuji */}
        <path d="M150,320 L400,90 L440,120 L470,95 L505,125 L540,100 L790,320 Z" fill="#0c0d20"/>
        <path d="M388,101 L400,90 L440,120 L470,95 L505,125 L540,100 L552,111 L505,140 L470,112 L440,138 Z" fill="#f2ead9" opacity="0.5"/>
        {/* torii gate, far left */}
        <g fill="#0c0d20">
          <path d="M56,320 L70,182 L82,182 L96,320 Z"/>
          <path d="M186,320 L200,182 L212,182 L226,320 Z"/>
          <path d="M34,166 L248,166 L242,150 L40,150 Z"/>
          <rect x="46" y="170" width="190" height="9" rx="2"/>
          <rect x="60" y="208" width="162" height="9"/>
          <rect x="133" y="179" width="15" height="29"/>
        </g>
        {/* stone lantern near Fuji's base */}
        <g fill="#0c0d20">
          <rect x="806" y="306" width="44" height="10" rx="2"/>
          <rect x="822" y="272" width="12" height="36"/>
          <rect x="810" y="258" width="36" height="16" rx="2"/>
          <path d="M800,258 L856,258 L842,238 L814,238 Z"/>
          <circle cx="828" cy="232" r="5"/>
        </g>
        {/* cloud-pine, bottom right */}
        <g fill="#0c0d20">
          <path d="M1080,320 L1092,252 L1100,252 L1112,320 Z"/>
          <path d="M1096,252 L1150,224" stroke="#0c0d20" strokeWidth="7" fill="none"/>
          <ellipse cx="1064" cy="238" rx="42" ry="15"/>
          <ellipse cx="1128" cy="212" rx="48" ry="16"/>
          <ellipse cx="1096" cy="186" rx="34" ry="12"/>
        </g>
        {/* pagoda */}
        <g fill="#0c0d20">
          <rect x="962" y="118" width="6" height="36"/>
          <path d="M905,168 L1025,168 L1000,142 L930,142 Z"/><rect x="946" y="154" width="38" height="16"/>
          <path d="M893,214 L1037,214 L1008,186 L922,186 Z"/><rect x="940" y="198" width="50" height="18"/>
          <path d="M880,266 L1050,266 L1016,234 L914,234 Z"/><rect x="934" y="248" width="62" height="20"/>
          <rect x="908" y="266" width="114" height="54"/>
        </g>
      </svg>
      {/* flock of birds drifting across the dusk */}
      <svg viewBox="0 0 220 80" style={{ position:"absolute", top:"8%", right:"16%", width:200, height:72, opacity:0.32 }}>
        <g stroke="#1a1425" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M18,38 Q27,28 36,38 M36,38 Q45,28 54,38"/>
          <path d="M84,20 Q91,12 98,20 M98,20 Q105,12 112,20"/>
          <path d="M130,48 Q138,39 146,48 M146,48 Q154,39 162,48"/>
          <path d="M172,28 Q178,21 184,28 M184,28 Q190,21 196,28"/>
          <path d="M58,62 Q64,55 70,62 M70,62 Q76,55 82,62"/>
        </g>
      </svg>
    </div>
  );
}
const mkOsc=(on,wave,oct,semi,fine,vol,pan,uniV=1,uniD=0,uniS=0.5)=>({on,wave,oct,semi,fine,vol,pan,uniV,uniD,uniS});
const mkLfo=(on,wave,rate,depth)=>({on,wave,rate,depth});
const mkFx=(o)=>({ rvbMix:0,dlyT:0.25,dlyF:0,dlyM:0,chorRate:1.5,chorDepth:0.003,chorMix:0,distDrive:0,distMix:0,bcBits:16,bcMix:0,eqLow:0,eqMid:0,eqHigh:0, ...o });
const DEF={
  global:{ polyMode:"poly", voiceCount:8, tune:0, pbRange:2, voiceSteal:"oldest" },
  oscs:[ mkOsc(true,"sawtooth",0,0,0,0.8,0), mkOsc(false,"square",-1,0,12,0.5,-0.3,1,15,0.6), mkOsc(false,"sine",1,7,0,0.3,0.3) ],
  filt1:{ type:"lp12", cut:3000, res:1, drive:0, keytrack:0 },
  filt2:{ on:false, type:"lp12", cut:8000, res:0.5 },
  env:{ a:0.01, d:0.15, s:0.7, r:0.4 },
  lfos:[ mkLfo(false,"sine",3,1), mkLfo(false,"triangle",0.5,1), mkLfo(false,"sawtooth",6,1) ],
  fx: mkFx({}), mods:[],
  macros:[ {val:0.5,bipolar:false,name:"Macro 1"},{val:0.5,bipolar:false,name:"Macro 2"},{val:0,bipolar:true,name:"Macro 3"},{val:0,bipolar:true,name:"Macro 4"} ],
  xy:{ x:0.5, y:0.5, xDest:"Filt1 Cutoff", yDest:"Reverb Mix" },
  arp:{ on:false, mode:"up", rate:0.25, octaves:1, hold:false, steps:[0,0,0,0,0,0,0,0], stepOn:[true,true,true,true,false,false,false,false] },
  vol:0.72,
};
const PRESET_STATES={
  1:{ oscs:[mkOsc(true,"sawtooth",0,0,0,0.8,0),mkOsc(false,"square",-1,0,12,0.5,-0.3),mkOsc(false,"sine",1,7,0,0.3,0.3)], filt1:{type:"lp12",cut:18000,res:0.5,drive:0,keytrack:0},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.005,d:0.1,s:1,r:0.3},lfos:[mkLfo(false,"sine",3,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({}),mods:[],vol:0.75 },
  2:{ oscs:[mkOsc(true,"sawtooth",0,0,0,0.9,0,7,28,0.9),mkOsc(true,"sawtooth",0,0,7,0.4,0.2,3,18,0.7),mkOsc(false,"sine",0,0,0,0.3,0)], filt1:{type:"lp12",cut:6000,res:1.8,drive:0.15,keytrack:0.4},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.008,d:0.3,s:0.85,r:0.5},lfos:[mkLfo(true,"sine",0.3,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.15,dlyT:0.375,dlyF:0.35,dlyM:0.28,chorMix:0.18,eqMid:0.15,eqHigh:0.2}), mods:[{id:1,src:"LFO 1",dest:"Filt1 Cutoff",amt:0.4,curve:"linear",invert:false,bipolar:true,perVoice:true,depthSrc:"none"}],vol:0.72 },
  3:{ oscs:[mkOsc(true,"sine",0,0,0,0.7,0,4,12,0.8),mkOsc(true,"square",-1,7,5,0.4,0,3,18,0.7),mkOsc(true,"triangle",1,0,0,0.25,0,2,8,0.5)], filt1:{type:"lp12",cut:2200,res:0.6,drive:0,keytrack:0.2},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:1.8,d:0.8,s:0.75,r:2.5},lfos:[mkLfo(true,"sine",0.12,1),mkLfo(true,"triangle",0.08,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.65,dlyT:0.5,dlyF:0.45,dlyM:0.35,chorMix:0.25,eqLow:0.1,eqHigh:0.1}), mods:[{id:1,src:"LFO 1",dest:"Filt1 Cutoff",amt:0.3,curve:"s-curve",invert:false,bipolar:true,perVoice:true,depthSrc:"none"}],vol:0.68 },
  4:{ oscs:[mkOsc(true,"sawtooth",-1,0,0,0.9,0,2,8,0.3),mkOsc(true,"square",-2,0,0,0.7,0),mkOsc(true,"sine",-2,0,0,0.8,0)], filt1:{type:"ladder",cut:380,res:5.5,drive:0.55,keytrack:0.1},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.003,d:0.25,s:0.3,r:0.18},lfos:[mkLfo(false,"sine",3,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.08,distDrive:0.55,distMix:0.7,eqLow:0.3,eqMid:-0.1}),mods:[],vol:0.78 },
  5:{ oscs:[mkOsc(true,"sawtooth",0,0,0,0.8,0,2,14,0.6),mkOsc(true,"square",0,7,0,0.3,0.3),mkOsc(false,"sine",0,0,0,0.3,0)], filt1:{type:"lp24",cut:4500,res:7,drive:0.1,keytrack:0.6},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.002,d:0.18,s:0,r:0.2},lfos:[mkLfo(false,"sine",3,1),mkLfo(false,"triangle",0.5,1),mkLfo(true,"sine",5.5,1)], fx:mkFx({rvbMix:0.2,dlyT:0.25,dlyF:0.3,dlyM:0.22,chorMix:0.15,eqMid:0.1,eqHigh:0.1}),mods:[],vol:0.73 },
  6:{ oscs:[mkOsc(true,"sine",1,0,0,0.85,0),mkOsc(true,"triangle",2,7,0,0.5,0.2),mkOsc(true,"sine",1,12,0,0.3,-0.2)], filt1:{type:"comb",cut:1800,res:8,drive:0,keytrack:0.8},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.01,d:0.6,s:0.15,r:3.5},lfos:[mkLfo(true,"sine",0.05,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.7,dlyT:0.45,dlyF:0.3,dlyM:0.2,chorMix:0.1,eqHigh:0.2}),mods:[],vol:0.65 },
  7:{ oscs:[mkOsc(true,"sawtooth",0,0,0,0.85,0),mkOsc(false,"square",-1,0,12,0.5,-0.3),mkOsc(false,"sine",1,7,0,0.3,0.3)], filt1:{type:"ladder",cut:600,res:14,drive:0.3,keytrack:0.7},filt2:{on:true,type:"hp",cut:80,res:0.5}, env:{a:0.003,d:0.12,s:0,r:0.08},lfos:[mkLfo(true,"sawtooth",4.5,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.1,dlyT:0.25,dlyF:0.4,dlyM:0.18,distDrive:0.4,distMix:0.6,eqLow:0.2}), mods:[{id:1,src:"LFO 1",dest:"Filt1 Cutoff",amt:0.55,curve:"linear",invert:false,bipolar:true,perVoice:true,depthSrc:"none"}],vol:0.76 },
  8:{ oscs:[mkOsc(true,"sawtooth",0,0,0,0.7,0,6,22,0.85),mkOsc(true,"sawtooth",0,-7,6,0.5,0.15,4,16,0.7),mkOsc(true,"sawtooth",0,7,-5,0.4,-0.15,4,16,0.7)], filt1:{type:"lp12",cut:3200,res:0.4,drive:0,keytrack:0.3},filt2:{on:true,type:"hp",cut:120,res:0.3}, env:{a:2.2,d:1,s:0.8,r:3},lfos:[mkLfo(true,"sine",0.18,1),mkLfo(false,"triangle",0.5,1),mkLfo(true,"sine",4.5,1)], fx:mkFx({rvbMix:0.5,dlyT:0.5,dlyF:0.4,dlyM:0.3,chorMix:0.35,eqLow:0.15,eqHigh:0.1}),mods:[],vol:0.7 },
  9:{ oscs:[mkOsc(true,"triangle",1,0,0,0.8,0,2,5,0.4),mkOsc(true,"sine",2,5,0,0.45,0.2),mkOsc(false,"square",0,0,0,0.3,0)], filt1:{type:"formant",cut:1500,res:8,drive:0,keytrack:0.9},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.015,d:0.4,s:0.6,r:0.9},lfos:[mkLfo(true,"sine",5.5,1),mkLfo(true,"triangle",0.2,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.55,dlyT:0.375,dlyF:0.25,dlyM:0.2,chorMix:0.2,eqLow:-0.1,eqHigh:0.3}), mods:[{id:1,src:"LFO 1",dest:"Osc1 Pitch",amt:0.01,curve:"linear",invert:false,bipolar:true,perVoice:true,depthSrc:"Mod Wheel"}],vol:0.68 },
  10:{ oscs:[mkOsc(true,"sine",-2,0,0,0.95,0),mkOsc(true,"square",-1,0,0,0.4,0,3,35,0.4),mkOsc(false,"sawtooth",0,0,0,0.3,0)], filt1:{type:"lp24",cut:220,res:2.5,drive:0.2,keytrack:0},filt2:{on:true,type:"bp",cut:150,res:4}, env:{a:0.02,d:0.5,s:0.7,r:0.4},lfos:[mkLfo(true,"sine",0.08,1),mkLfo(false,"triangle",0.5,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.12,dlyT:0.5,dlyF:0.5,dlyM:0.15,distDrive:0.25,distMix:0.35,eqLow:0.6,eqMid:-0.2}),mods:[],vol:0.8 },
  11:{ oscs:[mkOsc(true,"square",0,0,0,0.7,0,4,45,0.9),mkOsc(true,"sawtooth",1,0,33,0.5,0.4),mkOsc(true,"triangle",-1,0,-27,0.4,-0.4)], filt1:{type:"lp12",cut:8000,res:3,drive:0.6,keytrack:0},filt2:{on:true,type:"notch",cut:2000,res:8}, env:{a:0.001,d:0.08,s:0.4,r:0.05},lfos:[mkLfo(true,"square",14,1),mkLfo(true,"square",7,1),mkLfo(true,"sawtooth",18,1)], fx:mkFx({rvbMix:0.1,dlyT:0.125,dlyF:0.7,dlyM:0.3,chorMix:0.3,distDrive:0.8,distMix:0.9,bcBits:4,bcMix:0.75,eqMid:0.3}), mods:[{id:1,src:"LFO 1",dest:"Filt1 Cutoff",amt:0.6,curve:"linear",invert:false,bipolar:true,perVoice:false,depthSrc:"none"}],vol:0.65 },
  12:{ oscs:[mkOsc(true,"sine",1,0,0,0.75,0,3,8,0.6),mkOsc(true,"triangle",2,4,3,0.5,0.25,2,12,0.5),mkOsc(true,"sine",0,7,0,0.35,-0.2)], filt1:{type:"lp12",cut:4500,res:1.2,drive:0,keytrack:0.5},filt2:{on:false,type:"lp12",cut:8000,res:0.5}, env:{a:0.02,d:0.5,s:0.4,r:1.8},lfos:[mkLfo(true,"sine",0.15,1),mkLfo(true,"sine",0.07,1),mkLfo(false,"sawtooth",6,1)], fx:mkFx({rvbMix:0.75,dlyT:0.5,dlyF:0.55,dlyM:0.4,chorMix:0.3,eqLow:0.1,eqMid:0.1,eqHigh:0.15}), mods:[{id:1,src:"LFO 1",dest:"Filt1 Cutoff",amt:0.45,curve:"s-curve",invert:false,bipolar:true,perVoice:true,depthSrc:"none"}],vol:0.66 },
};
const PRESETS=[
  {id:1,name:"Init",emoji:"⚪"},{id:2,name:"Hypersaw",emoji:"⚡"},{id:3,name:"Glass Pad",emoji:"🌌"},
  {id:4,name:"Reese Bass",emoji:"🔊"},{id:5,name:"Pluck",emoji:"💧"},{id:6,name:"Bell Choir",emoji:"🔔"},
  {id:7,name:"303 Acid",emoji:"🧪"},{id:8,name:"Strings",emoji:"🎻"},{id:9,name:"Vox Lead",emoji:"🎤"},
  {id:10,name:"Deep Sub",emoji:"🌑"},{id:11,name:"Circuit Bent",emoji:"👾"},{id:12,name:"Aurora Arp",emoji:"🌈"},
];

/* ════════════════════════════════════════════════════════════════════════
   MAIN — Vital-style 3-column layout
   ════════════════════════════════════════════════════════════════════════ */
export default function NeutrinoSynth(){
  const [S,setS]=useState(DEF);
  const [active,setActive]=useState(new Set());
  const [hints,setHints]=useState(false);
  const [fxTab,setFxTab]=useState("space");
  const [lfoTab,setLfoTab]=useState(0);
  const [dragSrc,setDragSrc]=useState(null);
  const [newRoute,setNewRoute]=useState({ src:"LFO 1", dest:"Filt1 Cutoff", amt:0.5, curve:"linear", invert:false, bipolar:true, perVoice:true, depthSrc:"none" });
  const [activePreset,setActivePreset]=useState(1);

  const engine=useRef(null);
  const undoStack=useRef([]), redoStack=useRef([]);

  useEffect(()=>{ engine.current=new SynthEngine(); engine.current.onActiveChange=set=>setActive(set); engine.current.setState(DEF);
    return ()=>engine.current&&engine.current.dispose(); },[]);
  useEffect(()=>{ if(engine.current) engine.current.setState(S); },[S]);

  const commit=useCallback(up=>{ setS(prev=>{ undoStack.current.push(JSON.stringify(prev)); if(undoStack.current.length>64) undoStack.current.shift(); redoStack.current=[]; return typeof up==="function"?up(prev):up; }); },[]);
  const undo=useCallback(()=>{ if(!undoStack.current.length)return; setS(c=>{ redoStack.current.push(JSON.stringify(c)); return JSON.parse(undoStack.current.pop()); }); },[]);
  const redo=useCallback(()=>{ if(!redoStack.current.length)return; setS(c=>{ undoStack.current.push(JSON.stringify(c)); return JSON.parse(redoStack.current.pop()); }); },[]);

  const noteOn=useCallback((m,v=0.85)=>engine.current&&engine.current.noteOn(m,v),[]);
  const noteOff=useCallback(m=>engine.current&&engine.current.noteOff(m),[]);

  useEffect(()=>{
    const map={a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72,o:73,l:74,p:75}; const held=new Set();
    const dn=e=>{ if(e.repeat||e.ctrlKey||e.metaKey)return; const m=map[e.key]; if(m&&!held.has(m)){held.add(m);noteOn(m);} };
    const up=e=>{ const m=map[e.key]; if(m){held.delete(m);noteOff(m);} };
    const kb=e=>{ if((e.ctrlKey||e.metaKey)&&e.key==="z"&&!e.shiftKey){e.preventDefault();undo();} if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.key==="z"&&e.shiftKey))){e.preventDefault();redo();} };
    window.addEventListener("keydown",dn);window.addEventListener("keyup",up);window.addEventListener("keydown",kb);
    return ()=>{window.removeEventListener("keydown",dn);window.removeEventListener("keyup",up);window.removeEventListener("keydown",kb);};
  },[noteOn,noteOff,undo,redo]);

  const arpRef=useRef({step:0,last:null,notes:[]});
  useEffect(()=>{ arpRef.current.notes=[...active]; },[active]);
  useEffect(()=>{ if(!S.arp.on)return;
    const iv=setInterval(()=>{ const a=S.arp,st=arpRef.current; let notes=[...st.notes].sort((x,y)=>x-y); if(!notes.length)return;
      const all=[]; for(let o=0;o<a.octaves;o++) notes.forEach(n=>all.push(n+o*12));
      let idx=st.step%all.length;
      if(a.mode==="down") idx=all.length-1-(st.step%all.length);
      else if(a.mode==="updown"){const p=Math.max(1,all.length*2-2),pos=st.step%p;idx=pos<all.length?pos:p-pos;}
      else if(a.mode==="random") idx=Math.floor(Math.random()*all.length);
      const on=a.stepOn[st.step%8]!==false,off=a.steps[st.step%8]||0;
      if(st.last!=null) engine.current.noteOff(st.last);
      if(on&&all[idx]!=null){const m=all[idx]+off;engine.current.noteOn(m,0.8);st.last=m;}
      st.step++; }, S.arp.rate*1000);
    return ()=>clearInterval(iv);
  },[S.arp]);

  const upOsc=(i,k,v)=>commit(s=>{const o=[...s.oscs];o[i]={...o[i],[k]:v};return{...s,oscs:o};});
  const upF1=(k,v)=>commit(s=>({...s,filt1:{...s.filt1,[k]:v}}));
  const upF2=(k,v)=>commit(s=>({...s,filt2:{...s.filt2,[k]:v}}));
  const upEnv=(k,v)=>commit(s=>({...s,env:{...s.env,[k]:v}}));
  const upLfo=(i,k,v)=>commit(s=>{const l=[...s.lfos];l[i]={...l[i],[k]:v};return{...s,lfos:l};});
  const upFx=(k,v)=>commit(s=>({...s,fx:{...s.fx,[k]:v}}));
  const upGlob=(k,v)=>commit(s=>({...s,global:{...s.global,[k]:v}}));
  const upArp=(k,v)=>setS(s=>({...s,arp:{...s.arp,[k]:v}}));
  const upMacro=(i,k,v)=>setS(s=>{const m=[...s.macros];m[i]={...m[i],[k]:v};return{...s,macros:m};});
  const addRoute=(over={})=>{ if(S.mods.length>=16)return; commit(s=>({...s,mods:[...s.mods,{...newRoute,...over,id:Date.now()}]})); };
  const delRoute=id=>commit(s=>({...s,mods:s.mods.filter(m=>m.id!==id)}));
  const upRoute=(id,k,v)=>setS(s=>({...s,mods:s.mods.map(m=>m.id===id?{...m,[k]:v}:m)}));
  const loadPreset=id=>{ const snap=PRESET_STATES[id]; if(snap) commit(s=>({...s,...snap})); setActivePreset(id); };
  const stepPreset=d=>{ const i=PRESETS.findIndex(p=>p.id===activePreset); loadPreset(PRESETS[(i+d+PRESETS.length)%PRESETS.length].id); };

  const fmtHz=v=>v>=1000?(v/1000).toFixed(1)+"k":v.toFixed(0);
  const fmtMs=v=>v<1?(v*1000).toFixed(0)+"ms":v.toFixed(2)+"s";
  const curPreset=PRESETS.find(p=>p.id===activePreset)||PRESETS[0];
  const Hint=({children})=> hints?<div style={{ fontFamily:T.font, fontSize:10.5, color:T.inkDim, lineHeight:1.3 }}>{children}</div>:null;

  return (
    <div style={{ minHeight:"100vh", fontFamily:T.font, color:T.ink, position:"relative", background:T.night }}>
      <link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Shippori+Mincho:wght@600;700&family=Yuji+Syuku&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <DuskBackdrop/>
      <div style={{ position:"relative", zIndex:1, maxWidth:1280, margin:"0 auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:7 }}>

        {/* ── TOP BAR ── */}
        <div style={{ display:"flex", alignItems:"center", gap:11, background:T.panel, backdropFilter:"blur(10px)",
          border:`1px solid ${T.lineSoft}`, borderRadius:9, padding:"5px 12px", boxShadow:"0 6px 24px #00000045" }}>
          <div style={{ display:"flex", alignItems:"center", gap:9 }}>
            {/* hanko seal — 音源 "sound source", stamped vertically */}
            <span style={{ width:22, height:36, borderRadius:4, background:grad(T.arp), display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", fontFamily:T.disp, fontSize:12, lineHeight:1.18, color:"#2a0f08",
              boxShadow:`0 0 12px ${T.arp[0]}66`, border:"1px solid #8a3424" }}>
              <span>音</span><span>源</span>
            </span>
            <div style={{ display:"flex", flexDirection:"column", lineHeight:1 }}>
              <span style={{ fontFamily:T.disp, fontSize:22, letterSpacing:"0.09em", color:T.ink,
                textShadow:`0 0 16px ${T.osc[0]}55` }}>NEUTRINO</span>
              <span style={{ fontSize:8.5, letterSpacing:"0.28em", color:T.inkFaint, marginTop:2 }}>音源 · WAVETABLE SYNTH</span>
            </div>
          </div>
          {/* preset browser */}
          <div style={{ display:"flex", alignItems:"center", gap:2, marginLeft:6, background:T.inset, border:`1px solid ${T.lineSoft}`, borderRadius:9, padding:"3px 4px" }}>
            <button onClick={()=>stepPreset(-1)} style={{ background:"transparent", border:"none", color:T.inkDim, cursor:"pointer", fontSize:13, padding:"3px 8px" }}>◀</button>
            <select value={activePreset} onChange={e=>loadPreset(+e.target.value)} style={{ background:"transparent", border:"none", color:T.ink,
              fontFamily:T.font, fontSize:13, fontWeight:600, outline:"none", minWidth:132, textAlign:"center", cursor:"pointer" }}>
              {PRESETS.map(p=><option key={p.id} value={p.id} style={{background:"#1a1c38"}}>{p.emoji} {p.name}</option>)}
            </select>
            <button onClick={()=>stepPreset(1)} style={{ background:"transparent", border:"none", color:T.inkDim, cursor:"pointer", fontSize:13, padding:"3px 8px" }}>▶</button>
          </div>
          <div style={{ display:"flex", gap:5 }}>
            <button onClick={undo} title="Undo (Ctrl+Z)" style={{ padding:"5px 10px", borderRadius:8, background:T.inset, border:`1px solid ${T.lineSoft}`, color:T.inkDim, cursor:"pointer", fontSize:13 }}>↶</button>
            <button onClick={redo} title="Redo (Ctrl+Y)" style={{ padding:"5px 10px", borderRadius:8, background:T.inset, border:`1px solid ${T.lineSoft}`, color:T.inkDim, cursor:"pointer", fontSize:13 }}>↷</button>
          </div>
          <div style={{ flex:1 }}/>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:11.5, color:T.inkDim }}>Hints</span>
            <Toggle value={hints} onChange={setHints} accent={T.lfo}/>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:9, paddingLeft:12, borderLeft:`1px solid ${T.lineSoft}` }}>
            <Meter engine={engine}/>
            <Knob value={S.vol} min={0} max={1} label="Master" accent={T.filt} size={40} modDest="Master Vol" engine={engine}
              onChange={v=>commit(s=>({...s,vol:v}))} display={(S.vol*100).toFixed(0)}/>
          </div>
        </div>

        {/* ── MAIN 3-COLUMN BODY ── */}
        <div style={{ display:"grid", gridTemplateColumns:"minmax(320px,0.92fr) minmax(380px,1.1fr) minmax(340px,1fr)", gap:7, alignItems:"start" }}>

          {/* ══ LEFT · SOURCES ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {S.oscs.map((osc,i)=>(
              <Panel key={i} title={`Osc ${i+1}`} accent={T.osc} tight
                right={<div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:T.mono,fontSize:9.5,color:osc.on?T.osc[0]:T.inkFaint}}>{osc.on?"→ FILTER":"MUTED"}</span>
                  <Toggle value={osc.on} onChange={v=>upOsc(i,"on",v)} accent={T.osc}/></div>}>
                <OscWave wave={osc.wave} accent={osc.on?T.osc:[T.inkFaint,T.inkFaint]} engine={engine} live={osc.on}/>
                <div style={{ display:"flex", gap:4 }}>{WAVEFORMS.map(w=><WaveBtn key={w} type={w} selected={osc.wave===w} accent={T.osc} onClick={()=>upOsc(i,"wave",w)}/>)}</div>
                <KnobRow>
                  <Knob value={osc.oct} min={-2} max={2} label="Oct" accent={T.osc} size={36} onChange={v=>upOsc(i,"oct",Math.round(v))} display={(osc.oct>0?"+":"")+osc.oct}/>
                  <Knob value={osc.semi} min={-12} max={12} label="Semi" accent={T.osc} size={36} onChange={v=>upOsc(i,"semi",Math.round(v))} display={(osc.semi>0?"+":"")+osc.semi}/>
                  <Knob value={osc.vol} min={0} max={1} label="Level" accent={T.osc} size={36} modDest={`Osc${i+1} Vol`} engine={engine} onChange={v=>upOsc(i,"vol",v)} display={(osc.vol*100).toFixed(0)}/>
                  <Knob value={osc.pan} min={-1} max={1} label="Pan" accent={T.osc} size={36} onChange={v=>upOsc(i,"pan",v)} display={osc.pan===0?"C":(osc.pan>0?"R":"L")+Math.abs(osc.pan*100).toFixed(0)}/>
                  <Knob value={osc.uniV} min={1} max={8} label="Unison" accent={T.osc} size={36} onChange={v=>upOsc(i,"uniV",Math.round(v))} display={Math.round(osc.uniV)+"v"}/>
                  <Knob value={osc.uniD} min={0} max={100} label="Detune" accent={T.osc} size={36} onChange={v=>upOsc(i,"uniD",v)} display={osc.uniD.toFixed(0)}/>
                </KnobRow>
              </Panel>
            ))}
            <Hint>Sources flow left → right: oscillators feed the filter, the filter feeds FX. Stack Unison voices with Detune for width.</Hint>
          </div>

          {/* ══ CENTER · TONE ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            <Panel title="Filter" accent={T.filt}
              right={<div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                {FILTER_TYPES.map((t,i)=><Pill key={t} small label={FILTER_LBLS[i]} selected={S.filt1.type===t} accent={T.filt} onClick={()=>upF1("type",t)}/>)}</div>}>
              <FilterGraph engine={engine} filt1={S.filt1}/>
              <KnobRow>
                <Knob value={S.filt1.cut} min={20} max={20000} log label="Cutoff" accent={T.filt} size={52} modDest="Filt1 Cutoff" engine={engine} onChange={v=>upF1("cut",v)} display={fmtHz(S.filt1.cut)}/>
                <Knob value={S.filt1.res} min={0.1} max={20} log label="Resonance" accent={T.filt} size={52} modDest="Filt1 Res" engine={engine} onChange={v=>upF1("res",v)} display={S.filt1.res.toFixed(1)}/>
                <Knob value={S.filt1.drive} min={0} max={1} label="Drive" accent={T.filt} size={52} onChange={v=>upF1("drive",v)} display={(S.filt1.drive*100).toFixed(0)}/>
                <Knob value={S.filt1.keytrack} min={0} max={1} label="Key Trk" accent={T.filt} size={52} onChange={v=>upF1("keytrack",v)} display={(S.filt1.keytrack*100).toFixed(0)}/>
              </KnobRow>
              <div style={{ display:"flex", alignItems:"center", gap:8, paddingTop:8, borderTop:`1px solid ${T.lineSoft}`, flexWrap:"wrap" }}>
                <Toggle value={S.filt2.on} onChange={v=>upF2("on",v)} accent={T.filt}/>
                <span style={{ fontSize:11.5, fontWeight:700, color:S.filt2.on?T.filt[0]:T.inkFaint, letterSpacing:"0.08em" }}>FILTER 2 · SERIES</span>
                {S.filt2.on && <>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1 }}>
                    {FILTER_TYPES.map((t,i)=><Pill key={t} small label={FILTER_LBLS[i]} selected={S.filt2.type===t} accent={T.filt} onClick={()=>upF2("type",t)}/>)}
                  </div>
                  <Knob value={S.filt2.cut} min={20} max={20000} log label="Cutoff" accent={T.filt} size={38} modDest="Filt2 Cutoff" engine={engine} onChange={v=>upF2("cut",v)} display={fmtHz(S.filt2.cut)}/>
                  <Knob value={S.filt2.res} min={0.1} max={20} log label="Reso" accent={T.filt} size={38} onChange={v=>upF2("res",v)} display={S.filt2.res.toFixed(1)}/>
                </>}
              </div>
              <Hint>The amber line is this filter; the coral haze is your live sound. Drag Cutoff to sweep, Resonance to sharpen the peak.</Hint>
            </Panel>

            <Panel title="Effects" accent={T.mod} tight
              right={<div style={{display:"flex",gap:5}}>{[["space","Space"],["chorus","Chorus"],["drive","Drive"],["eq","EQ"]].map(([id,l])=>
                <Pill key={id} small label={l} selected={fxTab===id} accent={T.mod} onClick={()=>setFxTab(id)}/>)}</div>}>
              {fxTab==="space"&&<KnobRow>
                <Knob value={S.fx.rvbMix} min={0} max={1} label="Reverb" accent={T.mod} size={42} modDest="Reverb Mix" engine={engine} onChange={v=>upFx("rvbMix",v)} display={(S.fx.rvbMix*100).toFixed(0)}/>
                <Knob value={S.fx.dlyT} min={0.01} max={1} label="Delay Time" accent={T.mod} size={42} onChange={v=>upFx("dlyT",v)} display={fmtMs(S.fx.dlyT)}/>
                <Knob value={S.fx.dlyF} min={0} max={0.92} label="Feedback" accent={T.mod} size={42} onChange={v=>upFx("dlyF",v)} display={(S.fx.dlyF*100).toFixed(0)}/>
                <Knob value={S.fx.dlyM} min={0} max={1} label="Delay Mix" accent={T.mod} size={42} modDest="Delay Mix" engine={engine} onChange={v=>upFx("dlyM",v)} display={(S.fx.dlyM*100).toFixed(0)}/>
              </KnobRow>}
              {fxTab==="chorus"&&<KnobRow>
                <Knob value={S.fx.chorRate} min={0.1} max={8} log label="Rate" accent={T.mod} size={42} onChange={v=>upFx("chorRate",v)} display={S.fx.chorRate.toFixed(2)}/>
                <Knob value={S.fx.chorDepth} min={0.0001} max={0.02} log label="Depth" accent={T.mod} size={42} onChange={v=>upFx("chorDepth",v)} display={(S.fx.chorDepth*1000).toFixed(1)}/>
                <Knob value={S.fx.chorMix} min={0} max={1} label="Mix" accent={T.mod} size={42} modDest="Chorus Mix" engine={engine} onChange={v=>upFx("chorMix",v)} display={(S.fx.chorMix*100).toFixed(0)}/>
              </KnobRow>}
              {fxTab==="drive"&&<KnobRow>
                <Knob value={S.fx.distDrive} min={0} max={1} label="Drive" accent={T.mod} size={42} modDest="Dist Drive" engine={engine} onChange={v=>upFx("distDrive",v)} display={(S.fx.distDrive*100).toFixed(0)}/>
                <Knob value={S.fx.distMix} min={0} max={1} label="Amount" accent={T.mod} size={42} onChange={v=>upFx("distMix",v)} display={(S.fx.distMix*100).toFixed(0)}/>
                <Knob value={S.fx.bcBits} min={1} max={16} label="Bits" accent={T.mod} size={42} onChange={v=>upFx("bcBits",Math.round(v))} display={Math.round(S.fx.bcBits)}/>
                <Knob value={S.fx.bcMix} min={0} max={1} label="Crush" accent={T.mod} size={42} onChange={v=>upFx("bcMix",v)} display={(S.fx.bcMix*100).toFixed(0)}/>
              </KnobRow>}
              {fxTab==="eq"&&<KnobRow>
                <Knob value={S.fx.eqLow} min={-1} max={1} label="Low" accent={T.mod} size={42} onChange={v=>upFx("eqLow",v)} display={(S.fx.eqLow*15).toFixed(1)}/>
                <Knob value={S.fx.eqMid} min={-1} max={1} label="Mid" accent={T.mod} size={42} onChange={v=>upFx("eqMid",v)} display={(S.fx.eqMid*15).toFixed(1)}/>
                <Knob value={S.fx.eqHigh} min={-1} max={1} label="High" accent={T.mod} size={42} onChange={v=>upFx("eqHigh",v)} display={(S.fx.eqHigh*15).toFixed(1)}/>
              </KnobRow>}
            </Panel>
          </div>

          {/* ══ RIGHT · MOTION ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            <Panel title="Envelope" accent={T.env} tight>
              <ADSRView a={S.env.a} d={S.env.d} s={S.env.s} r={S.env.r}/>
              <KnobRow>
                <Knob value={S.env.a} min={0.001} max={4} log label="Attack" accent={T.env} size={40} onChange={v=>upEnv("a",v)} display={fmtMs(S.env.a)}/>
                <Knob value={S.env.d} min={0.001} max={4} log label="Decay" accent={T.env} size={40} onChange={v=>upEnv("d",v)} display={fmtMs(S.env.d)}/>
                <Knob value={S.env.s} min={0} max={1} label="Sustain" accent={T.env} size={40} onChange={v=>upEnv("s",v)} display={(S.env.s*100).toFixed(0)}/>
                <Knob value={S.env.r} min={0.01} max={8} log label="Release" accent={T.env} size={40} onChange={v=>upEnv("r",v)} display={fmtMs(S.env.r)}/>
              </KnobRow>
            </Panel>

            <Panel title="LFO" accent={T.lfo} tight
              right={<div style={{display:"flex",gap:4}}>{[0,1,2].map(i=>
                <Pill key={i} small label={`${i+1}`} selected={lfoTab===i} accent={T.lfo} onClick={()=>setLfoTab(i)}/>)}
                <Toggle value={S.lfos[lfoTab].on} onChange={v=>upLfo(lfoTab,"on",v)} accent={T.lfo}/></div>}>
              <LFOScope wave={S.lfos[lfoTab].wave} engine={engine} idx={lfoTab} on={S.lfos[lfoTab].on}/>
              <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                <div style={{ display:"flex", gap:4, flex:1 }}>{WAVEFORMS.map(w=><WaveBtn key={w} type={w} selected={S.lfos[lfoTab].wave===w} accent={T.lfo} onClick={()=>upLfo(lfoTab,"wave",w)}/>)}</div>
                <Knob value={S.lfos[lfoTab].rate} min={0.01} max={30} log label="Rate Hz" accent={T.lfo} size={38} onChange={v=>upLfo(lfoTab,"rate",v)} display={S.lfos[lfoTab].rate.toFixed(2)}/>
              </div>
            </Panel>

            <Panel title="Modulation" accent={T.mod} tight>
              {/* macro quick row */}
              <div style={{ display:"flex", justifyContent:"space-around" }}>
                {S.macros.map((mac,i)=>(
                  <Knob key={i} value={mac.val} min={mac.bipolar?-1:0} max={1} label={mac.name} accent={T.mod} size={36}
                    onChange={v=>upMacro(i,"val",v)} display={(mac.val*100).toFixed(0)}/>
                ))}
              </div>
              {/* draggable source chips */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {SRC_GROUPS.map(g=>g.srcs.map(src=>(
                  <div key={src} draggable onDragStart={e=>{e.dataTransfer.setData("text/plain",src);setDragSrc(src);}} onDragEnd={()=>setDragSrc(null)} onClick={()=>setNewRoute(r=>({...r,src}))}
                    style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:999, cursor:"grab",
                      fontFamily:T.font, fontSize:11, fontWeight:600,
                      background:newRoute.src===src?grad(g.color):T.inset, border:`1px solid ${newRoute.src===src?"transparent":T.lineSoft}`,
                      color:newRoute.src===src?"#17251f":T.inkDim, boxShadow:dragSrc===src?`0 0 12px ${g.color[0]}aa`:"none", transition:"all .12s" }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:g.color[0], boxShadow:`0 0 5px ${g.color[0]}` }}/>{src}</div>
                )))}
              </div>
              {/* patch composer */}
              <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", background:T.inset, border:`1px solid ${T.lineSoft}`, borderRadius:9, padding:"7px 9px" }}>
                <span style={{ padding:"2px 9px", borderRadius:999, fontFamily:T.font, fontSize:11, fontWeight:700, background:grad(srcColor(newRoute.src)), color:"#17251f" }}>{newRoute.src}</span>
                <span style={{ color:T.inkFaint, fontSize:12 }}>→</span>
                <select value={newRoute.dest} onChange={e=>setNewRoute(r=>({...r,dest:e.target.value}))}
                  style={{ background:T.panelHi, border:`1px solid ${T.lineSoft}`, color:T.ink, borderRadius:7, padding:"3px 7px", fontFamily:T.mono, fontSize:10.5, outline:"none", flex:1, minWidth:100 }}>
                  {MOD_DESTS.map(d=><option key={d}>{d}</option>)}
                </select>
                <input type="range" min={-1} max={1} step={0.01} value={newRoute.amt} onChange={e=>setNewRoute(r=>({...r,amt:+e.target.value}))} style={{ width:62, accentColor:c0(T.mod) }}/>
                <span style={{ fontFamily:T.mono, fontSize:10.5, color:T.ink, minWidth:34 }}>{(newRoute.amt*100).toFixed(0)}%</span>
                <button onClick={()=>addRoute()} onDragOver={e=>e.preventDefault()} onDrop={e=>{const s=e.dataTransfer.getData("text/plain");if(s)addRoute({src:s});setDragSrc(null);}}
                  style={{ padding:"5px 13px", background:grad(T.mod), border:"none", color:"#1e1430", borderRadius:8, cursor:"pointer", fontFamily:T.font, fontSize:12, fontWeight:700 }}>Patch</button>
              </div>
              {/* routing list */}
              <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:148, overflowY:"auto" }}>
                {S.mods.length===0&&<div onDragOver={e=>e.preventDefault()} onDrop={e=>{const s=e.dataTransfer.getData("text/plain");if(s)addRoute({src:s});setDragSrc(null);}}
                  style={{ fontFamily:T.font, fontSize:12, color:T.inkFaint, textAlign:"center", padding:"14px 0",
                    border:`2px dashed ${T.lineSoft}`, borderRadius:9, background:dragSrc?"rgba(160,140,255,0.07)":"transparent" }}>
                  {dragSrc?`Drop "${dragSrc}" to connect`:"Drag a source chip here to create motion"}</div>}
                {S.mods.map(m=>(
                  <div key={m.id} style={{ display:"flex", alignItems:"center", gap:6, background:T.inset, border:`1px solid ${T.lineSoft}`, borderRadius:8, padding:"5px 8px" }}>
                    <span style={{ padding:"1px 8px", borderRadius:999, fontFamily:T.font, fontSize:10, fontWeight:700, background:grad(srcColor(m.src)), color:"#17251f" }}>{m.src}</span>
                    <span style={{ color:T.inkFaint, fontSize:11 }}>→</span>
                    <select value={m.dest} onChange={e=>upRoute(m.id,"dest",e.target.value)} style={{ background:"transparent", border:"none", color:T.ink, fontFamily:T.mono, fontSize:10.5, outline:"none", flex:1 }}>
                      {MOD_DESTS.map(d=><option key={d} style={{background:"#1a1c38"}}>{d}</option>)}
                    </select>
                    <input type="range" min={-1} max={1} step={0.01} value={m.amt} onChange={e=>upRoute(m.id,"amt",+e.target.value)} style={{ width:58, accentColor:srcColor(m.src)[0] }}/>
                    <span style={{ fontFamily:T.mono, fontSize:10, color:T.inkDim, minWidth:32 }}>{(m.amt*100).toFixed(0)}%</span>
                    <button onClick={()=>delRoute(m.id)} style={{ background:"transparent", border:"none", color:T.inkFaint, cursor:"pointer", fontSize:15, lineHeight:1 }}>×</button>
                  </div>
                ))}
              </div>
              <Hint>Everything teal/lavender here creates movement. Watch the gold ring appear on any knob you patch.</Hint>
            </Panel>
          </div>
        </div>

        {/* ── BOTTOM PERFORMANCE STRIP ── */}
        <div style={{ display:"flex", alignItems:"center", gap:12, background:T.panel, backdropFilter:"blur(10px)",
          border:`1px solid ${T.lineSoft}`, borderRadius:9, padding:"6px 12px", boxShadow:"0 6px 24px #00000045", flexWrap:"wrap" }}>
          <Piano active={active} onOn={noteOn} onOff={noteOff}/>
          <div style={{ display:"flex", flexDirection:"column", gap:8, minWidth:210 }}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ fontSize:10.5, color:T.inkDim, minWidth:38 }}>VOICE</span>
              {POLY_MODES.map(m=><Pill key={m} small label={m} selected={S.global.polyMode===m} accent={T.arp} onClick={()=>upGlob("polyMode",m)}/>)}
              <select value={S.global.voiceCount} onChange={e=>upGlob("voiceCount",+e.target.value)}
                style={{ background:T.inset, border:`1px solid ${T.lineSoft}`, color:T.ink, borderRadius:6, padding:"2px 6px", fontFamily:T.mono, fontSize:10.5, outline:"none" }}>
                {[1,2,4,8,16].map(v=><option key={v} value={v}>{v}v</option>)}
              </select>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
              <Toggle value={S.arp.on} onChange={v=>upArp("on",v)} accent={T.arp}/>
              <span style={{ fontSize:10.5, fontWeight:700, color:S.arp.on?T.arp[0]:T.inkFaint }}>ARP</span>
              {ARP_MODES.slice(0,4).map(m=><Pill key={m} small label={m} selected={S.arp.mode===m} accent={T.arp} onClick={()=>upArp("mode",m)}/>)}
              {[["1/16",0.125],["1/8",0.25],["1/4",0.5]].map(([l,v])=><Pill key={l} small label={l} selected={Math.abs(S.arp.rate-v)<0.01} accent={T.arp} onClick={()=>upArp("rate",v)}/>)}
            </div>
            <span style={{ fontFamily:T.mono, fontSize:9, color:T.inkFaint }}>keys A–L · sharps W E T Y U · Ctrl+Z undo</span>
          </div>
        </div>

      </div>
    </div>
  );
}
