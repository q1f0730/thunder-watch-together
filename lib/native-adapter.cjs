'use strict';
const {createHash}=require('node:crypto');
const speedIds=new Map([[0.5,'play_speed_0.5'],[0.75,'play_speed_0.75'],[1,'play_speed_1'],[1.25,'play_speed_1.25'],[1.5,'play_speed_1.5'],[2,'play_speed_2'],[3,'play_speed_3'],[4,'play_speed_4'],[5,'play_speed_5'],[8,'play_speed_8']]);
class ThunderAdapter{
 constructor({getStack=()=>global.AplayerStackImplInstance,now=Date.now}={}){this.getStack=getStack;this.now=now;this.media=null;this.buffering=false;this.bufferCookie=undefined;}
 stack(){const s=this.getStack();if(!s||typeof s.getCurrPlayMedia!=='function')throw Error('等待迅雷播放器初始化');return s;}
 current(){const m=this.stack().getCurrPlayMedia();if(!m)throw Error('请先在迅雷中播放云盘视频');if(m!==this.media){this.detach();this.media=m;this.buffering=false;this.bufferCookie=m.attachPlayBufferEvent(loading=>{this.buffering=Boolean(loading);});}return m;}
 sample(){const stack=this.stack(),m=this.current(),attr=m.getAttribute();if(!attr||![0,10].includes(attr.mediaType))throw Error('当前仅支持迅雷云盘视频');
  const identity=attr.gcid?`gcid:${String(attr.gcid).toLowerCase()}`:attr.pan?.panFileId?`pan:${attr.pan.panFileId}`:null;if(!identity)throw Error('当前视频缺少稳定标识，暂不启用同步');
  const state=m.getMediaState();if(state!==3&&state!==4)throw Error('等待视频进入播放或暂停状态');
  const speed=stack.getCurrentPlaySpeedId(),rate=[...speedIds].find(([,id])=>id===speed)?.[0];if(!rate)throw Error('请先选择常规倍速，自定义倍速暂不支持');
  const result={mediaId:createHash('sha256').update(identity).digest('hex'),position:m.getPlayProgress(),duration:m.getDuration(),playing:state===4,buffering:this.buffering,rate};
  if(!Number.isFinite(result.position)||!Number.isFinite(result.duration)||result.duration<=0)throw Error('等待视频时长和进度');return result;
 }
 apply(target,{seek=true}={}){const before=this.sample();if(before.mediaId!==target.mediaId)throw Error('两端视频不一致，已阻止远程操作');const stack=this.stack(),m=this.current();
  if(!speedIds.has(target.rate))throw Error('收到不支持的倍速');
  if(target.playing===false&&before.playing)stack.pauseMedia();
  if(before.rate!==target.rate)stack.switchSpeed(speedIds.get(target.rate));
  if(seek)m.progressMoveTo(Math.round(Math.max(0,Math.min(before.duration,target.position))));
  if(target.playing===true&&!before.playing)stack.playMedia();
 }
 detach(){if(this.media&&this.bufferCookie!==undefined){try{this.media.detachPlayBufferEvent(this.bufferCookie);}catch{}}this.media=null;this.bufferCookie=undefined;}
 close(){this.detach();}
}
module.exports={ThunderAdapter,speedIds};
