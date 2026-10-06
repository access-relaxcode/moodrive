/* Bounded streaming tempo estimate from a regularly resampled onset envelope.
   This estimates repetition rate, not musical meter or semantic mood. */
class BeatTracker {
 constructor(){this.reset()}
 reset(){this.samples=[];this.previous=null;this.next=0;this.lastCheck=0;this.candidate=null;this.stable=0}
 push(time,value){
  if(!Number.isFinite(time)||!Number.isFinite(value))return null;
  if(!this.previous||time<=this.previous.time||time-this.previous.time>.25){this.reset();this.previous={time,value};this.next=time+.02;this.lastCheck=time;return null}
  while(this.next<=time){const k=(this.next-this.previous.time)/(time-this.previous.time);this.samples.push(this.previous.value+(value-this.previous.value)*k);this.next+=.02}
  this.previous={time,value};if(this.samples.length>800)this.samples.splice(0,this.samples.length-800);
  if(this.samples.length<400||time-this.lastCheck<2)return null;this.lastCheck=time;
  const result=BeatTracker.estimate(this.samples);
  if(!result){this.candidate=null;this.stable=0;return {state:'uncertain'}}
  if(this.candidate&&Math.abs(this.candidate-result.bpm)<=4)this.stable++;else this.stable=1;
  this.candidate=result.bpm;
  return {...result,state:this.stable>=2?'ready':'listening'};
 }
 static estimate(samples){
  const n=samples.length;if(n<400)return null;
  const mean=samples.reduce((a,b)=>a+b,0)/n;
  const data=samples.map(x=>x-mean),variance=data.reduce((a,b)=>a+b*b,0)/n;
  if(variance<.000002||mean<.0005)return null;
  // Reject silence at the end instead of reporting a stale tempo.
  if(samples.slice(-100).reduce((a,b)=>a+b,0)/100<.0005)return null;
  const corr=[];
  for(let lag=16;lag<=56;lag++){
   let cross=0,a=0,b=0;
   for(let i=lag;i<n;i++){cross+=data[i]*data[i-lag];a+=data[i]*data[i];b+=data[i-lag]*data[i-lag]}
   corr[lag]=cross/Math.sqrt(a*b||1);
  }
  const peaks=[];
  for(let lag=17;lag<=55;lag++)if(corr[lag]>=corr[lag-1]&&corr[lag]>=corr[lag+1]){
   const denominator=corr[lag-1]-2*corr[lag]+corr[lag+1];
   const offset=denominator?Math.max(-.5,Math.min(.5,.5*(corr[lag-1]-corr[lag+1])/denominator)):0;
   const bpm=3000/(lag+offset);if(bpm>=54&&bpm<=177)peaks.push({bpm:Math.round(Math.max(55,Math.min(175,bpm))),score:corr[lag]});
  }
  peaks.sort((a,b)=>b.score-a.score);if(!peaks.length||peaks[0].score<.38)return null;
  // Equivalent multiples of a strong repetition favour its shortest period.
  const best=peaks[0];
  const harmonic=(a,b)=>{const ratio=Math.max(a,b)/Math.min(a,b);return Math.abs(ratio-Math.round(ratio))<.08};
  const close=peaks.filter(p=>p.score>=best.score*.93||(p.bpm>best.bpm&&harmonic(p.bpm,best.bpm)&&p.score>=best.score*.7)).sort((a,b)=>b.bpm-a.bpm);
  const selected=close[0];
  const competing=peaks.find(p=>Math.abs(p.bpm-selected.bpm)>6&&!harmonic(p.bpm,selected.bpm)&&p.score>selected.score*.92);
  if(competing)return null;
  return {bpm:selected.bpm,score:selected.score};
 }
}
if(typeof window!=='undefined')window.BeatTracker=BeatTracker;
if(typeof module!=='undefined')module.exports=BeatTracker;

// Adaptive per-band onset detection. It reacts to transients, not a BPM clock.
class DrumOnsetDetector {
 constructor(){this.reset()}
 reset(){this.lastTime=null;this.started=0;this.lastHit=-10;this.bands=[{mean:0,deviation:0},{mean:0,deviation:0}]}
 push(time,low,mid){
  if(this.lastTime===null||time-this.lastTime>.25||time<this.lastTime){this.reset();this.started=time;this.lastTime=time;return 0}
  const dt=Math.max(0,time-this.lastTime);this.lastTime=time;let strength=0;
  [low,mid].forEach((value,i)=>{const b=this.bands[i],threshold=Math.max(.0015,b.mean*1.8+b.deviation*1.3),alpha=1-Math.exp(-dt/1.1);
   if(time-this.started>.2&&value>threshold)strength=Math.max(strength,Math.min(1,.35+(value-threshold)/(threshold*3)));
   const delta=Math.abs(value-b.mean);b.mean+=(value-b.mean)*alpha;b.deviation+=(delta-b.deviation)*alpha;
  });
  if(strength&&time-this.lastHit>=.13){this.lastHit=time;return strength}return 0;
 }
}
if(typeof window!=='undefined')window.DrumOnsetDetector=DrumOnsetDetector;
if(typeof module!=='undefined')module.exports.DrumOnsetDetector=DrumOnsetDetector;

// Spectral redistribution alone (e.g. a pitch glide) is not an amplitude attack.
class AttackGate {
 constructor(){this.reset()}
 reset(){this.level=null;this.history=[];this.lastTime=null;this.openUntil=-1;this.armed=true;this.start=0}
 push(time,rms){
  if(this.lastTime===null||time-this.lastTime>.25||time<this.lastTime){this.reset();this.start=time;this.level=rms;this.lastTime=time;return false}
  this.lastTime=time;this.level+=.45*(rms-this.level);
  const baseline=this.history.length?this.history.reduce((a,b)=>a+b,0)/this.history.length:this.level;
  const ratio=this.level/Math.max(.0003,baseline);
  if(ratio<1.025)this.armed=true;
  if(time-this.start>.2&&this.armed&&ratio>1.12&&this.level-baseline>.0006){this.openUntil=time+.06;this.armed=false}
  this.history.push(this.level);if(this.history.length>4)this.history.shift();
  return time<=this.openUntil;
 }
}
if(typeof window!=='undefined')window.AttackGate=AttackGate;
if(typeof module!=='undefined')module.exports.AttackGate=AttackGate;
