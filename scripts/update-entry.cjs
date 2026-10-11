'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function mode(root){return !fs.existsSync(path.join(root,'skill-package.json'))&&(fs.existsSync(path.join(root,'.git'))||fs.existsSync(path.join(root,'.runtime.json')))?'legacy-git':'formal-release';}
function run(root=path.resolve(__dirname,'..'),args=process.argv.slice(2)){
 if(mode(root)==='legacy-git'){cp.execFileSync(process.execPath,[path.join(root,'scripts/self-update.cjs'),...args],{windowsHide:true,stdio:'inherit'});return;}
 return require(path.join(root,'.laoyu/update.cjs')).runUpdate(root,{force:args.includes('--force')});
}
module.exports={mode,run};if(require.main===module)Promise.resolve().then(()=>run()).then(r=>{if(r?.status==='updated')console.log('UPDATED '+r.version)}).catch(e=>{if(process.argv.includes('--verbose'))console.error(e.message);});
