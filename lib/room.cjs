'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const validSample=s=>s&&/^[a-f0-9]{64}$/.test(s.mediaId)&&finite(s.position,0,1e9)&&finite(s.duration,1,1e9)&&s.position<=s.duration+2000&&typeof s.playing==='boolean'&&typeof s.buffering==='boolean'&&finite(s.rate,0.25,8);
class Room{
  constructor(secret,{now=Date.now}={}){this.secret=createHash('sha256').update(secret).digest();this.now=now;this.peers=new Map();this.state=null;this.intentIds=new Map();this.emptyAt=now();}
  authorized(secret){const x=createHash('sha256').update(secret).digest();return timingSafeEqual(x,this.secret);}
  add(id,send){if(this.peers.has(id)||this.peers.size>=2)return false;this.peers.set(id,{send,sample:null,seen:this.now()});return true;}
  position(){const s=this.state;return s?Math.min(s.duration,Math.max(0,s.position+(s.playing?(this.now()-s.at)*s.rate:0))):0;}
  view(){return this.state?{...this.state,buffering:this.state.hold==='等待缓冲',serverTime:this.now(),members:this.peers.size}:null;}
  broadcast(){const state=this.view();for(const p of this.peers.values())p.send({type:'state',state});}
  commit(patch={}){if(!this.state)return;this.state={...this.state,position:this.position(),at:this.now(),...patch,revision:this.state.revision+1};this.broadcast();}
  hold(){if(this.peers.size!==2)return '等待另一人';for(const p of this.peers.values()){if(!p.sample||this.now()-p.seen>3500)return '等待播放状态';if(p.sample.mediaId!==this.state.mediaId||Math.abs(p.sample.duration-this.state.duration)>2000)return '两端视频不一致';if(p.sample.buffering)return '等待缓冲';}return '';}
  refresh(){if(!this.state)return;const hold=this.hold(),playing=this.state.wanted&&!hold;if(hold!==this.state.hold||playing!==this.state.playing)this.commit({hold,playing});}
  observe(id,sample){if(!validSample(sample))return false;const p=this.peers.get(id);if(!p)return false;p.sample={...sample};p.seen=this.now();if(!this.state){this.state={mediaId:sample.mediaId,duration:sample.duration,position:sample.position,at:this.now(),rate:sample.rate,playing:false,wanted:sample.playing,hold:'等待另一人',revision:1};this.broadcast();}this.refresh();return true;}
  intent(id,message){const p=this.peers.get(id),s=this.state;if(!p||!s||!p.sample||message.mediaId!==s.mediaId||p.sample.mediaId!==s.mediaId)return false;if(!/^[a-f0-9-]{8,64}$/.test(message.id)||this.intentIds.has(message.id))return false;
    if(message.baseRevision!==s.revision){p.send({type:'rejected',reason:'状态已更新',state:this.view()});return false;}
    let patch;
    if(message.action==='play'||message.action==='pause')patch={wanted:message.action==='play'};
    else if(message.action==='seek'&&finite(message.position,0,s.duration))patch={position:message.position};
    else if(message.action==='rate'&&finite(message.rate,0.25,8))patch={rate:message.rate};
    else if(message.action==='update'&&message.changes&&typeof message.changes==='object'){
      const c=message.changes,keys=Object.keys(c);if(!keys.length||keys.some(k=>!['position','wanted','rate'].includes(k)))return false;patch={};
      if('position'in c){if(!finite(c.position,0,s.duration))return false;patch.position=c.position;}
      if('wanted'in c){if(typeof c.wanted!=='boolean')return false;patch.wanted=c.wanted;}
      if('rate'in c){if(!finite(c.rate,0.25,8))return false;patch.rate=c.rate;}
    }
    else return false;
    this.intentIds.set(message.id,true);if(this.intentIds.size>256)this.intentIds.delete(this.intentIds.keys().next().value);
    const hold=this.hold();patch.hold=hold;patch.playing=(patch.wanted??s.wanted)&&!hold;this.commit(patch);return true;
  }
  remove(id){this.peers.delete(id);this.emptyAt=this.now();this.refresh();}
}
module.exports={Room,validSample};
