import {createActivity} from './runtime.js';
export {createActivity};
export const name='nia-activity';
export const inject=['agents','sessions','sessionPersistence','sessionProjections','agentPresets','webServer','workspaceRegistry','sessionTitle','systemPrompt','tools','niaMemory','niaMood','niaQQ'];
export function apply(ctx){
  const activity=createActivity(ctx);const provide=ctx.provide?.bind(ctx)||ctx.reflect?.provide?.bind(ctx.reflect);provide('niaActivity',activity);
  const timer=setInterval(()=>void activity.tick().catch(e=>{try{ctx.logger?.warn('自主活动调度失败：'+String(e.message||e).slice(0,200));}catch{}}),30000);timer.unref?.();ctx.effect(()=>async()=>{clearInterval(timer);await activity.close();});
  const json=(res,code,data)=>{res.statusCode=code;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  const route=(suffix,method,fn)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-nia-activity/'+suffix,handler:async(req,res)=>{if(req.method!==method)return json(res,405,{ok:false,error:'方法错误'});try{let data={};if(method==='POST'){if(req.headers['x-nia-activity']!=='1'||!String(req.headers['content-type']).startsWith('application/json')||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))throw Error('设置请求来源无效');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw Error('请求过大');}data=JSON.parse(raw||'{}');}json(res,200,{ok:true,...await fn(data)});}catch(e){json(res,400,{ok:false,error:String(e.message).slice(0,250)});}}}));
  route('state','GET',()=>activity.snapshot());route('config','POST',x=>activity.update(x));route('intent','POST',x=>activity.editIntent(x));
  route('run','POST',async x=>{if(x.action==='acknowledge'){activity.acknowledge();return {result:{kind:'acknowledged'}};}if(x.action==='test')return {result:await activity.execute(true)};throw Error('操作无效');});
}
