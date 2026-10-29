import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActivity} from '../lib/index.js';
import {Database} from '../../dsh-nia-memory/lib/store.js';
import {Memory} from '../../dsh-nia-memory/lib/core.js';
import {createAgentExtensions} from '../../dsh-nia-memory/lib/activity-context.js';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-autonomy-'));
  const db=new Database(path.join(dir,'memory')),mem=new Memory(db),extensions=createAgentExtensions(),saved=new Map();
  let time=new Date(2026,9,29,10).getTime(),wakes=0,onWake=async()=>{},activityAgent;
  const agents=[],clean=[];
  function makeAgent(id){
    const tools=new Map(),guards=[],contexts=new Map(),events=[];
    const a={options:{},session:{id,header:{cwd:dir},append(){},snapshotEvents:()=>events,requestHeader:()=>({config:{provider:'test',model:'test'},tools:[...tools.values()]})},events,tools,contexts,
      ctx:{effect(fn){const off=fn();clean.push(off);return off;},systemPrompt:{section:x=>()=>{},context:x=>{contexts.set(x.name,x);return()=>contexts.delete(x.name);}},tools:{register:x=>{assert.ok(!tools.has(x.name),'duplicate tool '+x.name);tools.set(x.name,x);return()=>tools.delete(x.name);},schemas:()=>[...tools.values()],guard:fn=>{guards.push(fn);return()=>guards.splice(guards.indexOf(fn),1);}}},
      cancel(cause){a.cancelled=cause;},whenIdle:async()=>{},followup:async input=>{wakes++;a.lastInput=input;await onWake(a);}};
    tools.set('cua_driver_native__list_apps',{name:'cua_driver_native__list_apps',execute:()=>({apps:['test']})});
    a.call=async(name,args={})=>{
      const id='call-'+events.length;events.push({type:'tool/call',time,data:{callId:id,name}});
      let error=false,result;
      try{for(const guard of guards){const why=guard({name,agent:a,concludeTurn(){}});if(why)throw Error(why);}result=await tools.get(name).execute(args);}
      catch(e){error=true;result={error:e.message};}
      events.push({type:'tool/result',time,data:{message:{source:{callId:id},isError:error,content:[{type:'text',text:JSON.stringify(result)}]}}});
      return {id,error,result};
    };
    agents.push(a);return a;
  }
  mem.registerAgentExtension=extensions.register;
  mem.attach=(a,b)=>{mem.bind(b);extensions.track(a,b,()=>{});};
  const friend=makeAgent('qq-session');const binding={sessionId:friend.session.id,personaId:'role',chatId:'qq:100:private:200',actorIds:['qq:100:200'],ownerActorId:'qq:100:200',transport:'qq',preview:false};
  mem.people('role',[{id:'qq:100:200',name:'用户'}]);mem.attach(friend,binding);
  const qq={activityConfig:()=>({workspace:dir,provider:'test',model:'test',personaId:'role',account:'100',ownerQQ:'200',preview:false}),recentActivityAt:()=>0,registerActivityPolicy(){},unregisterActivityPolicy(){},activityContact(){throw Error('test must not send');},activityGroups:()=>[]};
  const ctx={get(n){return this[n];},niaQQ:qq,niaMemory:mem,niaMood:{attach(){},assess:async()=>({status:'updated'})},sessionPersistence:{stat:async id=>saved.get(id),flush:async()=>{}},agents:{create:open,resume:open,list:()=>agents}};
  async function open(o){const a=makeAgent(o.sessionId||o.resumeSessionId);await o.setup(a.ctx,a);saved.set(a.session.id,{});activityAgent=a;return {agent:a,dispose:async()=>{}};}
  const instance=createActivity(ctx,{home:dir,now:()=>time,random:()=>.99});
  instance.update({quietActivityStart:0,quietActivityEnd:0,minCheckMinutes:720,maxCheckMinutes:720,peakChance:0,offpeakChance:0,missBonus:0});
  t.after(async()=>{await instance.close();extensions.close();for(const off of clean.reverse())off?.();db.close();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true});});
  return {dir,db,mem,friend,binding,instance,ctx,get a(){return activityAgent;},get wakes(){return wakes;},get time(){return time;},advance:minutes=>{time+=minutes*60000;},onWake:fn=>onWake=fn,
    say:(id,text)=>mem.ingest(friend.session.id,[{id,text,actorId:'qq:100:200',occurredAt:time}]),intent:args=>friend.tools.get('nia_activity_intent').execute(args)};
}

