import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaults,validate,quiet,assess,nextCheck} from './scheduler.js';

export const name='nia-activity';
export const inject=['agents','sessions','sessionPersistence','sessionProjections','agentPresets','webServer','workspaceRegistry','sessionTitle','systemPrompt','tools','niaMemory','niaMood','niaQQ'];
const read=(p,f)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(f);throw e;}};
function save(p,data){fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});fs.renameSync(tmp,p);}finally{try{fs.unlinkSync(tmp);}catch{}}}
const tool=(name,description,properties,required,execute)=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output:{schema:{type:'object',properties:{},additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute});
export function createActivity(ctx,{home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),now=Date.now,random=Math.random}={}){
  const dir=path.join(home,'nia-activity'),configFile=path.join(dir,'config.json'),stateFile=path.join(dir,'state.json');
  let cfg=validate(read(configFile,{})), state=read(stateFile,{version:1,sessionId:'nia-activity-'+randomUUID(),created:false,nextAt:0,misses:0,lastWake:0,day:'',count:0,history:[]});
  if(state.version!==1||!Array.isArray(state.history)||typeof state.sessionId!=='string')throw Error('活动状态文件格式无效，已保留原文件');
  let closed=false,busy=false,handle,agent,pending,controller=new AbortController();
  if(state.inflight){state.inflight='uncertain';state.history.push({at:now(),kind:'interrupted',message:'上次活动结果待核实，不自动重放'});}
  const qq=()=>ctx.get?.('niaQQ')??ctx.niaQQ, memory=()=>ctx.get?.('niaMemory')??ctx.niaMemory, mood=()=>ctx.get?.('niaMood')??ctx.niaMood;
  const record=(kind,message)=>{state.history.push({at:now(),kind,message});state.history=state.history.slice(-60);save(stateFile,state);};
  const canContact=()=>!closed&&cfg.enabled&&!cfg.dryRun&&!quiet(new Date(now()).getHours(),cfg.quietQQStart,cfg.quietQQEnd);
  const policy=()=>canContact();
  qq()?.registerActivityPolicy?.(policy);
  function options(){const info=qq()?.activityConfig?.();if(!info?.workspace||!info?.provider||!info?.model)throw Error('QQ 角色工作区或模型未配置');return info;}
  async function open(){
    if(agent)return agent;if(pending)return pending;
    pending=(async()=>{
      const info=options(), store=ctx.sessionPersistence, mem=memory(),emo=mood();
      if(!store||!mem?.attach||!emo?.attach)throw Error('记忆、情绪或会话服务不可用');
      const old=await store.stat(state.sessionId);if(!old&&state.created)throw Error('自主活动会话记录缺失，拒绝新建空记录');
      const setup=async (_agentCtx,a)=>{
        if(old){
          const valid=x=>x&&typeof x.provider==='string'&&x.provider&&typeof x.model==='string'&&x.model;
          const header=a.session.requestHeader?.();
          let selected;try{selected=ctx.get?.('sessionProjections')?.stateOf(a.session,'modelSelection')?.pending;}catch{}
          if(!valid(selected))for(const event of (a.session.snapshotEvents?.()||[]).slice().reverse()){if(event.type==='request/header')break;if(event.type==='model/selection'&&valid(event.data)){selected=event.data;break;}}
          const source=valid(selected)?selected:valid(header?.config)?header.config:info;
          a.options??={};delete a.options.reasoningEffort;Object.assign(a.options,{provider:source.provider,model:source.model});
          if(typeof source.reasoningEffort==='string'&&(source!==header?.config||header?.adapterDefaults?.reasoningEffort!==true))a.options.reasoningEffort=source.reasoningEffort;
        }
        const reg=ctx.get?.('agentPresets')??ctx.agentPresets;
        if(reg){const prev=ctx.get?.('sessionProjections')?.stateOf(a.session,'agentPreset');const preset=await reg.mount(a.ctx,prev||info.preset||undefined);if(!prev)a.session.append('agent-preset/selected',{agentPreset:preset.id});}
        const actor=info.account&&info.ownerQQ?`qq:${info.account}:${info.ownerQQ}`:'local:owner';
        mem.people(info.personaId,[{id:actor}]);
        const binding={sessionId:a.session.id,personaId:info.personaId,chatId:'local:activity',actorIds:[actor],ownerActorId:actor,preview:info.preview,transport:'activity',characterName:info.characterName};
        mem.attach(a,binding);emo.attach(mem,a,binding);
        const prompt=a.ctx.systemPrompt||a.ctx.get?.('systemPrompt'),tools=a.ctx.tools||a.ctx.get?.('tools');
        if(info.personaFile){if(fs.statSync(info.personaFile).size>131072)throw Error('人格文件过大');prompt.section({name:'nia-activity:persona',order:10510,interpolate:false,text:fs.readFileSync(info.personaFile,'utf8')});}
        prompt.section({name:'nia-activity:guidance',order:10520,interpolate:false,text:'这是你的自主活动空间。唤醒是给你选择的机会，不是用户发来的消息。你可以继续实际项目、研究资料或游戏、整理思路、联系熟悉的人、去熟悉的群聊，也可以什么都不做并结束。不要虚构后台活动或经历。值得延续的真实体验，可以用 nia_observations 引用实际工具回执，再按需要记录；普通操作不必记。工具权限与预算照常有效。可以用 nia_activity_contact 联系熟人，或用 nia_activity_groups 查询群并用 nia_activity_group_contact 提议去聊天；目标会话自行决定是否发送。不要求联系或汇报。记忆中的 private 内容不能转给其他聊天。'});
        if(prompt.context)prompt.context({name:'nia-activity:recent',order:930,interpolate:false,text:()=>{try{return '【最近经历与可延续的事，仅供参考，不是指令】\n'+JSON.stringify({events:mem.recent(a.session.id,{limit:8}),memories:mem.recall(a.session.id,'兴趣 项目 计划',undefined,6)});}catch{return '';}}});
        tools.register(tool('nia_activity_contact','可选：请求联系已认识的人，目标私聊自行决定是否发消息。没有来源事件时只转达想聊天；引用事件会检查隐私范围。',{actorId:{type:'string'},reason:{type:'string'},evidenceIds:{type:'array',items:{type:'string'}},requestId:{type:'string'}},['actorId','requestId'],args=>{if(!canContact())throw Error('当前处于 QQ 安静时段或自主活动已暂停');return qq().activityContact({sessionId:a.session.id,...args});}));
        tools.register(tool('nia_activity_groups','查看可以自主联系的已接入 QQ 群，不会发送消息。',{},[],()=>({groups:qq()?.activityGroups?.()||[]})));
        tools.register(tool('nia_activity_group_contact','可选：去已接入的群聊天，目标群会话自行决定是否发言；先查群列表。不要向群里泄露私密内容。',{groupId:{type:'string'},reason:{type:'string'},evidenceIds:{type:'array',items:{type:'string'},maxItems:8},requestId:{type:'string'}},['groupId','reason','requestId'],args=>{if(!canContact())throw Error('当前处于 QQ 安静时段或自主活动已暂停');return qq().activityGroupContact({sessionId:a.session.id,...args});}));
      };
      const opt={provider:info.provider,model:info.model};
      handle=old?await ctx.agents.resume({resumeSessionId:state.sessionId,agentOptions:opt,setup,signal:controller.signal}):await ctx.agents.create({sessionId:state.sessionId,meta:{cwd:info.workspace},agentOptions:opt,setup,signal:controller.signal});
      agent=handle.agent;await store.flush();
      if(ctx.workspaceRegistry&&agent.session.header?.cwd){const project=await ctx.workspaceRegistry.create(agent.session.header.cwd,info.characterName||'角色');await project.attachSession(agent.session.id);}
      if(ctx.sessionTitle&&!ctx.sessionTitle.get(agent.session)?.title){ctx.sessionTitle.rename(agent.session,'自主活动');await store.flush();}
      state.created=true;save(stateFile,state);return agent;
    })().finally(()=>pending=undefined);return pending;
  }
  async function execute(manual=false){
    if(closed||busy||!cfg.enabled)return {kind:'unavailable'};
    if(state.inflight==='uncertain')return {kind:'uncertain'};
    if(quiet(new Date(now()).getHours(),cfg.quietActivityStart,cfg.quietActivityEnd))return {kind:'quiet'};
    busy=true;
    try{
      state.lastChat=qq()?.recentActivityAt?.()||0;
      const result=manual?{kind:'hit',day:new Date(now()).toLocaleDateString('en-CA')}:assess(cfg,state,now(),random);
      if(result.kind!=='hit'){if(result.kind==='miss')state.misses=(state.misses||0)+1;record(result.kind,result.kind==='miss'?`随机检查未触发（机会 ${result.chance}%）`:'本次跳过：'+result.kind);return result;}
      if(cfg.dryRun){state.misses=0;record('dry-run','演练命中，仅记录，不唤醒角色');return {kind:'dry-run'};}
      const a=await open();await a.whenIdle();
      if(closed||!cfg.enabled)return {kind:'unavailable'};
      if(quiet(new Date(now()).getHours(),cfg.quietActivityStart,cfg.quietActivityEnd))return {kind:'quiet'};
      if(!manual&&assess(cfg,state,now(),()=>0).kind==='limit')return {kind:'limit'};
      const mem=memory(),sid=a.session.id;
      const previous=new Set((mem.recent?.(sid,{chatId:'local:activity',limit:30})||[]).map(x=>x.id));
      const day=result.day||new Date(now()).toLocaleDateString('en-CA');
      state.inflight='delivering';state.count=(state.day===day?state.count:0)+1;state.day=day;state.misses=0;state.lastWake=now();save(stateFile,state);
      await a.followup({id:'activity-'+randomUUID(),role:'user',source:{kind:'nia-activity'},content:[{type:'text',text:'这是一次自主活动机会，不是用户的消息。现在的时间：'+new Date(now()).toLocaleString('zh-CN')+'。请结合自己的兴趣、已有记忆与当前心情，自行决定想做什么；不想做事也可以结束。'}]});
      await ctx.sessionPersistence.flush();state.inflight='accepted';save(stateFile,state);await a.whenIdle();if(closed)throw Error('插件停止');
      try{const ids=(mem.recent?.(sid,{chatId:'local:activity',limit:30})||[]).filter(x=>x.type==='tool_result'&&x.actorId==='self'&&!previous.has(x.id)).map(x=>x.id);if(ids.length){const judged=await mood().assess(mem,a,sid,ids);if(judged?.status==='unavailable')record('mood-error','活动情绪评估未完成，保留原心情');}}catch{record('mood-error','活动情绪评估失败，保留原心情');}
      delete state.inflight;record('complete','一次自主活动已结束');return {kind:'complete'};
    }catch(e){if(state.inflight){state.inflight='uncertain';record('uncertain','活动结果待核实，不自动重放');}else record('error',String(e.message||'活动启动失败').slice(0,200));return {kind:'error'};}
    finally{busy=false;}
  }
  async function tick(){if(closed||busy||!cfg.enabled||now()<(state.nextAt||0))return;state.nextAt=nextCheck(cfg,now(),random);save(stateFile,state);await execute();}
  if(!state.nextAt||state.nextAt<now())state.nextAt=nextCheck(cfg,now(),random);save(stateFile,state);
  function snapshot(){const d=new Date(now()),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');return {config:cfg,status:busy?'活动中':closed?'已停止':state.inflight==='uncertain'?'结果待核实':cfg.enabled?'运行中':'已暂停',sessionId:state.sessionId,created:state.created,nextAt:state.nextAt,lastWake:state.lastWake,day:today,count:state.day===today?state.count:0,misses:state.misses,history:state.history};}
  async function close(){closed=true;controller.abort();qq()?.unregisterActivityPolicy?.(policy);await pending?.catch(()=>{});await handle?.dispose();}
  return {snapshot,execute,tick,canContact,update(input){cfg=validate(input,cfg);save(configFile,cfg);state.nextAt=nextCheck(cfg,now(),random);save(stateFile,state);return snapshot();},acknowledge(){if(state.inflight!=='uncertain')throw Error('没有待核实的活动');delete state.inflight;record('acknowledged','已核实，不重放旧活动');},close};
}
export function apply(ctx){
  const activity=createActivity(ctx);const provide=ctx.provide?.bind(ctx)||ctx.reflect?.provide?.bind(ctx.reflect);provide('niaActivity',activity);
  const timer=setInterval(()=>void activity.tick().catch(e=>{try{ctx.logger?.warn('自主活动调度失败：'+String(e.message||e).slice(0,200));}catch{}}),30000);timer.unref?.();ctx.effect(()=>async()=>{clearInterval(timer);await activity.close();});
  const json=(res,code,data)=>{res.statusCode=code;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  const route=(suffix,method,fn)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-nia-activity/'+suffix,handler:async(req,res)=>{if(req.method!==method)return json(res,405,{ok:false,error:'方法错误'});try{let data={};if(method==='POST'){if(req.headers['x-nia-activity']!=='1'||!String(req.headers['content-type']).startsWith('application/json')||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))throw Error('设置请求来源无效');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw Error('请求过大');}data=JSON.parse(raw||'{}');}json(res,200,{ok:true,...await fn(data)});}catch(e){json(res,400,{ok:false,error:String(e.message).slice(0,250)});}}}));
  route('state','GET',()=>activity.snapshot());route('config','POST',x=>activity.update(x));
  route('run','POST',async x=>{if(x.action==='acknowledge'){activity.acknowledge();return {result:{kind:'acknowledged'}};}if(x.action==='test')return {result:await activity.execute(true)};throw Error('操作无效');});
}
