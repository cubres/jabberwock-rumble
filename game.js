/* Presentation, input, and synthesized audio. No external services or dependencies. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const W = 1200, H = 675, GROUND = 555;
  let game = new RumbleEngine.Game(), akaneSkin = 'classic', enemySkin = 'classic';
  let ready = false, clock = 0, last = 0, countdown = 0, bannerTime = 0, shake = 0, flash = 0;
  let previousPhase = '', reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let helpPaused = false, resultDelay = 0, pendingResult = false;
  const inputSources = new Map(), actionQueues = {jump:0,attack:0,special:0}, actionDown = {jump:false,attack:false,special:false};
  const images = {}, particles = [], texts = [];
  const assets = ['akane-classic', 'akane-island', 'akane-midnight', 'nekomaru-classic', 'nekomaru-mecha', 'island'];
  const colors = {player: '#ff238c', enemy: '#f7f7f2'};
  const inputMap = {KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'jump',ArrowUp:'jump',Space:'jump',KeyJ:'attack',KeyK:'block',KeyL:'special'};
  function keyCode(e){return inputMap[e.code]||['Escape','Enter','KeyP'].includes(e.code)?e.code:({a:'KeyA',d:'KeyD',w:'KeyW',j:'KeyJ',k:'KeyK',l:'KeyL',p:'KeyP',' ':'Space',escape:'Escape',enter:'Enter',arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp'}[String(e.key||e.code).toLowerCase()]||e.code);}
  const sound = {
    enabled:false, ctx:null, nextBeat:0, beat:0,
    unlock(){ if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state==='suspended') this.ctx.resume(); },
    tone(freq,duration=.12,type='sine',volume=.06,slide=1){
      if(!this.enabled || !this.ctx) return;
      const t=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=type; o.frequency.setValueAtTime(freq,t); o.frequency.exponentialRampToValueAtTime(Math.max(25,freq*slide),t+duration);
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
      o.connect(g);g.connect(this.ctx.destination);o.start(t);o.stop(t+duration+.01);
    },
    event(type){
      if(type==='hit'){this.tone(155,.11,'sawtooth',.07,.25);this.tone(70,.16,'sine',.15,.4);}
      if(type==='block')this.tone(620,.09,'triangle',.1,.35);
      if(type==='perfect'){this.tone(880,.22,'sine',.09,1.5);this.tone(1320,.2,'triangle',.05);}
      if(type==='jump')this.tone(240,.13,'sine',.035,2.3);
      if(type==='attack')this.tone(360,.09,'triangle',.035,.3);
      if(type==='special'){this.tone(90,.65,'sawtooth',.07,5);this.tone(350,.6,'triangle',.05,2);}
      if(type==='modifier'){this.tone(523,.4,'square',.028);this.tone(784,.45,'triangle',.05);}
      if(type==='heal')this.tone(660,.2,'sine',.08,2);
      if(type==='roundover'){this.tone(220,.65,'triangle',.07,.5);this.tone(440,.5,'sine',.05,.5);}
    },
    tick(){
      if(!this.enabled || !this.ctx || game.phase!=='fight' || countdown>0) return;
      const t=this.ctx.currentTime;if(t<this.nextBeat)return; this.nextBeat=t+.23;
      const notes=[110,0,165,0,130.81,0,164.81,196,110,0,146.83,0,130.81,0,164.81,0];
      const n=notes[this.beat%notes.length];if(n)this.tone(n,.18,'triangle',.022);
      if(this.beat%4===0)this.tone(75,.11,'sine',.04,.4);
      if(this.beat%4===2)this.tone(1000,.04,'triangle',.012,.1);
      this.beat++;
    }
  };
  function ellipse(x,y,rx,ry,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
  function label(text,x,y,size,color='#fff',stroke=true){ctx.font=`400 ${size}px Anton, Impact, sans-serif`;ctx.textAlign='center';ctx.lineJoin='round';if(stroke){ctx.strokeStyle='#141017';ctx.lineWidth=5;ctx.strokeText(text,x,y);}ctx.fillStyle=color;ctx.fillText(text,x,y);}
  function banner(text,duration=1.2){$('announcement').textContent=text;bannerTime=duration;}
  function syncTouch(){
    const held=new Set(inputSources.values());
    document.querySelectorAll('.touch-controls button').forEach(b=>{if(held.has(b.dataset.input))b.classList.add('active');else b.classList.remove('active');});
  }
  const holdPulses={left:0,right:0};
  function clearInput(){inputSources.clear();for(const a in actionQueues){actionQueues[a]=0;actionDown[a]=false;}for(const a in holdPulses)holdPulses[a]=0;syncTouch();}
  function press(source,action){
    if(game.phase!=='fight'||countdown>0||$('instructions').open||inputSources.has(source))return;
    inputSources.set(source,action);
    if(Object.hasOwn(actionQueues,action))actionQueues[action]=Math.min(4,actionQueues[action]+1);
    if(Object.hasOwn(holdPulses,action))holdPulses[action]=.06;
    syncTouch();
  }
  function release(source){inputSources.delete(source);syncTouch();}
  function input(dt){
    const held=new Set(inputSources.values()), state={block:held.has('block')};
    for(const a in holdPulses){state[a]=held.has(a)||holdPulses[a]>0;holdPulses[a]=Math.max(0,holdPulses[a]-dt);}
    // Every tap gets its own rising edge, separated by a released frame.
    for(const a in actionQueues){
      if(actionDown[a]){state[a]=false;actionDown[a]=false;}
      else if(actionQueues[a]>0){state[a]=true;actionQueues[a]--;actionDown[a]=true;}
      else state[a]=false;
    }
    return state;
  }
  function showResult(){
    const result=game.roundResult||{}, won=result.winner==='player', draw=result.winner==='draw', match=game.phase==='matchover';
    $('overlay-kicker').textContent=match?'MATCH OVER':`ROUND ${game.round}`;
    $('overlay-title').textContent=draw?'DEAD EVEN!':won?(match?'AKANE WINS!':'ROUND YOURS!'):(match?'NEKOMARU WINS!':'ROUND LOST!');
    $('overlay-copy').textContent=draw?'Go again.':won?'':(match?'Rematch?':'Block or jump when he winds up.');
    $('continue').textContent=match?'REMATCH':'NEXT ROUND';
    $('overlay').hidden=false;clearInput();
  }
  function showPause(){
    $('overlay-kicker').textContent='';$('overlay-title').textContent='PAUSED';$('overlay-copy').textContent='';
    $('continue').textContent='RESUME';$('overlay').hidden=false;clearInput();
  }
  function pause(){if(game.phase==='fight'){game.togglePause();showPause();}else if(game.phase==='paused'){clearInput();game.togglePause();$('overlay').hidden=true;canvas.focus();}}
  function begin(){
    if(!ready)return;game=new RumbleEngine.Game({difficulty:$('difficulty').value});game.start();
    $('intro').hidden=true;$('overlay').hidden=true;$('pause').hidden=false;
    $('loadout').hidden=true;clearInput();particles.length=0;texts.length=0;pendingResult=false;previousPhase='';canvas.focus();
    handleEvents();
  }
  function menu(){
    game=new RumbleEngine.Game({difficulty:$('difficulty').value});$('intro').hidden=false;$('overlay').hidden=true;$('pause').hidden=true;$('loadout').hidden=false;
    clearInput();countdown=0;bannerTime=0;pendingResult=false;previousPhase='';particles.length=0;texts.length=0;$('start').focus();
  }
  $('start').addEventListener('click',begin);
  $('pause').addEventListener('click',pause);
  $('continue').addEventListener('click',()=>{if(game.phase==='paused')pause();else if(game.phase==='roundover'){game.nextRound();$('overlay').hidden=true;handleEvents();canvas.focus();}else if(game.phase==='matchover')begin();});
  $('back-menu').addEventListener('click',menu);
  $('sound').addEventListener('click',()=>{sound.enabled=!sound.enabled;if(sound.enabled){sound.unlock();sound.tone(660,.1,'sine',.06);} $('sound').innerHTML=`♪ <span>SOUND ${sound.enabled?'ON':'OFF'}</span>`;$('sound').setAttribute('aria-label',sound.enabled?'Disable sound':'Enable sound');});
  function motionButton(){$('motion').setAttribute('aria-pressed',String(reduced));$('motion').textContent=reduced?'REDUCED EFFECTS: ON':'REDUCE FLASH & SHAKE';}motionButton();
  $('motion').addEventListener('click',()=>{reduced=!reduced;motionButton();});
  function closeHelp(){$('instructions').close();if(helpPaused&&game.phase==='paused')pause();helpPaused=false;}
  $('help').addEventListener('click',()=>{helpPaused=game.phase==='fight';if(helpPaused){game.togglePause();clearInput();}$('instructions').showModal();});
  $('close-help').addEventListener('click',closeHelp);$('got-it').addEventListener('click',closeHelp);
  $('instructions').addEventListener('cancel',e=>{e.preventDefault();closeHelp();});
  for(const name of ['akane','nekomaru'])$(name+'-skins').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    if(game.phase!=='ready')return;$(name+'-skins').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    if(name==='akane')akaneSkin=b.dataset.skin;else enemySkin=b.dataset.skin;
    $('enemy-name').textContent=enemySkin==='mecha'?'MECHAMARU':'NEKOMARU NIDAI';sound.tone(420,.08,'triangle',.04);
  }));
  document.addEventListener('keydown',e=>{
    if($('instructions').open)return;
    const target=e.target;if(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)return;
    const code=keyCode(e);
    if(target.dataset?.input&&(code==='Enter'||code==='Space'))return;
    if(code==='Escape'||code==='KeyP'){if(!e.repeat)pause();e.preventDefault();return;}
    if(code==='Enter'&&game.phase==='ready'&&target===canvas){begin();return;}
    const a=inputMap[code];if(a&&game.phase==='fight'){e.preventDefault();if(!e.repeat)press('key:'+code,a);}
  });
  document.addEventListener('keyup',e=>{const code=keyCode(e),a=inputMap[code];if(a){release('key:'+code);if(game.phase==='fight')e.preventDefault();}});
  document.querySelectorAll('[data-input]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{
      if(game.phase!=='fight'||countdown>0||$('instructions').open)return;
      e.preventDefault();b.setPointerCapture(e.pointerId);press('pointer:'+e.pointerId,b.dataset.input);
    });
    const releasePointer=e=>release('pointer:'+e.pointerId);
    b.addEventListener('pointerup',releasePointer);b.addEventListener('pointercancel',releasePointer);b.addEventListener('lostpointercapture',releasePointer);
    b.addEventListener('keydown',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();if(!e.repeat)press('button:'+b.dataset.input+':'+e.code,b.dataset.input);}});
    b.addEventListener('keyup',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();release('button:'+b.dataset.input+':'+e.code);}});
    b.addEventListener('blur',()=>{release('button:'+b.dataset.input+':Enter');release('button:'+b.dataset.input+':Space');});
  });
  window.addEventListener('blur',()=>{clearInput();if(game.phase==='fight'){game.togglePause();showPause();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(game.phase==='fight'){game.togglePause();showPause();}}});
  function burst(x,y,color,n=15,power=1){for(let i=0;i<n;i++){const angle=Math.random()*Math.PI*2,s=(90+Math.random()*230)*power;particles.push({x,y,vx:Math.cos(angle)*s,vy:Math.sin(angle)*s,life:.25+Math.random()*.35,max:.6,color,size:2+Math.random()*6});}}
  function floatText(text,x,y,color='#fff',size=25){texts.push({text,x,y,color,size,life:.9});}
  function handleEvents(){
    for(const e of game.drainEvents()){
      if(e.type==='roundstart'){clearInput();countdown=2.1;pendingResult=false;banner(`ROUND ${game.round}`,1.2);sound.event('modifier');}
      if(e.type==='attack'){sound.event('attack');}
      if(e.type==='hit'){
        const f=game[e.target]||game.enemy;burst(f.x,GROUND-f.y-125,e.blocked?'#9bebff':e.heavy?'#fff19a':'#ffd6ba',e.heavy?24:14,e.heavy?1.4:1);
        shake=Math.max(shake,e.heavy?10:5);if(!e.blocked)flash=e.heavy?.10:.045;sound.event('hit');
        if(e.damage)floatText('-'+Math.round(e.damage),f.x,GROUND-f.y-240,e.target==='enemy'?'#fff28c':'#ffb0c8',e.heavy?31:25);
        if(e.source==='player'&&game.player.combo>=2&&!e.blocked)floatText(game.player.combo+' HIT COMBO!',f.x-30,GROUND-f.y-290,'#ff8fbb',23);
      }
      if(e.type==='block'){const f=game[e.target];if(f){burst(f.x,GROUND-f.y-140,'#a3f0ff',e.perfect?25:9);floatText(e.perfect?'PERFECT GUARD!':'BLOCK',f.x,GROUND-f.y-270,'#b4f6ff',e.perfect?25:19);}sound.event(e.perfect?'perfect':'block');}
      if(e.type==='jump'){sound.event('jump');burst(e.x,GROUND-6,'#f1d4a3',5,.35);}
      if(e.type==='special'){const f=game[e.source];if(f){burst(f.x,GROUND-f.y-100,colors[e.source],30,1.6);floatText(e.source==='player'?'HUNGRY RUSH!':'ULTIMATE SLAM!',f.x,GROUND-f.y-280,colors[e.source],28);}shake=12;sound.event('special');}
      if(e.type==='modifier'){banner(e.name,1.55);sound.event('modifier');}
      if(e.type==='hazard-impact'){burst(e.x,GROUND-10,'#efb76d',20,1.2);shake=5;sound.event('hit');}
      if(e.type==='heal'){burst(e.x,GROUND-60,'#bdfbaa',18);floatText('+ HEALTH',e.x,GROUND-200,'#bdfbaa',25);sound.event('heal');}
      if(e.type==='roundover'||e.type==='matchover'){if(!pendingResult){banner(game.roundResult?.reason==='time'?'TIME!':'K.O.',1.1);resultDelay=1.5;pendingResult=true;sound.event('roundover');}}
    }
  }
  function drawScene(){
    const bg=images.island;
    if(bg){ctx.drawImage(bg,0,0,W,H);}else{const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#d99191');g.addColorStop(.45,'#ecc8a2');g.addColorStop(.46,'#3caaa8');g.addColorStop(.77,'#7ad3bf');g.addColorStop(.78,'#dabc99');g.addColorStop(1,'#b88d72');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    const grad=ctx.createLinearGradient(0,0,0,240);grad.addColorStop(0,'#101522bd');grad.addColorStop(1,'#10152200');ctx.fillStyle=grad;ctx.fillRect(0,0,W,240);
    const bottom=ctx.createLinearGradient(0,570,0,H);bottom.addColorStop(0,'#211b2300');bottom.addColorStop(1,'#211b23bb');ctx.fillStyle=bottom;ctx.fillRect(0,570,W,H-570);
    // Gentle sea shimmer and airborne motes anchor the still artwork in the arena.
    if(!reduced){for(let i=0;i<14;i++){const x=(i*97+clock*7)%1200,y=350+Math.sin(i*5+clock)*12;ctx.fillStyle=`rgba(255,242,206,${.1+.07*Math.sin(clock+i)})`;ctx.fillRect(x,y,13+Math.sin(i)*8,1);}}
    if(game.modifier.id==='moonjump'){ctx.fillStyle='#9e7aff18';ctx.fillRect(0,0,W,H);for(let i=0;i<12;i++)ellipse((i*123+clock*15)%W,210+Math.sin(clock+i)*40,2,2,'#e2d9ff');}
    if(game.modifier.id==='turbo'&&!reduced){ctx.strokeStyle='#f5ff9826';ctx.lineWidth=2;for(let i=0;i<14;i++){const y=280+i*21,x=((clock*440+i*169)%1500)-300;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+160,y);ctx.stroke();}}
    // Arena boundary marks on the sand.
    ctx.strokeStyle='#fff5';ctx.lineWidth=2;ctx.setLineDash([15,14]);ctx.beginPath();ctx.ellipse(600,GROUND+11,510,37,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  }
  function spriteInfo(key,index){
    const data=window.SPRITE_DATA[key];const img=images[key];if(!img)return null;
    if(data&&data.frames){const f=data.frames[index]||data.frames[0];return {img,rect:f.rect,polygon:f.polygon,anchorX:f.anchorX??f.rect[0]+f.rect[2]/2,anchorY:f.anchorY??f.rect[1]+f.rect[3],baseHeight:data.referenceHeight||data.frames[0].rect[3]};}
    const cw=img.width/4;return {img,rect:[index*cw,0,cw,img.height],anchorX:(index+.5)*cw,anchorY:img.height*.96,baseHeight:img.height*.92};
  }
  function drawFighter(f){
    const player=f.id==='player', key=player?'akane-'+akaneSkin:'nekomaru-'+enemySkin;
    const count=window.SPRITE_DATA[key]?.frames?.length||4;
    let frame=0;
    if(count>=12){
      frame=Math.floor(clock*2)%2;
      if(f.action==='walk')frame=2+Math.floor(clock*9)%2;
      if(f.y>15)frame=f.vy>0?4:5;
      if(f.action==='attack')frame=f.combo===3||f.attackType==='heavy'?8:f.combo===2?7:6;
      if(f.action==='special')frame=f.actionTime<.15?7:8;
      if(f.action==='block'||f.action==='windup')frame=9;
      if(f.action==='hurt')frame=10;
      if(f.action==='ko')frame=11;
    }else{
      if(f.action==='block'||f.action==='windup'||f.action==='hurt')frame=3;
      if(f.action==='attack')frame=f.combo===3||f.attackType==='heavy'?2:1;
      if(f.action==='special')frame=2;if(f.y>30&&f.action==='jump')frame=2;
    }
    const info=spriteInfo(key,frame);if(!info)return;
    const floor=GROUND-f.y, s=(player?255:285)/info.baseHeight, bounce=reduced?0:Math.sin(clock*(f.action==='walk'?17:4)+(player?0:1))*(f.action==='walk'?4:1.5);
    ellipse(f.x,GROUND+3,player?55:66,11,'#28233142');
    if(f.meter>=100){ctx.strokeStyle=colors[f.id];ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(f.x,GROUND+3,65+Math.sin(clock*5)*3,14,0,0,Math.PI*2);ctx.stroke();}
    ctx.save();ctx.translate(f.x,floor+bounce);ctx.scale(f.face,1);
    if(f.action==='ko'){if(count<12){ctx.translate(0,-25);ctx.rotate(-1.25);}ctx.globalAlpha=.85;}
    else if(f.action==='hurt'){ctx.rotate(-.1);}
    else if(f.action==='walk'){ctx.rotate(Math.sin(clock*17)*.017);}
    else if(f.action==='windup'){ctx.rotate(-.06);}
    if(f.armored){ctx.shadowColor='#faff85';ctx.shadowBlur=reduced?5:20+Math.sin(clock*18)*8;}
    else if(f.action==='special'){ctx.shadowColor=colors[f.id];ctx.shadowBlur=22;}
    else{ctx.shadowColor='#25203755';ctx.shadowBlur=3;ctx.shadowOffsetY=2;}
    const [sx,sy,sw,sh]=info.rect,dx=(sx-info.anchorX)*s,dy=(sy-info.anchorY)*s;
    if(info.polygon){ctx.beginPath();info.polygon.forEach((p,i)=>{const px=(p[0]-info.anchorX)*s,py=(p[1]-info.anchorY)*s;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();ctx.clip();}
    ctx.drawImage(info.img,sx,sy,sw,sh,dx,dy,sw*s,sh*s);ctx.restore();
    if(f.action==='attack'||f.action==='special'){
      ctx.save();ctx.translate(f.x+f.face*55,floor-130);ctx.scale(f.face,1);ctx.strokeStyle=f.action==='special'?'#eaff9dcc':'#fff6';ctx.lineWidth=f.action==='special'?11:4;ctx.beginPath();ctx.arc(0,0,95,-.75,.45);ctx.stroke();ctx.restore();
    }
    if(f.action==='block'){ctx.save();ctx.translate(f.x+f.face*65,floor-120);ctx.strokeStyle='#b8efffb0';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,25,65,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
    if(!player&&f.telegraph&&game.phase==='fight'){label(f.attackType==='special'?'BIG SLAM!':'BLOCK OR JUMP!',f.x,floor-313,18,'#efff70');}
    if(game.phase==='ready'){
      label(player?'AKANE':enemySkin==='mecha'?'MECHAMARU':'NEKOMARU',f.x,GROUND+38,25,'#fff');
    }
  }
  function drawHazards(){
    for(const h of game.hazards){
      if(h.kind==='coconut'){
        if(h.warning){const pulse=.55+Math.sin(clock*16)*.15;ellipse(h.x,GROUND+3,h.radius,12,`rgba(255,65,92,${pulse})`);label('!',h.x,GROUND-18,31,'#fff18c');ctx.strokeStyle='#ffeff9';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(h.x,GROUND+3,h.radius,12,0,0,Math.PI*2);ctx.stroke();}
        else{ellipse(h.x,GROUND+3,30,7,'#21162c33');ctx.save();ctx.translate(h.x,GROUND-h.y);ctx.rotate(clock*6);ellipse(0,0,18,22,'#684633');ctx.strokeStyle='#c48b59';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-7,-17);ctx.lineTo(-5,17);ctx.stroke();ellipse(4,-5,3,3,'#2b201e');ctx.restore();}
      }else if(h.kind==='food'){
        const y=GROUND-28-Math.sin(clock*5+h.id)*5;ellipse(h.x,GROUND+2,23,6,'#173d2422');ctx.save();ctx.translate(h.x,y);ctx.shadowColor='#d9ff93';ctx.shadowBlur=15;ctx.fillStyle='#fff6db';ctx.strokeStyle='#393335';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-20);ctx.quadraticCurveTo(5,-22,21,12);ctx.quadraticCurveTo(23,20,0,20);ctx.quadraticCurveTo(-23,20,-21,12);ctx.quadraticCurveTo(-5,-22,0,-20);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#244b37';ctx.fillRect(-7,5,14,16);ctx.restore();
      }
    }
  }
  function render(dt){
    drawMonokuma();
    ctx.save();if(!reduced&&shake>0)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
    drawScene();drawHazards();drawFighter(game.enemy);drawFighter(game.player);
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=500*dt;ctx.globalAlpha=Math.min(1,p.life*3);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size/2);}ctx.globalAlpha=1;
    for(let i=texts.length-1;i>=0;i--){const t=texts[i];t.life-=dt;if(t.life<=0){texts.splice(i,1);continue;}t.y-=38*dt;ctx.globalAlpha=Math.min(1,t.life*3);label(t.text,t.x,t.y,t.size,t.color);}ctx.globalAlpha=1;
    if(!reduced&&flash>0){ctx.fillStyle=`rgba(255,225,215,${flash*1.4})`;ctx.fillRect(0,0,W,H);}ctx.restore();
    shake=Math.max(0,shake-dt*38);flash=Math.max(0,flash-dt);
  }
  function hud(){
    $('p-health').style.width=Math.max(0,game.player.hp)+'%';$('e-health').style.width=Math.max(0,game.enemy.hp)+'%';
    $('p-meter').style.width=game.player.meter+'%';$('e-meter').style.width=game.enemy.meter+'%';
    $('p-power').textContent=game.player.meter>=100?'L · SPECIAL!':'SPECIAL '+Math.floor(game.player.meter)+'%';
    $('e-power').textContent=game.enemy.meter>=100?'SPECIAL!':'SPECIAL '+Math.floor(game.enemy.meter)+'%';
    $('p-power').style.color=game.player.meter>=100?'#ff8ac2':'';
    $('timer').textContent=String(Math.ceil(game.timer)).padStart(2,'0');$('timer').style.color=game.timer<=10?'#ff8dab':'';
    $('round').textContent='ROUND '+String(game.round).padStart(2,'0');
    $('p-wins').textContent=[0,1].map(i=>game.wins[0]>i?'●':'○').join(' ');$('e-wins').textContent=[0,1].map(i=>game.wins[1]>i?'●':'○').join(' ');
    const mod=game.modifier;
    const modCopy={none:'UPUPUPU…',moonjump:'LOW GRAVITY!',coconuts:'DODGE THE RED MARKS!',turbo:'DOUBLE TIME!',feast:'SNACKS = HEALTH!'};
    $('host-message').textContent=modCopy[mod.id]||mod.name;$('modifier-time').textContent=mod.id==='none'?'':Math.ceil(mod.remaining)+'s';
    $('host').style.borderColor=mod.id==='none'?'#ffffff':'#ff238c';
    $('arena-tip').textContent=game.player.meter>=100?'L · SPECIAL READY':'';
    canvas.setAttribute('aria-label',`Jabberwock Island arena. ${game.phase}. Round ${game.round}. Akane health ${Math.ceil(game.player.hp)}, Nekomaru health ${Math.ceil(game.enemy.hp)}. ${mod.id==='none'?'':mod.name}`);
  }
  function drawMonokuma(){
    const c=$('bear').getContext('2d');c.clearRect(0,0,100,100);
    c.fillStyle='#ecebe8';c.beginPath();c.arc(22,22,15,0,Math.PI*2);c.fill();c.fillStyle='#060609';c.beginPath();c.arc(78,22,15,0,Math.PI*2);c.fill();
    c.fillStyle='#f5f4ec';c.beginPath();c.arc(50,50,35,0,Math.PI*2);c.fill();c.save();c.beginPath();c.rect(50,0,50,100);c.clip();c.fillStyle='#090a0c';c.beginPath();c.arc(50,50,35,0,Math.PI*2);c.fill();c.restore();
    c.fillStyle='#19191d';c.beginPath();c.arc(35,44,5,0,Math.PI*2);c.fill();c.fillStyle='#ff4169';c.beginPath();c.moveTo(58,42);c.lineTo(76,33);c.lineTo(73,47);c.lineTo(62,48);c.lineTo(60,56);c.closePath();c.fill();
    c.fillStyle='#111117';c.beginPath();c.ellipse(46,58,7,5,0,0,Math.PI*2);c.fill();c.strokeStyle='#111117';c.lineWidth=3;c.beginPath();c.arc(43,61,12,0,Math.PI*.9);c.stroke();
    c.fillStyle='#fff9ec';c.beginPath();c.moveTo(54,62);c.lineTo(80,53);c.quadraticCurveTo(76,77,54,76);c.closePath();c.fill();c.strokeStyle='#16141a';c.lineWidth=1.5;for(let i=59;i<79;i+=5){c.beginPath();c.moveTo(i,58);c.lineTo(i-2,77);c.stroke();}
  }
  drawMonokuma();
  Promise.all(assets.map(key=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images[key]=img;resolve();};img.onerror=()=>reject(new Error('Could not load '+key));img.src=window.SPRITE_DATA[key]?.src||'assets/'+key+'.png';}))).then(()=>{
    ready=true;$('start').disabled=false;$('start-label').textContent='FIGHT!';
  }).catch(error=>{$('start-label').textContent='ARTWORK COULD NOT LOAD';$('host-message').textContent='Keep the assets folder beside index.html, then reload.';console.error(error);});
  function frame(ms){
    const dt=last?Math.min((ms-last)/1000,.05):1/60;last=ms;clock+=dt;
    if(game.phase==='fight'){
      if(countdown>0){const before=countdown;countdown-=dt;if(before>1&&countdown<=1)banner('FIGHT!',.9);}else game.step(dt,input(dt));
    }
    handleEvents();
    if(pendingResult&&(game.phase==='roundover'||game.phase==='matchover')){resultDelay-=dt;if(resultDelay<=0){pendingResult=false;showResult();}}
    if(game.phase!==previousPhase){previousPhase=game.phase;if(game.phase==='paused'&&!$('instructions').open)showPause();}
    if(game.phase!=='paused'){bannerTime=Math.max(0,bannerTime-dt);}
    $('announcement').hidden=bannerTime<=0||game.phase==='paused'||$('instructions').open;
    const visualDt=game.phase==='paused'?0:dt;render(visualDt);hud();sound.tick();requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
