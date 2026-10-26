'use strict';
const {probeLive}=require('../lib/thunder-readonly-ipc.cjs');
probeLive().then(result=>{console.log(JSON.stringify(result,null,2));if(!result.validProgress)process.exitCode=2;}).catch(error=>{console.error(JSON.stringify({readOnly:true,playbackCommandsIssued:0,error:error.message}));process.exitCode=1;});
