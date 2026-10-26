'use strict';
// 离线兼容性检查：只读发行文件，不启动迅雷、不加载原生模块、不读取账号资料。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2]||'C:\\Program Files\\Thunder Network\\Thunder';
const app=path.join(root,'program','resources','app');
try{
 const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
 const required=['getCurrPlayMedia','pauseMedia','playMedia','getPlayProgress','progressMoveTo','getMediaState','attachPlayBufferEvent'];
 const addon=fs.readFileSync(path.join(root,'program','pc_addon.node'));
 const markers=Object.fromEntries(required.map(s=>[s,addon.includes(Buffer.from(s+'\0'))]));
 console.log(JSON.stringify({version:pkg.version,versionSupported:pkg.version==='25.1.40.1703',markers,addonSha256:crypto.createHash('sha256').update(addon).digest('hex'),note:'字符串和版本检查只证明静态线索，不证明运行时可用'},null,2));
 if(pkg.version!=='25.1.40.1703'||Object.values(markers).some(v=>!v))process.exitCode=2;
}catch{console.error('无法读取迅雷发行文件，请检查安装目录');process.exitCode=1;}
