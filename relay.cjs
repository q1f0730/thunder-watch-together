'use strict';
const http=require('node:http');
const {WebSocketServer,WebSocket}=require('ws');
const {Room}=require('./lib/room.cjs');
function createRelay({host='127.0.0.1',port=8765,now=Date.now}={}){
 const rooms=new Map(),server=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(req.url==='/health'?{ok:true,version:'0.1.0'}:{error:'未找到'}));});
 const wss=new WebSocketServer({server,path:'/ws',maxPayload:8192,perMessageDeflate:false});
 wss.on('connection',socket=>{
  let room=null,id=null,count=0,windowAt=now();const send=x=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(x));};
  const deadline=setTimeout(()=>socket.close(1008,'连接超时'),10000);deadline.unref();
  socket.on('error',()=>{});
  socket.on('message',data=>{
   if(now()-windowAt>=1000){count=0;windowAt=now();}if(++count>30)return socket.close(1008,'消息过于频繁');
   let m;try{m=JSON.parse(data.toString());}catch{return socket.close(1008,'消息格式错误');}if(!m||typeof m!=='object')return socket.close(1008,'消息格式错误');
   if(!room){
    if(m.type!=='join'||!/^v1_[a-f0-9]{24}$/.test(m.room)||!/^[a-f0-9]{64}$/.test(m.secret)||!/^[a-f0-9-]{8,64}$/.test(m.clientId))return socket.close(1008,'房间信息无效');
    if(!rooms.has(m.room)){if(rooms.size>=1000)return socket.close(1013,'服务繁忙');rooms.set(m.room,new Room(m.secret,{now}));}
    const candidate=rooms.get(m.room);if(!candidate.authorized(m.secret))return socket.close(1008,'房间信息无效');
    if(!candidate.add(m.clientId,send))return socket.close(1008,'房间已有两人');
    room=candidate;id=m.clientId;clearTimeout(deadline);send({type:'welcome',serverTime:now(),state:room.view()});room.refresh();return;
   }
   if(m.type==='ping')send({type:'pong',sent:m.sent,serverTime:now()});
   else if(m.type==='observe'){if(!room.observe(id,m.sample))send({type:'error',reason:'播放状态无效'});}
   else if(m.type==='unavailable'){const p=room.peers.get(id);if(p)p.sample=null;room.refresh();}
   else if(m.type==='intent')room.intent(id,m);
  });
  socket.on('close',()=>{clearTimeout(deadline);if(room)room.remove(id);});
 });
 const timer=setInterval(()=>{for(const [key,room]of rooms){room.refresh();if(!room.peers.size&&now()-room.emptyAt>60000)rooms.delete(key);}},1000);timer.unref();
 return {server,wss,rooms,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve(server.address());});}),close:async()=>{clearInterval(timer);for(const s of wss.clients)s.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}};
}
if(require.main===module){const relay=createRelay({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||8765)});relay.listen().then(x=>console.log(`一起看中继已启动，监听端口 ${x.port}`)).catch(()=>{console.error('中继启动失败，请检查端口和地址');process.exitCode=1;});}
module.exports={createRelay};
