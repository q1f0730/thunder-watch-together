'use strict';
// 本文件由迅雷现有的插件加载器在主渲染进程中加载；不启动或替换播放器。
if(typeof document!=='undefined'&&!global.__ThunderWatchTogether){
 const fs=require('node:fs'),path=require('node:path');
 const {ThunderAdapter}=require('./lib/native-adapter.cjs');
 const {SyncClient,makeInvite,decodeInvite}=require('./lib/client.cjs');
 const adapter=new ThunderAdapter(),client=new SyncClient(adapter);
 const install=()=>{
  const root=document.createElement('div');root.id='thunder-watch-together';root.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483000;';
  const shadow=root.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>:host{font:13px/1.5 "Microsoft YaHei",sans-serif;color:#f4f5fa}*{box-sizing:border-box}button,input,textarea{font:inherit}button{border:1px solid #454b65;border-radius:7px;background:#242c44;color:#fff;padding:7px 12px;cursor:pointer}button:hover{background:#343f61}#toggle{float:right}section{width:350px;background:#171b28;border:1px solid #464d66;border-radius:12px;padding:18px;margin-bottom:9px;box-shadow:0 10px 40px #0006}h3{margin:0 0 10px}label{display:block;margin-top:12px;color:#b8bed3}input,textarea{display:block;width:100%;margin:5px 0 10px;background:#0f1320;color:#fff;border:1px solid #444b63;border-radius:6px;padding:8px}textarea{height:76px;resize:vertical;word-break:break-all}small{display:block;color:#a7afc7}#status{margin-top:12px;color:#9adfc5;overflow-wrap:anywhere}#members{color:#a7afc7;margin-top:4px}.row{display:flex;gap:6px;flex-wrap:wrap}section[hidden]{display:none}</style>
  <section hidden><h3>迅雷一起看 · 实验版</h3><small>两端各自在线播放相同云盘视频。只同步播放状态，不传输视频。</small><label>中继地址<input id="relay" value="ws://127.0.0.1:8765/ws" spellcheck="false"></label><small>异地观看需先部署中继，并填写 wss:// 地址。</small><label>房间邀请码<textarea id="invite" placeholder="创建房间，或粘贴对方的邀请码" spellcheck="false"></textarea></label><div class="row"><button id="create">创建房间</button><button id="join">加入房间</button><button id="copy">复制邀请码</button><button id="leave">退出</button></div><div id="status">尚未连接</div><div id="members"></div><small>双方均可控制；任一方缓冲或视频不同会暂停同步。邀请码请只交给观看伙伴。</small></section><button id="toggle">一起看</button>`;
  const el=id=>shadow.getElementById(id),section=shadow.querySelector('section');
  let supported=false;
  try{supported=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../..','package.json'),'utf8')).version==='25.1.40.1703';}catch{}
  const status=text=>{el('status').textContent=text;};
  if(!supported)status('当前迅雷版本未适配，已禁用连接；支持版本：25.1.40.1703');
  client.on('status',status);client.on('room',s=>{el('members').textContent=`房间人数 ${s.members}/2 · 第 ${s.revision} 次状态更新`;});
  function join(){if(!supported)throw Error('当前迅雷版本未适配');client.disconnect();client.connect(el('invite').value.trim());status('正在连接中继…');}
  const act=fn=>()=>{try{fn();}catch(error){status(error.message||'操作失败');}};
  el('toggle').onclick=()=>{section.hidden=!section.hidden;};
  el('create').onclick=act(()=>{el('invite').value=makeInvite(el('relay').value.trim());join();});
  el('join').onclick=act(()=>{const v=decodeInvite(el('invite').value.trim());el('relay').value=v.relay;join();});
  el('copy').onclick=()=>{const text=el('invite').value.trim();if(!text){status('请先创建或填写邀请码');return;}try{require('electron').clipboard.writeText(text);status('邀请码已复制');}catch{el('invite').focus();el('invite').select();status('请按 Ctrl+C 复制邀请码');}};
  el('leave').onclick=()=>{client.disconnect();el('members').textContent='';status('已退出，停止同步');};
  document.body.appendChild(root);global.__ThunderWatchTogether={client,adapter,close(){client.disconnect();root.remove();delete global.__ThunderWatchTogether;}};
  window.addEventListener('beforeunload',()=>client.disconnect(),{once:true});
 };
 if(document.body)install();else document.addEventListener('DOMContentLoaded',install,{once:true});
}
