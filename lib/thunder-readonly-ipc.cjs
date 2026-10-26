'use strict';
const fs=require('node:fs'),net=require('node:net');
const {randomBytes}=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const READ_METHODS=new Set(['AplayerStackGetCurrPlayMedia','AplayerStackGetAplayerVersion','AplayerStackGetCurrentPlaySpeedId','AplayerMediaGetMediaState','AplayerMediaGetPlayProgress','AplayerMediaGetDuration']);
const CHECK_METHODS=new Set([...READ_METHODS,'AplayerStackPlayMedia','AplayerStackPauseMedia','AplayerMediaProgressMoveTo']);
function findPipe(){
 if(process.platform!=='win32')throw Error('真实迅雷接入验证只支持 Windows');
 const matches=fs.readdirSync('\\\\.\\pipe\\').filter(p=>/Thunder-xunlei-node-net-ipc-\{FD196984-2591-4588-AA6F-5C8AC1266290\}\.sock$/i.test(p));
 if(matches.length!==1)throw Error(matches.length?'发现多个迅雷通信端点，请先检查运行实例':'未发现迅雷通信端点，请自行启动迅雷');
 return '\\\\.\\pipe\\'+matches[0];
}
class ThunderReadonlyIpc{
 constructor({connect=net.connect,timeoutMs=4000}={}){this.connectSocket=connect;this.timeoutMs=timeoutMs;this.pending=new Map();this.nextId=0;this.socket=null;this.buffer='';this.decoder=new StringDecoder('utf8');this.name='watch-together-readonly-'+randomBytes(6).toString('hex');this.alias='thunder-'+this.name;}
 async connect(socketPath){
  if(this.socket)throw Error('验证连接已经打开');
  this.buffer='';this.decoder=new StringDecoder('utf8');
  const socket=this.socket=this.connectSocket(socketPath||findPipe());
  socket.on('data',chunk=>this.receive(chunk));socket.on('error',()=>this.failPending('无法连接迅雷进程通信端点'));socket.on('close',()=>{this.failPending('迅雷进程通信连接已关闭');if(this.socket===socket)this.socket=null;});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.destroy();reject(Error('连接迅雷超时'));},this.timeoutMs);socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('error',()=>{clearTimeout(timer);reject(Error('无法连接迅雷进程通信端点'));});});
  const registration=await this.request({alias:this.alias,action:'register'});
  if(!registration.success)throw Error('迅雷拒绝验证连接注册');
 }
 request(message){
  if(!['register','check_client_exist','check_client_function_exist','call_remote_client_api'].includes(message.action))return Promise.reject(Error('不允许的验证操作'));
  if(message.action==='call_remote_client_api'&&!READ_METHODS.has(message.method))return Promise.reject(Error('只读验证器禁止写操作'));
  if(message.action==='check_client_function_exist'&&!CHECK_METHODS.has(message.method))return Promise.reject(Error('不在只读验证范围内'));
  if(!this.socket||this.socket.destroyed)return Promise.reject(Error('验证连接尚未就绪'));
  if(this.pending.size>=32)return Promise.reject(Error('验证请求过多'));
  return new Promise((resolve,reject)=>{const rid=++this.nextId;const timer=setTimeout(()=>{this.pending.delete(rid);reject(Error('读取迅雷状态超时'));},this.timeoutMs);this.pending.set(rid,{resolve,reject,timer});const context={name:this.name,productId:'Thunder',version:'0.1.0',ext:{is_new_path:false}};this.socket.write(JSON.stringify({...message,rid,__context:context,timestamp:[Date.now()]})+'\n');});
 }
 receive(chunk){this.buffer+=this.decoder.write(chunk);if(this.buffer.length>1024*1024){this.failPending('迅雷响应超出验证器限制');this.socket?.destroy();return;}let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);let response;try{response=JSON.parse(line);}catch{this.failPending('迅雷返回无法解析的响应');this.socket?.destroy();return;}const p=this.pending.get(response.rid);if(p){this.pending.delete(response.rid);clearTimeout(p.timer);p.resolve(response);}}}
 failPending(message){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();}
 async playerExists(){const r=await this.request({dst:'thunder-player',action:'check_client_exist'});return r.success===true&&r.data===true;}
 async check(method){if(!CHECK_METHODS.has(method))throw Error('不在只读验证范围内');const r=await this.request({src:this.alias,dst:'thunder-player',action:'check_client_function_exist',method});return r.success===true&&r.data===true;}
 async call(method,...args){if(!READ_METHODS.has(method))throw Error('只读验证器禁止调用播放、暂停或跳转等写操作');const r=await this.request({src:this.alias,dst:'thunder-player',action:'call_remote_client_api',method,args});if(r.success!==true)throw Error('迅雷只读接口调用失败');return r.data;}
 close(){this.failPending('验证连接已退出');if(this.socket){this.socket.end();this.socket=null;}}
}
async function probeLive({client=new ThunderReadonlyIpc(),socketPath,samples=3,spacingMs=1000}={}){
 const result={timestamp:new Date().toISOString(),readOnly:true,playbackCommandsIssued:0};
 try{
  await client.connect(socketPath);result.connected=true;result.playerContextExists=await client.playerExists();if(!result.playerContextExists)return {...result,stage:'进程通信已连接，播放器服务未就绪'};
  result.interfaces={};for(const method of CHECK_METHODS)result.interfaces[method]=await client.check(method);
  if(!result.interfaces.AplayerStackGetCurrPlayMedia)return {...result,stage:'播放器服务未提供当前媒体接口'};
  result.playerVersion=await client.call('AplayerStackGetAplayerVersion');
  const handle=await client.call('AplayerStackGetCurrPlayMedia');result.hasCurrentMedia=typeof handle==='string'&&handle.length>0;
  if(!result.hasCurrentMedia)return {...result,stage:'已接入真实播放器，等待手动打开视频'};
  result.samples=[];
  for(let i=0;i<samples;i++){
   const [state,positionMs,durationMs]=await Promise.all(['AplayerMediaGetMediaState','AplayerMediaGetPlayProgress','AplayerMediaGetDuration'].map(method=>client.call(method,handle)));
   if(![state,positionMs,durationMs].every(Number.isFinite))throw Error('播放器返回的状态字段不是预期数值');
   result.samples.push({at:Date.now(),state,positionMs,durationMs});if(i<samples-1)await new Promise(resolve=>setTimeout(resolve,spacingMs));
  }
  result.speedId=await client.call('AplayerStackGetCurrentPlaySpeedId');
  result.validProgress=result.samples.every(s=>s.positionMs>=0&&s.durationMs>0&&s.positionMs<=s.durationMs+2000);
  result.stage=result.validProgress?'真实媒体状态与进度读取通过':'真实媒体已打开，进度格式尚未通过验证';
  return result;
 }finally{client.close();}
}
module.exports={ThunderReadonlyIpc,probeLive,findPipe};
