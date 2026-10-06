'use strict';
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');
let w=1,h=1,mood=0,drive=false,cameraView='first',travel=0,driveSpeed=18,bpm=88,intensity=.6,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,zoom=0,waveTaps=[],speedStreaks=[],streakBudget=0,particles=[],clock=0,last=0,energy=0,source='none',running=false,ac,analyser,bins,master,mediaNode,demoTimer,nextBeat=0,beat=0,objectUrl;
let autoTempo=true,beatAnalyser,beatData,previousSpectrum,beatTimer,beatFlux=0,beatLastTime=0;
const beatTracker=new BeatTracker();
const drumDetector=new DrumOnsetDetector();
const attackGate=new AttackGate();
let waterClock=0,waterEnergy=0,rhythmActivity=0,captureStream=null,captureNode=null,captureRequest=0;
let drumPulse=0,drumAge=1,drumWaves=[],hitSequence=0;
const horizonLevels=new Float32Array(65);
const palettes=[['#101324','#644064','#eda783','#4b394f','#ffbda0'],['#081d36','#235c7b','#7cc4c6','#174455','#adf7e2'],['#08091c','#2a1957','#9154a0','#170e32','#eb79fa']];
function status(text){$('status').textContent=text}
function selectSourceMethod(method){
 const methods={file:['chooseFile','filePanel'],tab:['chooseTab','tabPanel']};
 for(const [key,[button,panel]] of Object.entries(methods)){
  const active=key===method;$(button).classList.toggle('selected',active);$(button).setAttribute('aria-pressed',String(active));$(panel).hidden=!active;
 }
 $('connectionName').textContent={file:'음악 파일',tab:'탭 소리'}[method];
}
function enterExperience(method){
 selectSourceMethod(method);
 $('onboarding').hidden=true;$('experience').hidden=false;$('pageFooter').hidden=false;
 window.scrollTo({top:0,behavior:'instant'});
 requestAnimationFrame(()=>{resize();$(method==='file'?'file':'connectTab').focus({preventScroll:true})});
}
for(const [id,method] of [['chooseFile','file'],['chooseTab','tab']])$(id).onclick=()=>enterExperience(method);
$('changeSource').onclick=()=>{
 stopSources();source='none';$('sourceLabel').textContent='DEMO READY';
 $('onboarding').hidden=false;$('experience').hidden=true;$('pageFooter').hidden=true;
 status('음악 파일 또는 탭 소리를 선택하세요.');updateTempoState();
 window.scrollTo({top:0,behavior:'instant'});$('chooseFile').focus({preventScroll:true});
};

