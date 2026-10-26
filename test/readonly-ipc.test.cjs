const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {ThunderReadonlyIpc,probeLive}=require('../lib/thunder-readonly-ipc.cjs');
async function fixture(t,{hasMedia=true,ignoreMethod=null,splitUtf8=false}={}){
 const requests=[],sockets=new Set();let pos=10000;
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);requests.push(m);if(m.method===ignoreMethod)continue;
  let data=true;
  if(m.action==='call_remote_client_api'){
   data={AplayerStackGetAplayerVersion:'5.2.1.51',AplayerStackGetCurrPlayMedia:hasMedia?'1':'',AplayerStackGetCurrentPlaySpeedId:'play_speed_1',AplayerMediaGetMediaState:4,AplayerMediaGetPlayProgress:pos+=10,AplayerMediaGetDuration:120000}[m.method];
  }
  const encoded=Buffer.from(JSON.stringify({rid:m.rid,success:true,data,note:'只读响应'})+'\n');
  if(splitUtf8){const index=encoded.indexOf(Buffer.from('只'))+1;socket.write(encoded.subarray(0,index));setImmediate(()=>{if(!socket.destroyed)socket.write(encoded.subarray(index));});}
  else socket.write(encoded);
 }});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
 const client=new ThunderReadonlyIpc({connect:()=>net.connect(server.address().port,'127.0.0.1'),timeoutMs:250});
 return {client,requests};
}
test('真实传输解析读取媒体进度，未发送控制命令',async t=>{const {client,requests}=await fixture(t);const report=await probeLive({client,socketPath:'test',samples:3,spacingMs:1});assert.equal(report.connected,true);assert.equal(report.validProgress,true);assert.equal(report.samples.length,3);assert.ok(report.samples[2].positionMs>report.samples[0].positionMs);assert.equal(report.playbackCommandsIssued,0);assert.ok(requests.filter(x=>x.action==='call_remote_client_api').every(x=>!['AplayerStackPlayMedia','AplayerStackPauseMedia','AplayerMediaProgressMoveTo'].includes(x.method)));});
test('没有当前媒体时返回等待，不伪造进度验证成功',async t=>{const {client,requests}=await fixture(t,{hasMedia:false});const report=await probeLive({client,socketPath:'test'});assert.equal(report.hasCurrentMedia,false);assert.equal(report.validProgress,undefined);assert.equal(requests.some(x=>x.method==='AplayerMediaGetPlayProgress'),true);assert.equal(requests.some(x=>x.method==='AplayerMediaGetPlayProgress'&&x.action==='call_remote_client_api'),false);});
test('写操作和任意进程通信动作被验证器拦截',async t=>{const {client,requests}=await fixture(t);await client.connect('test');await assert.rejects(client.call('AplayerStackPauseMedia'),/禁止/);await assert.rejects(client.request({action:'call_remote_client_api',method:'AplayerMediaProgressMoveTo',args:['1',60000]}),/禁止/);await assert.rejects(client.request({action:'broadcast',name:'anything'}),/不允许/);assert.equal(requests.length,1);client.close();});
test('请求超时释放待处理请求',async t=>{const {client}=await fixture(t,{ignoreMethod:'AplayerStackGetAplayerVersion'});await client.connect('test');await assert.rejects(client.call('AplayerStackGetAplayerVersion'),/超时/);assert.equal(client.pending.size,0);client.close();});
test('跨数据块 UTF-8 响应可以正常解析',async t=>{const {client}=await fixture(t,{splitUtf8:true});await client.connect('test');assert.equal(await client.playerExists(),true);client.close();});
