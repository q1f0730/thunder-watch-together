const test=require('node:test'),assert=require('node:assert/strict');
const {createRelay}=require('../relay.cjs');
const {SyncClient,makeInvite,decodeInvite,project}=require('../lib/client.cjs');
const WebSocket=require('ws');
const id='a'.repeat(64);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=7000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error('等待超时：'+label);await sleep(30);}}
class FakePlayer{
 constructor(){this.value={mediaId:id,position:10000,duration:120000,playing:true,buffering:false,rate:1};this.at=Date.now();this.applies=0;}
 sample(){const now=Date.now();if(this.value.playing&&!this.value.buffering)this.value.position+=(now-this.at)*this.value.rate;this.at=now;return {...this.value};}
 apply(s,{seek}={}){this.sample();if(seek)this.value.position=s.position;this.value.playing=s.playing;this.value.rate=s.rate;this.applies++;}
 set(patch){this.sample();Object.assign(this.value,patch);}
 close(){}
}
test('两个真实 WebSocket 客户端：双向暂停、播放、拖动、缓冲恢复、断线暂停',async t=>{
 const relay=createRelay({port:0});const address=await relay.listen();t.after(()=>relay.close());
 const invite=makeInvite(`ws://127.0.0.1:${address.port}/ws`),a=new FakePlayer(),b=new FakePlayer(),ca=new SyncClient(a,{interval:50}),cb=new SyncClient(b,{interval:50});t.after(()=>{ca.disconnect();cb.disconnect();});
 ca.connect(invite);cb.connect(invite);await until(()=>ca.state?.playing&&cb.state?.playing&&a.value.playing&&b.value.playing,'两端开始播放');await sleep(1300);
 a.set({playing:false});await until(()=>ca.state?.wanted===false&&!b.value.playing,'甲暂停同步到乙');await sleep(1300);
 b.set({position:60000});await until(()=>Math.abs(a.sample().position-60000)<1500,'乙拖动同步到甲');await sleep(1300);
 b.set({playing:true});await until(()=>ca.state?.wanted&&a.value.playing,'乙播放同步到甲');await sleep(1300);
 a.set({buffering:true});await until(()=>ca.state?.hold==='等待缓冲'&&!b.value.playing,'缓冲暂停');
 a.set({buffering:false});await until(()=>ca.state?.playing&&cb.state?.playing&&b.value.playing,'缓冲恢复');
 cb.disconnect();await until(()=>ca.state?.hold==='等待另一人'&&!a.value.playing,'断线暂停');
 assert.ok(a.applies<30&&b.applies<30,'同步不应形成远程操作回声循环');
});
test('视频不同的真实客户端不执行对方的跳转',async t=>{const relay=createRelay({port:0});const address=await relay.listen();t.after(()=>relay.close());const invite=makeInvite(`ws://127.0.0.1:${address.port}`);const a=new FakePlayer(),b=new FakePlayer();b.value.mediaId='b'.repeat(64);b.value.position=70000;const ca=new SyncClient(a,{interval:50}),cb=new SyncClient(b,{interval:50});t.after(()=>{ca.disconnect();cb.disconnect();});ca.connect(invite);await until(()=>ca.state,'首端初始化');cb.connect(invite);await until(()=>ca.state?.hold==='两端视频不一致','视频身份检查');assert.equal(b.applies,0);});
test('错误房间密钥无法加入；第三人被拒绝',async t=>{
 const relay=createRelay({port:0});const address=await relay.listen();t.after(()=>relay.close());const invite=makeInvite(`ws://127.0.0.1:${address.port}`),config=decodeInvite(invite),sockets=[];t.after(()=>sockets.forEach(x=>x.terminate()));
 const join=async(secret,clientId)=>{const s=new WebSocket(config.relay);sockets.push(s);const result=new Promise(resolve=>{s.on('message',raw=>resolve(JSON.parse(raw).type));s.on('close',()=>resolve('closed'));});await new Promise(resolve=>s.once('open',resolve));s.send(JSON.stringify({type:'join',room:config.room,secret,clientId}));return result;};
 assert.equal(await join(config.secret,'aaaaaaaa'),'welcome');assert.equal(await join('f'.repeat(64),'bbbbbbbb'),'closed');assert.equal(await join(config.secret,'cccccccc'),'welcome');assert.equal(await join(config.secret,'dddddddd'),'closed');
});
test('退出时在途采样不能触发远程播放器操作',async()=>{let finish,calls=0;const adapter={sample:()=>new Promise(resolve=>{finish=resolve;}),apply:()=>{calls++;},close(){}};const c=new SyncClient(adapter);c.closed=false;c.ready=true;c.state={mediaId:id,position:0,duration:120000,playing:false,buffering:false,rate:1,revision:1,at:Date.now(),hold:''};const pending=c.tick();c.disconnect();finish({mediaId:id,position:10000,duration:120000,playing:true,buffering:false,rate:1});await pending;assert.equal(calls,0);});
test('邀请码拒绝远程明文中继，时间投影限制在视频时长内',()=>{assert.throws(()=>makeInvite('ws://example.com'),/wss/);assert.throws(()=>decodeInvite('无效'),/格式/);assert.equal(project({position:99000,duration:100000,playing:true,at:0,rate:2},1000),100000);});