function resize(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0)}new ResizeObserver(resize).observe(canvas);
function motionUI(){$('motion').setAttribute('aria-pressed',String(reduced));$('motion').textContent=reduced?'움직임 줄임 · 켜짐':'움직임 줄이기'}motionUI();$('motion').onclick=()=>{reduced=!reduced;zoom=0;motionUI()};
function setControl(kind,value,automatic=false){
 if(kind==='tempo'&&!automatic&&autoTempo){autoTempo=false;resetBeatDetection();updateTempoState()}
 const isTempo=kind==='tempo',min=isTempo?55:0,max=isTempo?175:100;
 const next=Math.max(min,Math.min(max,Math.round(value)));
 if(isTempo)bpm=next;else intensity=next/100;
 $(kind).value=String(next);$(isTempo?'tempoOut':'intensityOut').textContent=next+(isTempo?' BPM':'%');
 const edge=$(isTempo?'bpmEdge':'intensityEdge');
 edge.setAttribute('aria-valuenow',String(next));edge.setAttribute('aria-valuetext',next+(isTempo?' BPM':'%'));
 edge.style.setProperty('--level',((next-min)/(max-min)*100)+'%');
 $(isTempo?'bpmEdgeOut':'intensityEdgeOut').textContent=next+(isTempo?'':'%');
}
$('tempo').oninput=e=>setControl('tempo',+e.target.value);$('intensity').oninput=e=>setControl('intensity',+e.target.value);
function bindEdge(id,kind){
 const edge=$(id),min=kind==='tempo'?55:0,max=kind==='tempo'?175:100;
 const value=()=>kind==='tempo'?bpm:Math.round(intensity*100);let drag=null;
 edge.onpointerdown=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(drag)return;e.preventDefault();e.stopPropagation();edge.focus({preventScroll:true});edge.setPointerCapture(e.pointerId);drag={id:e.pointerId,y:e.clientY,start:value(),span:Math.max(80,edge.getBoundingClientRect().height*.7)};edge.classList.add('active')};
 edge.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();setControl(kind,drag.start+(drag.y-e.clientY)/drag.span*(max-min))};
 const end=e=>{if(!drag||e.pointerId!==drag.id)return;drag=null;edge.classList.remove('active');if(edge.hasPointerCapture(e.pointerId))edge.releasePointerCapture(e.pointerId)};
 edge.onpointerup=end;edge.onpointercancel=end;edge.onlostpointercapture=()=>{drag=null;edge.classList.remove('active')};
 edge.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const delta=e.deltaY||e.deltaX;if(delta)setControl(kind,value()+(delta<0?1:-1)*(kind==='tempo'?2:3))},{passive:false});
 edge.onkeydown=e=>{const step=kind==='tempo'?1:2;let next=value();if(['ArrowUp','ArrowRight'].includes(e.key))next+=step;else if(['ArrowDown','ArrowLeft'].includes(e.key))next-=step;else if(e.key==='PageUp')next+=10;else if(e.key==='PageDown')next-=10;else if(e.key==='Home')next=min;else if(e.key==='End')next=max;else return;e.preventDefault();e.stopPropagation();setControl(kind,next)};
}
bindEdge('bpmEdge','tempo');bindEdge('intensityEdge','intensity');setControl('tempo',bpm,true);setControl('intensity',intensity*100);updateTempoState();
function updateTempoState(detail){
 $('autoTempo').setAttribute('aria-pressed',String(autoTempo));$('autoTempo').textContent=autoTempo?'자동 박자 · 켜짐':'자동 박자 · 꺼짐';
 let text=detail||(!autoTempo?'직접 조절 중 · 자동 버튼으로 다시 감지':['file','tab'].includes(source)?(running?'박자 감지 중 · 약 10–16초':'재생하면 다시 감지해요.'):source==='demo'?'데모는 설정한 BPM으로 연주해요.':'음악 파일이나 탭 소리를 연결하면 감지해요.');
 $('tempoStatus').textContent=text;
 $('edgeTempoState').textContent=!autoTempo?'수동':!['file','tab'].includes(source)?(source==='demo'?'데모':'수동'):detail?.startsWith('추정')?'추정':detail?.startsWith('불확실')?'불확실':running?'감지 중':'대기';
}
function resetBeatDetection(){attackGate.reset();rhythmActivity=0;drumDetector.reset();drumPulse=0;drumAge=1;drumWaves=[];horizonLevels.fill(0);beatTracker.reset();beatFlux=0;beatLastTime=0;if(previousSpectrum)previousSpectrum.fill(0)}
$('autoTempo').onclick=()=>{autoTempo=!autoTempo;resetBeatDetection();updateTempoState()};
function sampleBeat(){
 if(!beatAnalyser||!['file','demo','tab'].includes(source)||!running||document.hidden)return;
 const now=ac.currentTime;
 if(beatLastTime&&now-beatLastTime>.25){resetBeatDetection();updateTempoState()}
 if(now===beatLastTime)return;
 beatAnalyser.getFloatFrequencyData(beatData);
 let flux=0,total=0,lowFlux=0,lowCount=0,midFlux=0,midCount=0;
 // Positive spectral changes below 4 kHz emphasise onsets, not loudness alone.
 const limit=Math.min(beatData.length,Math.ceil(4000*beatAnalyser.fftSize/ac.sampleRate));
 for(let i=1;i<limit;i++){const amplitude=Number.isFinite(beatData[i])?Math.pow(10,beatData[i]/20):0;const weight=i<12?1.6:1;const change=Math.max(0,amplitude-previousSpectrum[i]);flux+=change*weight;total+=weight;const hz=i*ac.sampleRate/beatAnalyser.fftSize;if(hz<=250){lowFlux+=change;lowCount++}else{midFlux+=change;midCount++}previousSpectrum[i]=amplitude}
 flux=flux/Math.max(1,total)*20;
 // Short smoothing supports correlations across slightly jittery browser sampling.
 beatFlux=beatFlux*.3+flux*.7;beatLastTime=now;
 let spectralPower=0;
 for(const db of beatData)if(Number.isFinite(db))spectralPower+=Math.pow(10,db/10);
 const attack=attackGate.push(now,Math.sqrt(spectralPower));
 const candidate=drumDetector.push(now,lowFlux/Math.max(1,lowCount)*20,midFlux/Math.max(1,midCount)*20);
 const hit=attack?candidate:0;
 if(hit){rhythmActivity=Math.min(1,rhythmActivity+.32);drumPulse=Math.max(drumPulse,hit);drumAge=0;if(!drive)addDrumWave(hit,lowFlux,midFlux)}
 if(!autoTempo||!['file','tab'].includes(source))return;
 const result=beatTracker.push(now,beatFlux);
 if(!result)return;
 if(result.state==='ready'){setControl('tempo',result.bpm,true);updateTempoState('추정 '+result.bpm+' BPM · 자동 반영 중')}
 else if(result.state==='uncertain')updateTempoState('불확실 · 현재 속도 유지, 계속 감지 중');
 else updateTempoState('박자 후보 확인 중 · 조금만 더 재생해주세요.');
}
function updateCameraUI(){
 $('cameraControls').hidden=!drive;
 $('stage').classList.toggle('driving',drive);
 $('modeLabel').textContent=drive?(cameraView==='first'?'DRIVE / 1인칭':cameraView==='side'?'DRIVE / 측면':'DRIVE / 3인칭'):'VISUAL / 감상';
 for(const [id,view] of [['firstPerson','first'],['thirdPerson','third'],['sidePerson','side']]){const active=cameraView===view;$(id).classList.toggle('selected',active);$(id).setAttribute('aria-pressed',String(active))}
 $('cameraHint').textContent=cameraView==='first'?'길 위에서 차선과 빛이 가까이 스쳐 지나가요.':cameraView==='side'?'차를 옆에서 바라보며, 가로로 흐르는 풍경과 함께 달려요.':'멀리서 차를 따라가며 길과 풍경을 함께 바라봐요.';
}
function setMode(v){drive=v;$('drive').classList.toggle('selected',v);$('visual').classList.toggle('selected',!v);$('drive').setAttribute('aria-pressed',String(v));$('visual').setAttribute('aria-pressed',String(!v));updateCameraUI()}
$('drive').onclick=()=>setMode(true);$('visual').onclick=()=>setMode(false);
$('firstPerson').onclick=()=>{cameraView='first';updateCameraUI()};$('thirdPerson').onclick=()=>{cameraView='third';updateCameraUI()};$('sidePerson').onclick=()=>{cameraView='side';updateCameraUI()};
document.querySelectorAll('[data-mood]').forEach(b=>{b.setAttribute('aria-pressed',String(+b.dataset.mood===mood));b.onclick=()=>{mood=+b.dataset.mood;document.querySelectorAll('[data-mood]').forEach(x=>{x.classList.toggle('chosen',x===b);x.setAttribute('aria-pressed',String(x===b))});$('sceneTitle').textContent=['Afterglow','Ocean air','Night rush'][mood];$('sceneDesc').textContent=['노을빛으로 번지는 느긋한 리듬','파도 사이로 흐르는 푸른 여유','밤을 가르는 빛과 비트'][mood]}});
function burst(x,y){if(!drive){waveTaps.push({x:x/w,age:0,strength:intensity});waveTaps=waveTaps.slice(-8)}for(let i=0;i<(reduced?12:55)*intensity;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*190;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,size:1+Math.random()*3})}particles=particles.slice(-500);if($('zoom').checked&&!reduced)zoom=.16*intensity}canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect();burst(e.clientX-r.left,e.clientY-r.top)};canvas.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();burst(w/2,h/2)}};
function updateFullscreen(){const active=!!document.fullscreenElement||$('stage').classList.contains('immersive');$('fullscreen').textContent=active?'⛶ 전체 화면 종료':'⛶ 전체 화면';$('fullscreen').setAttribute('aria-pressed',String(active));requestAnimationFrame(resize)}
function immersiveFallback(active){$('stage').classList.toggle('immersive',active);document.body.classList.toggle('immersive-open',active);updateFullscreen()}
$('fullscreen').onclick=async()=>{if(document.fullscreenElement){try{await document.exitFullscreen()}catch{status('전체 화면 종료 버튼을 다시 누르거나 Esc 키를 눌러주세요.')}return}if($('stage').classList.contains('immersive')){immersiveFallback(false);return}try{if(!$('stage').requestFullscreen)throw new Error('unavailable');await $('stage').requestFullscreen()}catch{immersiveFallback(true)}};
document.addEventListener('fullscreenchange',updateFullscreen);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('stage').classList.contains('immersive'))immersiveFallback(false)});
async function audioInit(){if(!ac){ac=new(window.AudioContext||window.webkitAudioContext)();analyser=ac.createAnalyser();analyser.fftSize=512;bins=new Uint8Array(analyser.frequencyBinCount);master=ac.createGain();master.gain.value=.55;master.connect(analyser);master.connect(ac.destination);beatAnalyser=ac.createAnalyser();beatAnalyser.fftSize=1024;beatAnalyser.smoothingTimeConstant=0;beatData=new Float32Array(beatAnalyser.frequencyBinCount);previousSpectrum=new Float32Array(beatAnalyser.frequencyBinCount);analyser.connect(beatAnalyser);beatTimer=setInterval(sampleBeat,20)}await ac.resume()}
function stopDemo(){clearInterval(demoTimer);demoTimer=null;if(master&&ac){master.gain.cancelScheduledValues(ac.currentTime);master.gain.setValueAtTime(0,ac.currentTime)}$('demo').textContent='▶ 데모 음악 시작'}
function stopSources(){
 captureRequest++;stopCapture(false);stopDemo();running=false;source='none';
 $('audio').pause();$('audio').hidden=true;$('audio').removeAttribute('src');$('audio').load();$('file').value='';
 if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
 resetBeatDetection();
}
function tone(freq,time,duration,type,volume){const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(volume,time+.012);g.gain.exponentialRampToValueAtTime(.0001,time+duration);o.connect(g);g.connect(master);o.start(time);o.stop(time+duration+.02);o.onended=()=>{o.disconnect();g.disconnect()}}
function schedule(){while(nextBeat<ac.currentTime+.15){const step=60/bpm,notes=[220,261.63,329.63,392];tone(notes[Math.floor(beat/8)%4]/2,nextBeat,step*.7,'sine',.32);tone(notes[beat%4]*(mood===2?2:1),nextBeat,step*1.7,'sine',.16);if(beat%2===0){const o=ac.createOscillator(),g=ac.createGain();o.frequency.setValueAtTime(130,nextBeat);o.frequency.exponentialRampToValueAtTime(42,nextBeat+.16);g.gain.setValueAtTime(.4,nextBeat);g.gain.exponentialRampToValueAtTime(.001,nextBeat+.25);o.connect(g);g.connect(master);o.start(nextBeat);o.stop(nextBeat+.26);o.onended=()=>{o.disconnect();g.disconnect()}}nextBeat+=step;beat++}}
$('demo').onclick=async()=>{if(source==='demo'&&running){stopDemo();running=false;$('sourceLabel').textContent='DEMO PAUSED';status('데모 음악을 멈췄어요.');return}try{stopSources();await audioInit();master.gain.setValueAtTime(.55,ac.currentTime);source='demo';running=true;resetBeatDetection();updateTempoState();nextBeat=ac.currentTime+.03;beat=0;schedule();demoTimer=setInterval(schedule,80);$('demo').textContent='Ⅱ 데모 음악 정지';$('sourceLabel').textContent='LIVE AUDIO / 데모';$('audio').hidden=true;status('데모 음악의 실제 음량과 저음에 화면이 반응하고 있어요.')}catch{status('오디오를 시작하지 못했어요. 다른 브라우저에서 다시 시도해주세요.')}};
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{stopSources();await audioInit();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(f);$('audio').src=objectUrl;if(!mediaNode){mediaNode=ac.createMediaElementSource($('audio'));mediaNode.connect(analyser);mediaNode.connect(ac.destination);}source='file';selectSourceMethod('file');autoTempo=true;resetBeatDetection();$('audio').hidden=false;await $('audio').play();status(f.name+' · 실제 소리 반응 · BPM 자동 감지 중. 분위기는 직접 선택해주세요.')}catch{status('이 음악 파일을 재생할 수 없어요. MP3 또는 WAV 파일을 선택해주세요.')}};
$('audio').onplay=()=>{captureRequest++;stopCapture(false);stopDemo();running=true;source='file';if(ac)ac.resume();$('sourceLabel').textContent='LIVE AUDIO / 파일';resetBeatDetection();updateTempoState()};$('audio').onpause=()=>{if(source==='file'){running=false;$('sourceLabel').textContent='AUDIO PAUSED';resetBeatDetection();updateTempoState()}};$('audio').onerror=()=>status('지원하지 않거나 손상된 음악 파일이에요. 다른 파일을 선택해주세요.');
$('audio').onseeking=()=>{resetBeatDetection();updateTempoState()};$('audio').onratechange=()=>{resetBeatDetection();updateTempoState()};
document.addEventListener('visibilitychange',()=>{if(['file','tab'].includes(source)){resetBeatDetection();updateTempoState()}});
function stopCapture(announce=true){
 const previous=captureStream;captureStream=null;
 if(captureNode){captureNode.disconnect();captureNode=null}
 if(previous)previous.getTracks().forEach(track=>track.stop());
 $('connectTab').textContent='탭 소리 연결';$('connectTab').setAttribute('aria-pressed','false');
 if(source==='tab'){source='none';running=false;resetBeatDetection();updateTempoState();$('sourceLabel').textContent='TAB DISCONNECTED';if(announce)status('탭 소리 연결을 해제했어요. 원래 탭의 음악은 계속 재생될 수 있어요.')}
}
$('connectTab').onclick=async()=>{selectSourceMethod('tab');
 if(captureStream){captureRequest++;stopCapture();return}
 if(!navigator.mediaDevices?.getDisplayMedia){status('이 환경에서는 탭 소리 연결을 지원하지 않아요. PC 브라우저에서 열거나 음악 파일을 이용해주세요.');return}
 const ticket=++captureRequest;$('connectTab').disabled=true;let stream=null;
 try{
  // Must originate directly from the user's click. No recording or upload.
  stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:{suppressLocalAudioPlayback:false},selfBrowserSurface:'include',systemAudio:'exclude',monitorTypeSurfaces:'exclude',surfaceSwitching:'exclude'});
  if(ticket!==captureRequest){stream.getTracks().forEach(t=>t.stop());return}
  if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());status('소리가 공유되지 않았어요. 음악이 재생되는 탭을 고르고 ‘탭 오디오 공유’를 켜주세요.');return}
  await audioInit();
  if(ticket!==captureRequest){stream.getTracks().forEach(t=>t.stop());return}
  stopDemo();$('audio').pause();$('audio').hidden=true;
  captureStream=stream;captureNode=ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  // Analyse only: never feed captured audio to the speakers and back into capture.
  captureNode.connect(analyser);source='tab';running=true;selectSourceMethod('tab');autoTempo=true;resetBeatDetection();updateTempoState();
  $('sourceLabel').textContent='LIVE AUDIO / 탭';$('connectTab').textContent='탭 소리 연결 해제';$('connectTab').setAttribute('aria-pressed','true');
  status('탭 소리가 연결됐어요. 음악을 재생하고 화면으로 돌아오세요. 실제 소리에 반응합니다.');
  for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(captureStream===stream)stopCapture()});
 }catch(error){if(stream){stream.getTracks().forEach(t=>t.stop());if(captureStream===stream)stopCapture(false)}status(error.name==='NotAllowedError'?'공유가 취소되었거나 허용되지 않았어요. 음악 파일로도 계속 이용할 수 있어요.':'탭 소리를 연결하지 못했어요. PC 브라우저의 탭 오디오 공유를 확인해주세요.')}
 finally{$('connectTab').disabled=false}
};
window.addEventListener('pagehide',()=>{captureRequest++;stopCapture(false)});
function line(x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
function polygon(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill()}
// Road, lane marks, roadside lights and car share one world-space projection.
// Integrating distance (rather than time * current speed) prevents jumps when BPM changes.
const wrap=(n,m)=>((n%m)+m)%m;
function drawDrive(p,horizon,power,dt){
 const third=cameraView==='third';
 const desired=(12+(bpm-55)*.3)*(1+power*.65);
 driveSpeed+=(desired-driveSpeed)*(1-Math.exp(-dt*3));
 travel+=driveSpeed*dt*(reduced?.035:1);
 if(cameraView==='side'){drawSideDrive(p,horizon,power);return}
 const focal=Math.min(w*.9,h*.95),height=third?5.8:1.25,near=third?3:1.15,far=240;
 const roadCenter=z=>Math.sin((travel+z)*.006)*6;
 const cameraX=roadCenter(third?30:0);
 const project=(x,y,z)=>({x:w*.5+(x-cameraX)*focal/z,y:horizon+(height-y)*focal/z});
 const roadPoint=(side,z)=>project(roadCenter(z)+side,0,z);
 // Distant scenery has a much slower displacement than nearby road furniture.
 for(let layer=0;layer<2;layer++){
  const pts=[[0,horizon]];
  for(let x=0;x<=w+12;x+=12)pts.push([x,horizon-16-layer*12-Math.pow(Math.sin(x/w*4+travel*.0008+layer*1.4),2)*(25+layer*18)]);
  pts.push([w,horizon]);polygon(pts,layer?'#17243255':'#20203f55');
 }
 for(let i=69;i>=0;i--){
  const z0=near*Math.pow(far/near,i/70),z1=near*Math.pow(far/near,(i+1)/70);
  const quad=(left,right,color)=>{const a=roadPoint(left,z0),b=roadPoint(right,z0),c=roadPoint(right,z1),d=roadPoint(left,z1);polygon([[a.x,a.y],[b.x,b.y],[c.x,c.y],[d.x,d.y]],color)};
  quad(-5.4,5.4,mood===1?'#b2a68c':'#484052');quad(-4.7,4.7,'#171b28');
  quad(-4.62,-4.52,p[4]);quad(4.52,4.62,p[4]);
 }
 const marks=[];
 for(let i=0;i<40;i++){const z=wrap(i*6-travel,240);if(z>near&&z<far-2)marks.push(z)}
 marks.sort((a,b)=>b-a);
 for(const z of marks){for(const x of [-1.52,1.52]){const a=roadPoint(x-.035,z),b=roadPoint(x+.035,z),c=roadPoint(x+.035,z+2),d=roadPoint(x-.035,z+2);polygon([[a.x,a.y],[b.x,b.y],[c.x,c.y],[d.x,d.y]],'#e5d7beaa')}}
 const posts=[];
 for(let i=0;i<24;i++){const z=wrap(i*10-travel,240);if(z>near)posts.push(z)}
 posts.sort((a,b)=>b-a);
 for(const z of posts)for(const side of [-1,1]){const x=roadCenter(z)+side*5.7,a=project(x,0,z),b=project(x,.7,z);line(a.x,a.y,b.x,b.y,'#c5bbc588',Math.max(1,focal*.05/z));line(b.x,b.y,b.x,b.y+Math.max(2,focal*.16/z),p[4],Math.max(1,focal*.08/z))}
 if(third){
  // Small rear-view car sits on the same road, under an elevated following camera.
  const z=22,center=roadCenter(z),unit=focal/z;
  // Restore car size, then place its ground contact low in the frame without moving the camera.
  const originalGround=project(center,0,z),targetY=h*.86;
  const anchorDepth=height*focal/(targetY-horizon),targetGround=roadPoint(0,anchorDepth);
  ctx.save();ctx.translate(targetGround.x-originalGround.x,targetY-originalGround.y);
  const carPoint=(x,y,dz)=>{const v=project(center+x,y,z+dz);return [v.x,v.y]};
  const face=(pts,color)=>polygon(pts.map(v=>carPoint(...v)),color);
  const ground=project(center,0,z);ctx.fillStyle='#00000066';ctx.beginPath();ctx.ellipse(ground.x,ground.y,unit*1.25,unit*.23,0,0,Math.PI*2);ctx.fill();
  face([[-1.05,.1,-.15],[-.8,.1,2],[-.8,.52,2],[-1.05,.52,-.15]],'#090d16');
  face([[1.05,.1,-.15],[.8,.1,2],[.8,.52,2],[1.05,.52,-.15]],'#090d16');
  face([[-1,.45,0],[1,.45,0],[.9,.7,2.8],[-.9,.7,2.8]],'#7998a8');
  face([[-.78,.75,.8],[.78,.75,.8],[.66,1.25,1.65],[-.66,1.25,1.65]],'#162b42');
  face([[-.66,1.25,1.65],[.66,1.25,1.65],[.62,1.22,2.5],[-.62,1.22,2.5]],'#c4d7dc');
  face([[-1,.25,0],[1,.25,0],[1,.7,0],[-1,.7,0]],'#9ab4c2');
  for(const side of [-1,1]){const a=carPoint(side*.48,.56,-.015),b=carPoint(side*.88,.56,-.015);line(...a,...b,'#ff796f',Math.max(2,unit*.09))}
  const a=carPoint(-.88,.27,-.02),b=carPoint(.88,.27,-.02);line(...a,...b,'#293b50',Math.max(1,unit*.06));ctx.restore();
 }
}
function drawSideDrive(p,horizon,power){
 // Side-on tracking camera: distant landscape, car, foreground camera plane.
 for(let layer=0;layer<3;layer++){
  const floor=horizon+h*(.05+layer*.065),pts=[[0,floor]];
  for(let x=0;x<=w+10;x+=10){const phase=x/w*6+travel*(.001+layer*.0018);pts.push([x,floor-(Math.sin(phase)+Math.sin(phase*1.7+.8)*.4+1.5)*(18+layer*8)])}
  pts.push([w,horizon+h*.3],[0,horizon+h*.3]);polygon(pts,['#30304966','#25253b99',p[3]][layer]);
 }
 // Pull back without changing the accepted side-on angle. Reveal the bridge below.
 const roadY=h*.73,deckBottom=roadY+31;
 const water=ctx.createLinearGradient(0,deckBottom,0,h);
 water.addColorStop(0,p[3]);water.addColorStop(1,p[0]);ctx.fillStyle=water;ctx.fillRect(0,deckBottom,w,h-deckBottom);
 for(let i=0;i<24;i++){
  const x=wrap(i*83-travel*1.2,w+140)-70,y=deckBottom+18+(i%7)*(h-deckBottom)/8;
  line(x,y,x+20+(i%4)*13,y,p[4]+'24',1);
 }
 // Bridge supports and road marks share the same scrolling speed.
 const pierStep=Math.max(175,Math.min(290,w*.42)),bridgeOffset=wrap(travel*13,pierStep);
 for(let x=-bridgeOffset-pierStep;x<w+pierStep;x+=pierStep){
  polygon([[x-29,deckBottom],[x+29,deckBottom],[x+16,deckBottom+19],[x+13,h+25],[x-13,h+25],[x-16,deckBottom+19]],'#263041');
  polygon([[x+18,deckBottom],[x+29,deckBottom],[x+16,deckBottom+19],[x+13,h+25],[x+6,h+25],[x+8,deckBottom+19]],'#161d2c');
  line(x-29,deckBottom+1,x+29,deckBottom+1,p[4]+'55',2);
 }
 ctx.fillStyle='#161d2a';ctx.fillRect(0,roadY-12,w,31);
 ctx.fillStyle='#3b4656';ctx.fillRect(0,roadY+19,w,12);
 line(0,roadY+20,w,roadY+20,p[4]+'77',2);
 line(0,deckBottom,w,deckBottom,'#0b111d',3);
 line(0,roadY-10,w,roadY-10,p[4]+'88',2);
 const roadStep=100,offset=wrap(travel*13,roadStep);
 for(let x=-offset;x<w+roadStep;x+=roadStep)line(x,roadY+11,x+48,roadY+11,'#e5d7be99',2);
 // A low far-side railing leaves the car's silhouette unobstructed.
 const postStep=64,postOffset=wrap(travel*13,postStep);
 line(0,roadY-24,w,roadY-24,'#a8b6c17a',1.5);
 for(let x=-postOffset;x<w+postStep;x+=postStep)line(x,roadY-11,x,roadY-24,'#bec3ce88',1.5);
 const size=Math.min(112,w*.225),unit=size/120,cx=w*.25,cy=roadY-5;
 ctx.save();ctx.translate(cx,cy);ctx.scale(unit,unit);
 ctx.fillStyle='#00000066';ctx.beginPath();ctx.ellipse(0,5,64,7,0,0,Math.PI*2);ctx.fill();
 polygon([[-60,-13],[-55,-27],[-31,-31],[-15,-47],[18,-47],[38,-30],[57,-25],[63,-13],[60,-3],[-58,-3]],'#a8c6cc');
 polygon([[-27,-30],[-12,-42],[1,-42],[1,-30]],'#1a3049');
 polygon([[6,-42],[17,-42],[32,-30],[6,-30]],'#1a3049');
 line(-54,-17,58,-17,'#d8eef0',1.5);line(4,-29,4,-8,'#627d8d',1);line(8,-23,15,-23,'#3d5667',2);
 line(57,-22,62,-20,'#fff1b5',3);line(-57,-23,-57,-17,'#ff817d',3);
 for(const x of [-37,38]){ctx.fillStyle='#0b101b';ctx.beginPath();ctx.arc(x,-3,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#8c9cac';ctx.beginPath();ctx.arc(x,-3,7,0,Math.PI*2);ctx.fill();for(let i=0;i<3;i++){const a=travel*1.2+i*Math.PI/3;line(x+Math.cos(a)*6,-3+Math.sin(a)*6,x-Math.cos(a)*6,-3-Math.sin(a)*6,'#28384c',2)}}
 ctx.restore();

}
function waveDisplacement(x,j){
 let displacement=0;
 for(const tap of waveTaps){const d=Math.abs(x/w-tap.x),front=tap.age*1.05,envelope=Math.exp(-Math.pow((d-front)/.15,2));displacement+=Math.cos(d*25-tap.age*17+j*.32)*envelope*Math.exp(-tap.age*3.4)*Math.min(85,h*.13)*tap.strength*(reduced?.15:1)}
 return displacement;
}
function drawSpeedLines(p,power,dt){
 const amount=Math.max(0,(bpm-85)/90)*intensity;
 if(reduced||!drive||intensity===0){speedStreaks=[];streakBudget=0;return}
 const density=Math.min(1,amount+power*.3);
 streakBudget+=dt*density*190;
 while(streakBudget>=1){streakBudget--;speedStreaks.push({a:Math.random()*Math.PI*2,r:.48+Math.random()*.35,v:1.2+Math.random()*2.3,len:.18+Math.random()*.4,width:.5+Math.random()*2,life:0})}
 speedStreaks=speedStreaks.slice(-150);
 // Draw in screen space after the camera zoom: the clear centre keeps the subject visible.
 for(const s of speedStreaks){s.life+=dt;s.r+=dt*s.v;const fade=Math.min(1,s.life*14)*Math.max(0,1-(s.r-.9)/.75);ctx.globalAlpha=fade*(.2+density*.55);const ax=Math.cos(s.a)*w*.57,ay=Math.sin(s.a)*h*.62;
 line(w*.5+ax*s.r,h*.51+ay*s.r,w*.5+ax*(s.r+s.len),h*.51+ay*(s.r+s.len),p[4],s.width*(.7+density));}
 ctx.globalAlpha=1;speedStreaks=speedStreaks.filter(s=>s.r<1.65);
}
function addDrumWave(strength,low,mid){
 const bassShare=low/(low+mid+.000001);
 // A low-discrepancy progression varies each onset's origin without random flicker.
 const phase=(hitSequence*.61803398875+bassShare*.17)%1;
 drumWaves.push({x:.12+phase*.76,layer:(hitSequence*2+(bassShare>.55?0:1))%6,age:0,strength,width:.075+bassShare*.06});
 hitSequence++;drumWaves=drumWaves.slice(-10);
}
function drumWaveDisplacement(x,layer){
 let sum=0;
 for(const wave of drumWaves){
  const distance=Math.abs(x/w-wave.x),radius=wave.age*.56;
  const envelope=Math.exp(-Math.pow((distance-radius)/wave.width,2));
  const layerWeight=Math.exp(-Math.pow((layer-wave.layer)/1.7,2));
  sum+=Math.cos((distance-radius)*26)*envelope*layerWeight*Math.exp(-wave.age*3.3)*wave.strength;
 }
 return Math.tanh(sum)*Math.min(95,h*.12)*intensity*(reduced?.18:1);
}
function drawHorizon(p,y,dt){
 const realAudio=running&&['file','demo','tab'].includes(source)&&analyser&&ac;
 const maxBin=realAudio?bins.length-1:1;
 for(let i=0;i<horizonLevels.length;i++){
  let target=0;
  if(realAudio){
   const hz=60*Math.pow(8000/60,i/(horizonLevels.length-1));
   const index=Math.max(1,Math.min(maxBin,Math.round(hz*analyser.fftSize/ac.sampleRate)));
   // Average adjacent bins to preserve a connected, soft line at the horizon.
   for(let b=Math.max(1,index-1);b<=Math.min(maxBin,index+1);b++)target+=bins[b]/255;
   target/=Math.min(maxBin,index+1)-Math.max(1,index-1)+1;
   target=Math.pow(target,1.7)*intensity*(reduced?.25:1);
  }
  horizonLevels[i]+=(target-horizonLevels[i])*(1-Math.exp(-dt*(target>horizonLevels[i]?16:6)));
 }
 const amplitude=Math.min(58,h*.075),spacing=w/horizonLevels.length;
 ctx.save();ctx.lineCap='round';
 for(let i=0;i<horizonLevels.length;i++){
  const x=(i+.5)*spacing,level=horizonLevels[i],height=1+level*amplitude;
  ctx.globalAlpha=.18+level*.45;line(x,y+height*.3,x,y-height,p[4],Math.max(1.2,Math.min(3,spacing*.32)));
 }
 ctx.globalAlpha=.3;line(0,y,w,y,p[4],1);ctx.restore();
}
function frame(t){requestAnimationFrame(frame);const dt=Math.min((t-last)/1000||.016,.05);last=t;if(document.hidden)return;let raw=0;if(running&&analyser){analyser.getByteFrequencyData(bins);for(let i=1;i<28;i++)raw+=bins[i];raw/=27*255}energy+=(raw-energy)*.16;for(const wave of drumWaves)wave.age+=dt;drumWaves=drumWaves.filter(wave=>wave.age<1.35);drumAge+=dt;drumPulse*=Math.exp(-dt*10);const drumImpact=drumPulse*intensity*(reduced?.2:1);rhythmActivity*=Math.exp(-dt*.9);waterEnergy+=(energy-waterEnergy)*(1-Math.exp(-dt*1.4));waterClock+=dt*(reduced?.025:.1+rhythmActivity*.9);const power=energy*intensity;clock+=dt*(reduced?.06:1);zoom*=Math.exp(-dt*9);for(const tap of waveTaps)tap.age+=dt;waveTaps=waveTaps.filter(tap=>tap.age<1.3);const p=palettes[mood],horizon=h*.54,cx=w*.57;
ctx.save();ctx.translate(w/2,h/2);ctx.scale(1+zoom,1+zoom);ctx.translate(-w/2,-h/2);let sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,p[0]);sky.addColorStop(.42,p[1]);sky.addColorStop(.57,p[2]);sky.addColorStop(1,p[0]);ctx.fillStyle=sky;ctx.fillRect(-w,-h,w*3,h*3);
const radius=Math.min(w*.14,h*.15)*(1+waterEnergy*intensity*.2),sunX=w*.69,sunY=h*.46;let glow=ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,radius*2.5);glow.addColorStop(0,p[4]+'88');glow.addColorStop(1,p[4]+'00');ctx.fillStyle=glow;ctx.fillRect(sunX-radius*3,sunY-radius*3,radius*6,radius*6);ctx.fillStyle=p[4];ctx.beginPath();ctx.arc(sunX,sunY,radius,0,Math.PI*2);ctx.fill();
ctx.fillStyle=p[3];ctx.fillRect(0,horizon,w,h-horizon);for(let i=0;i<50;i++){const z=((i/50+clock*.008)%1),y=horizon+z*z*(h-horizon),s=(Math.sin(i*17.9)*.5+.5);line(w*s,y,w*s+w*(.01+z*.14),y,p[4]+(mood===2?'22':'38'),.5+z)}
if(drive){drawDrive(p,horizon,power,dt)}
else{drawHorizon(p,horizon,dt);for(let j=0;j<6;j++){ctx.beginPath();for(let x=0;x<=w+5;x+=5){const y=h*(.68+j*.022)+Math.sin(waterClock*.13+j*.8)*h*.018+Math.sin(x/w*7+waterClock*.55+j*.32)*(12+waterEnergy*intensity*12)+Math.sin(x/w*13-waterClock*.4)*8+drumWaveDisplacement(x,j)+waveDisplacement(x,j); x===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.strokeStyle=p[4]+['aa','88','66','44','33','22'][j];ctx.lineWidth=(j===0?2:1)+drumImpact*.5;ctx.stroke()}for(let i=0;i<85;i++){const x=((Math.sin(i*74.2)*.5+.5)*w+Math.sin(clock*.1+i)*15),y=((i*.618+clock*.006)%1)*h;ctx.globalAlpha=(.15+Math.sin(i+clock)*.12)*(1+power);ctx.fillStyle='#fff4e5';ctx.beginPath();ctx.arc(x,y,1+(i%3)*.5,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1}
for(const a of particles){a.life-=dt*(reduced?2:1.1);a.x+=a.vx*dt;a.y+=a.vy*dt;a.vx*=.98;a.vy*=.98;ctx.globalAlpha=Math.max(0,a.life);const s=a.size*a.life;line(a.x-s*2,a.y,a.x+s*2,a.y,'#fff5d5',1.3);line(a.x,a.y-s*2,a.x,a.y+s*2,'#fff5d5',1.3)}particles=particles.filter(a=>a.life>0);ctx.globalAlpha=1;let shade=ctx.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#090c1422');shade.addColorStop(.8,'#090c1400');shade.addColorStop(1,'#090c14bb');ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);ctx.restore();drawSpeedLines(p,power,dt)}
requestAnimationFrame(frame);