test('existing QQ sessions can leave ideas which enrich the independent activity context',async t=>{
  const f=fixture(t);f.say('mention','最近经常在 Codex 聊天');
  const {intent}=await f.intent({title:'了解一下 Codex',reason:'对这个应用有点好奇',evidenceIds:['mention'],subjects:['qq:100:200'],afterMinutes:60});
  assert.equal(f.wakes,0);assert.ok(f.friend.tools.has('nia_activity_place'));
  await f.instance.execute(true);
  const context=JSON.parse(f.a.contexts.get('nia-activity:recent').text().split('\n').slice(1).join('\n'));
  assert.equal(context.intents[0].id,intent.id);assert.ok(context.events.some(x=>x.id==='mention'));
  assert.ok(context.tools.desktopTools.includes('cua_driver_native__list_apps'));assert.equal(context.tools.providerVerified,false);
  assert.ok(f.a.lastInput.content[0].text.includes('不是用户的消息'));
});

test('due and relevant-message opportunities bypass chance but respect cooldown and are consumed once',async t=>{
  const f=fixture(t);f.say('first','等会再说');
  const {intent}=await f.intent({title:'之后再看看',status:'waiting',subjects:['qq:100:200'],evidenceIds:['first'],afterMinutes:5});
  f.advance(6);await f.instance.tick();assert.equal(f.wakes,1);assert.equal(f.instance.snapshot().notebook.intents[0].nextAt,null);
  await f.instance.tick();assert.equal(f.wakes,1);
  f.advance(2);f.say('reply','我回来了');f.advance(4);await f.instance.tick();assert.equal(f.wakes,1);
  f.advance(25);await f.instance.tick();assert.equal(f.wakes,2);await f.instance.tick();assert.equal(f.wakes,2);
  f.instance.editIntent({id:intent.id,action:'cancel'});f.advance(40);f.say('later','再来一句');f.advance(4);await f.instance.tick();assert.equal(f.wakes,2);
});

test('pause, dry-run and daily limits do not consume pending reminders or send messages',async t=>{
  const f=fixture(t);await f.intent({title:'再看一眼',afterMinutes:3});f.advance(4);
  f.instance.update({enabled:false});await f.instance.tick();assert.equal(f.wakes,0);
  f.instance.update({enabled:true,dryRun:true});await f.instance.tick();assert.equal(f.wakes,0);assert.ok(f.instance.snapshot().notebook.intents[0].nextAt);
  f.instance.update({dryRun:false,dailyLimit:1});await f.instance.tick();assert.equal(f.wakes,1);
  await f.intent({title:'第二个想法',afterMinutes:3});f.advance(40);await f.instance.tick();assert.equal(f.wakes,1);assert.ok(f.instance.snapshot().notebook.intents.some(x=>x.nextAt));
});

test('revoked source is excluded from the activity prompt and cannot trigger a wake',async t=>{
  const f=fixture(t);f.say('sensitive','这件事情不要外传');const {intent}=await f.intent({title:'之后考虑',evidenceIds:['sensitive'],afterMinutes:3});
  f.db.transaction(d=>{d.events['role/sensitive'].visibility='private';});f.advance(4);await f.instance.tick();assert.equal(f.wakes,0);
  assert.ok(!f.instance.snapshot().notebook.intents.some(x=>x.id===intent.id));
});

test('tool budget rejects further operations and records real receipts instead of declaring plans done',async t=>{
  const f=fixture(t);f.instance.update({maxToolCalls:5});let succeeded=0;
  f.onWake(async a=>{for(let i=0;i<6;i++){const result=await a.call('cua_driver_native__list_apps');if(!result.error)succeeded++;}});
  const result=await f.instance.execute(true);assert.equal(succeeded,5);assert.equal(result.kind,'limited');
  assert.equal(f.instance.snapshot().lastRun.tools.at(-1).status,'failed');assert.equal(f.a.cancelled.kind,'hook');
});

