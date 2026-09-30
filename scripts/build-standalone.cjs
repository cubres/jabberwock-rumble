const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const env = { window: {} };
vm.createContext(env);
for (const file of ['sprite-data.js', 'assets/akane-data.js', 'assets/nekomaru-data.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),env);
const all=env.window.SPRITE_DATA, metadata={};
const dataUrl=(file,mime)=>'data:'+mime+';base64,'+fs.readFileSync(path.join(root,file)).toString('base64');
for (const key of ['akane-classic','akane-island','akane-midnight','nekomaru-classic','nekomaru-mecha']) {
  if(all[key].frames.length !== 12) throw new Error(key+' must have 12 poses');
  metadata[key]={...all[key],src:dataUrl(all[key].src,'image/png')};
}
metadata.island={src:dataUrl('assets/island.png','image/png')};
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let css=fs.readFileSync(path.join(root,'style.css'),'utf8').replace("url('assets/Anton-Regular.ttf')",`url('${dataUrl('assets/Anton-Regular.ttf','font/ttf')}')`);
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>');
const js=fs.readFileSync(path.join(root,'engine.js'),'utf8')+'\nwindow.SPRITE_DATA='+JSON.stringify(metadata)+';\n'+fs.readFileSync(path.join(root,'game.js'),'utf8');
html=html.replace(/<script src="engine\.js"><\/script>[\s\S]*?<script src="game\.js"><\/script>/,'<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>');
const license = fs.readFileSync(path.join(root, 'assets/Anton-OFL.txt'), 'utf8');
html = html.replace('<head>', '<head>\n<!-- Bundled Anton font license:\n' + license + '\n-->');
const out=path.join(root, 'dist', 'Jabberwock Rumble.html');
fs.mkdirSync(path.dirname(out), {recursive:true});
fs.writeFileSync(out,html);
console.log(JSON.stringify({file:out,bytes:fs.statSync(out).size,skins:5,poses:60}));
