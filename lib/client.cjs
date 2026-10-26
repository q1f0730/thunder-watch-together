'use strict';
const {randomBytes,randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const WebSocket=require('ws');
const {validSample}=require('./room.cjs');
function validateRelay(raw){const u=new URL(raw);if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw Error('中继地址必须是 ws:// 或 wss://，且不含密码或查询参数');if(u.protocol==='ws:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('异地中继请使用加密的 wss:// 地址');if(u.pathname==='/'||!u.pathname)u.pathname='/ws';if(u.pathname!=='/ws')throw Error('中继路径必须为 /ws');return u.href;}
function makeInvite(relay){return encodeInvite({relay:validateRelay(relay),room:'v1_'+randomBytes(12).toString('hex'),secret:randomBytes(32).toString('hex')});}
function encodeInvite(value){return 'WT1.'+Buffer.from(JSON.stringify(value)).toString('base64url');}
function decodeInvite(text){if(typeof text!=='string'||text.length>2000||!text.startsWith('WT1.'))throw Error('邀请码格式错误');let v;try{v=JSON.parse(Buffer.from(text.slice(4),'base64url'));}catch{throw Error('邀请码格式错误');}if(!v||!/^v1_[a-f0-9]{24}$/.test(v.room)||!/^[a-f0-9]{64}$/.test(v.secret))throw Error('邀请码格式错误');return {relay:validateRelay(v.relay),room:v.room,secret:v.secret};}
function project(state,now){return Math.max(0,Math.min(state.duration,state.position+(state.playing?Math.max(0,now-state.at)*state.rate:0)));}
class SyncClient extends EventEmitter{
 constructor(adapter,{now=Date.now,interval=250}={}){super();this.adapter=adapter;this.now=now;this.interval=interval;this.state=null;this.previous=null;this.offset=0;this.ready=false;this.closed=true;this.inFlight=false;this.settleUntil=0;this.appliedRevision=-1;this.clientId=randomUUID();}
 connect(invite){if(!this.closed)throw Error('请先退出当前房间');const config=decodeInvite(invite);this.generation=(this.generation||0)+1;this.closed=false;this.state=null;this.previous=null;this.appliedRevision=-1;this.ready=false;this.inFlight=false;this.offset=0;this.rttBest=Infinity;this.settleUntil=0;
  const socket=this.socket=new WebSocket(config.relay,{maxPayload:8192,perMessageDeflate:false,handshakeTimeout:10000});
  socket.on('open',()=>this.send({type:'join',room:config.room,secret:config.secret,clientId:this.clientId}));
  socket.on('message',data=>{if(socket!==this.socket)return;let m;try{m=JSON.parse(data);}catch{return;}
   if(m.type==='welcome'){this.ready=true;this.offset=m.serverTime-this.now();this.accept(m.state);this.emit('status','已加入，等待两端打开同一视频');this.ping();this.tick();this.timer=setInterval(()=>this.tick(),this.interval);this.pinger=setInterval(()=>this.ping(),5000);}
   else if(m.type==='state'||m.type==='rejected')this.accept(m.state);
   else if(m.type==='pong'){const rtt=this.now()-m.sent;if(rtt>=0&&rtt<this.rttBest){this.rttBest=rtt;this.offset=m.serverTime-(m.sent+this.now())/2;}}
   else if(m.type==='error')this.emit('status',m.reason);
  });
  socket.on('error',()=>this.emit('status','无法连接中继，请检查地址和网络'));
  socket.on('close',(_,reason)=>{if(socket!==this.socket)return;this.disconnect();this.emit('status',reason.toString()||'连接已断开，已停止同步');});
 }
 accept(s){if(!s)return;if(!validSample(s)||!Number.isSafeInteger(s.revision)||!Number.isFinite(s.at)||typeof s.hold!=='string')return;if(!this.state||s.revision>=this.state.revision){this.state=s;this.emit('room',s);}}
 send(m){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(m));}
 ping(){this.send({type:'ping',sent:this.now()});}
 intent(action,extra={}){if(!this.state)return;this.send({type:'intent',id:randomUUID(),baseRevision:this.state.revision,mediaId:this.state.mediaId,action,...extra});}
 async tick(){if(!this.ready||this.inFlight||this.closed)return;this.inFlight=true;const generation=this.generation;
  try{
   const sample=await this.adapter.sample(),at=this.now();if(this.closed||generation!==this.generation)return;if(!validSample(sample))throw Error('播放器返回了无效状态');this.send({type:'observe',sample});
   const s=this.state;if(!s){this.previous={sample,at};return;}if(sample.mediaId!==s.mediaId){this.previous=null;this.emit('status','两端视频不一致，未执行同步');return;}
   const target={...s,position:project(s,at+this.offset)},previous=this.previous;let action=null;
   const fresh=s.revision!==this.appliedRevision;
   if(!fresh&&previous&&at>=this.settleUntil&&!sample.buffering){
    const expected=previous.sample.position+(previous.sample.playing&&!previous.sample.buffering?(at-previous.at)*previous.sample.rate:0);
    const changes={};
    if(sample.playing!==previous.sample.playing&&sample.playing!==s.playing)changes.wanted=sample.playing;
    if(Math.abs(sample.position-expected)>1500)changes.position=sample.position;
    if(sample.rate!==previous.sample.rate&&sample.rate!==s.rate)changes.rate=sample.rate;
    if(Object.keys(changes).length)action=['intent','update',{changes}];
   }
   if(action)this.intent(action[1],action[2]);
   else{
    const seek=Math.abs(target.position-sample.position)>1200;
    if(fresh||seek||target.playing!==sample.playing||target.rate!==sample.rate){
     if(at>=this.settleUntil||fresh){await this.adapter.apply(target,{seek});this.appliedRevision=s.revision;this.settleUntil=at+1000;this.previous={sample:{...sample,position:seek?target.position:sample.position,playing:target.playing,rate:target.rate},at};this.emit('status',s.hold||'同步中 · 双方均可控制');return;}
    }
   }
   this.previous={sample,at};this.emit('status',s.hold||'同步中 · 双方均可控制');
  }catch(error){if(generation===this.generation&&!this.closed){this.previous=null;this.send({type:'unavailable'});this.emit('status',error.message||'无法读取播放器');}}
  finally{if(generation===this.generation)this.inFlight=false;}
 }
 disconnect(){this.generation=(this.generation||0)+1;this.closed=true;this.ready=false;clearInterval(this.timer);clearInterval(this.pinger);this.timer=null;this.pinger=null;const socket=this.socket;this.socket=null;if(socket){socket.removeAllListeners();socket.on('error',()=>{});socket.close();}this.state=null;this.previous=null;this.adapter.close?.();}
}
module.exports={SyncClient,makeInvite,decodeInvite,project,validateRelay};