test('missing result and model error retain uncertainty rather than silently continuing',async t=>{
  const f=fixture(t);f.onWake(async a=>a.events.push({type:'tool/call',time:f.time,data:{name:'cua_driver_native__type_text',callId:'unknown'}}));
  assert.equal((await f.instance.execute(true)).kind,'error');assert.equal(f.instance.snapshot().lastRun.status,'uncertain');
  await f.instance.tick();assert.equal(f.wakes,1);f.instance.acknowledge();
  f.onWake(async a=>a.events.push({type:'turn/end',data:{reason:{kind:'error',error:{message:'offline error'}}}}));
  assert.equal((await f.instance.execute(true)).kind,'error');assert.equal(f.instance.snapshot().status,'结果待核实');
});

test('flush failure after accepting a wake cancels the agent and keeps later tools blocked',async t=>{
  const f=fixture(t);let executions=0,cancels=0,drains=0,blockedWhileDraining;
  f.onWake(async a=>{
    a.tools.get('cua_driver_native__list_apps').execute=()=>{executions++;return {apps:['test']};};
    assert.equal((await a.call('cua_driver_native__list_apps')).error,false);
    const originalCancel=a.cancel.bind(a);
    a.cancel=cause=>{cancels++;originalCancel(cause);};
    a.whenIdle=async()=>{drains++;blockedWhileDraining=await a.call('cua_driver_native__list_apps');};
    // followup has accepted the wake; the next persistence boundary fails.
    f.ctx.sessionPersistence.flush=async()=>{throw Error('simulated session-persistence-jsonl flush failed');};
  });
  assert.equal((await f.instance.execute(true)).kind,'error');
  assert.equal(f.wakes,1);assert.equal(cancels,1);assert.equal(drains,1);
  assert.equal(f.a.cancelled.kind,'hook');assert.equal(blockedWhileDraining.error,true);
  assert.match(blockedWhileDraining.result.error,/停止|待核实/);
  assert.equal(executions,1);
  // The error cleanup must not accidentally remove the denial with runControl.
  const later=await f.a.call('cua_driver_native__list_apps');
  assert.equal(later.error,true);assert.equal(executions,1);
  assert.equal(f.instance.snapshot().status,'结果待核实');
  await f.instance.tick();assert.equal(f.wakes,1);
});

test('an early missing receipt still blocks the run when the display retains only the last fifty calls',async t=>{
  const f=fixture(t);f.instance.update({maxToolCalls:100});
  f.onWake(async a=>{
    a.events.push({type:'tool/call',time:f.time,data:{name:'cua_driver_native__type_text',callId:'first-unconfirmed'}});
    for(let i=0;i<60;i++)assert.equal((await a.call('cua_driver_native__list_apps')).error,false);
  });
  assert.equal((await f.instance.execute(true)).kind,'error');
  const run=f.instance.snapshot().lastRun;
  assert.equal(run.calls,61);assert.equal(run.tools.length,50);
  assert.ok(run.tools.every(x=>x.status==='returned'));
  assert.equal(run.unknownCount,1);assert.equal(run.status,'uncertain');
  await f.instance.tick();assert.equal(f.wakes,1);
});

test('an older due idea is included in the first wake context ahead of newer unrelated ideas',async t=>{
  const f=fixture(t);f.say('old-interest','之前提到想了解的应用');
  const {intent:old}=await f.intent({title:'到时看看那个旧应用',reason:'这条缘由需要和到期记录一起出现',evidenceIds:['old-interest'],afterMinutes:3});
  f.advance(1);
  for(let i=0;i<16;i++)await f.intent({title:'较新的其他念头 '+i});
  let initialContext;
  f.onWake(async a=>{initialContext=JSON.parse(a.contexts.get('nia-activity:recent').text().split('\n').slice(1).join('\n'));});
  f.advance(3);await f.instance.tick();
  assert.equal(f.wakes,1);
  assert.equal(initialContext.intents[0].id,old.id);
  assert.equal(initialContext.intents[0].title,old.title);
  assert.equal(initialContext.intents[0].reason,old.reason);
  assert.ok(initialContext.events.some(x=>x.id==='old-interest'));
  assert.ok(f.a.lastInput.content[0].text.includes(old.id));
});
