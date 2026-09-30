const fs=require('node:fs'); const vm=require('node:vm');const assert=require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const Engine=require('../engine.js');
const noop=()=>{};
const ctx=new Proxy({createLinearGradient:()=>({addColorStop:noop})},{get:(o,k)=>o[k]||noop,set:(o,k,v)=>{o[k]=v;return true;}});
class El {
 constructor(id=''){this.id=id;this.listeners={};this.style={};this.dataset={};this.children=[];this.hidden=false;this.open=false;this.value=id==='difficulty'?'normal':'';this.classList={add:noop,remove:noop};}
 addEventListener(t,f){(this.listeners[t]??=[]).push(f)}
 dispatch(t,e={}){e={target:this,preventDefault:noop,repeat:false,...e};for(const f of this.listeners[t]||[])f(e)}
 querySelectorAll(){return this.children}setAttribute(k,v){this[k]=v}getContext(){return ctx}focus(){document.activeElement=this}setPointerCapture(){}showModal(){this.open=true}close(){this.open=false}
}
const elements=Object.fromEntries([...fs.readFileSync(path.join(root, 'index.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new El(m[1])]));
for(const name of ['akane','nekomaru'])elements[name+'-skins'].children=(name==='akane'?['classic','island','midnight']:['classic','mecha']).map(s=>{const e=new El();e.dataset.skin=s;return e;});
const touch=['left','right','jump','block','attack','special'].map(input=>{const e=new El();e.dataset.input=input;return e;});
const document=new El('document');document.getElementById=id=>{assert(elements[id],'missing '+id);return elements[id]};document.querySelectorAll=s=>s.includes('touch-controls')||s==='[data-input]'?touch:[];
const window=new El('window');window.SPRITE_DATA={};let raf=null,now=0,observed=[];
const sandbox={console,document,window,HTMLInputElement:class{},HTMLSelectElement:class{},matchMedia:()=>({matches:false}),requestAnimationFrame:f=>raf=f,Image:class{constructor(){this.width=1200;this.height=675}set src(v){this.url=v;queueMicrotask(()=>this.onload())}},RumbleEngine:{...Engine,Game:class extends Engine.Game{constructor(...a){super(...a);sandbox.current=this}_emit(type,data){super._emit(type,data);observed.push({type,...data})}}}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root, 'game.js'),'utf8'),sandbox);
function advance(s){for(let i=0;i<Math.ceil(s*120);i++){now+=1000/120;const f=raf;raf=null;f(now);}}
function key(code,down=true){document.dispatch(down?'keydown':'keyup',{code,target:elements.game})}
function isolated(){sandbox.current.enemy.x=1110;sandbox.current.enemy.aiWait=999; sandbox.current.player.x=350; observed=[];}
(async()=>{
 await new Promise(r=>setImmediate(r));assert.equal(elements.start.disabled,false);elements.start.dispatch('click');assert.equal(sandbox.current.phase,'fight');advance(2.3);isolated();
 elements.help.dispatch('click');assert.equal(elements.instructions.open,true);assert.equal(sandbox.current.phase,'paused');elements['got-it'].dispatch('click');assert.equal(sandbox.current.phase,'fight');console.log('PASS start/help semantic click listeners');
 key('KeyD');advance(.2);key('KeyD',false);assert(sandbox.current.player.x>400);advance(.1);let x=sandbox.current.player.x;advance(.1);assert.equal(sandbox.current.player.x,x);console.log('PASS keyboard hold and release movement');
 isolated();key('KeyD');key('KeyD',false);advance(.12);assert(sandbox.current.player.x>350);x=sandbox.current.player.x;advance(.1);assert.equal(sandbox.current.player.x,x);console.log('PASS quick movement taps survive a frame boundary');
 touch.find(b=>b.dataset.input==='jump').dispatch('pointerdown',{pointerId:1});advance(.02);touch.find(b=>b.dataset.input==='jump').dispatch('pointerup',{pointerId:1});assert(sandbox.current.player.y>0);advance(1);console.log('PASS touch jump pointer input');
 isolated();key('KeyJ');advance(.02);key('KeyJ',false);advance(.025);key('KeyJ');advance(.02);key('KeyJ',false);advance(.65);assert.equal(observed.filter(e=>e.type==='attack'&&e.source==='player').length,2);console.log('PASS rapid taps 45ms apart retain two attack edges');
 isolated();elements.pause.dispatch('click');advance(.1);key('KeyJ');key('KeyJ',false);elements.continue.dispatch('click');advance(.02);assert.notEqual(sandbox.current.player.action,'attack');console.log('PASS paused inputs do not leak into resume');advance(.8);
 isolated();key('KeyD');key('ArrowRight');advance(.15);key('KeyD',false);advance(.15);x=sandbox.current.player.x;advance(.15);assert(sandbox.current.player.x>x);console.log('PASS physical key aliases release independently');key('ArrowRight',false);
 isolated();const right=touch.find(b=>b.dataset.input==='right');right.dispatch('pointerdown',{pointerId:7});key('KeyD');advance(.1);key('KeyD',false);x=sandbox.current.player.x;advance(.1);assert(sandbox.current.player.x>x);right.dispatch('pointerup',{pointerId:7});advance(.02);x=sandbox.current.player.x;advance(.1);assert.equal(sandbox.current.player.x,x);console.log('PASS keyboard and pointer release independently');
 isolated();right.dispatch('pointerdown',{pointerId:7});right.dispatch('pointerdown',{pointerId:8});right.dispatch('pointerup',{pointerId:7});x=sandbox.current.player.x;advance(.1);assert(sandbox.current.player.x>x);right.dispatch('pointercancel',{pointerId:8});advance(.02);x=sandbox.current.player.x;advance(.1);assert.equal(sandbox.current.player.x,x);console.log('PASS multiple pointers and cancellation');
 isolated();const guard=touch.find(b=>b.dataset.input==='block');guard.dispatch('keydown',{code:'Enter'});advance(.02);assert.equal(sandbox.current.player.action,'block');guard.dispatch('keyup',{code:'Enter'});advance(.02);assert.equal(sandbox.current.player.action,'idle');console.log('PASS focused touch button keyboard guard');
 const ultimate=touch.find(b=>b.dataset.input==='special');sandbox.current.player.meter=100;ultimate.dispatch('keydown',{code:'Enter'});advance(.02);ultimate.dispatch('keyup',{code:'Enter'});assert.equal(sandbox.current.player.action,'special');assert.equal(sandbox.current.player.meter,0);console.log('PASS focused touch button keyboard special');advance(.8);
 isolated();window.dispatch('blur');assert.equal(sandbox.current.phase,'paused');elements.continue.dispatch('click');advance(.1);assert.equal(sandbox.current.phase,'fight');console.log('PASS blur and resume');
 isolated();sandbox.current.enemy.hp=0;advance(.01);advance(1.6);assert.equal(elements.overlay.hidden,false);elements.continue.dispatch('click');assert.equal(sandbox.current.round,2);assert.equal(sandbox.current.phase,'fight');console.log('PASS round result and next round');observed=[];key('KeyJ');key('KeyJ',false);touch.find(b=>b.dataset.input==='attack').dispatch('pointerdown',{pointerId:9});touch.find(b=>b.dataset.input==='attack').dispatch('pointerup',{pointerId:9});advance(2.4);assert.equal(observed.filter(e=>e.type==='attack'&&e.source==='player').length,0);console.log('PASS countdown rejects keyboard and touch action queues');
})().catch(e=>{console.error(e);process.exitCode=1});
