import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaults,validate,quiet,assess,nextCheck} from '../lib/scheduler.js';
import {createActivity,apply} from '../lib/index.js';
import {Readable} from 'node:stream';
import {Database} from '../../dsh-nia-memory/lib/store.js';
import {Memory} from '../../dsh-nia-memory/lib/core.js';
import {LinkedMood} from '../../dsh-nia-mood/lib/linked.js';

test('random interval, peak/offpeak, activity and contact quiet hours remain independent',()=>{
  const c=validate({});const d=new Date(2026,9,27,10,0,0).getTime();
  assert.equal(assess(c,{},d,()=>.19).kind,'hit');assert.equal(assess(c,{},d,()=>.21).kind,'miss');
  assert.equal(assess(c,{misses:1},d,()=>.25).kind,'hit');
  assert.equal(assess(c,{},new Date(2026,9,27,2).getTime(),()=>0).kind,'quiet');
  assert.equal(quiet(23,23,8),true);assert.equal(quiet(12,23,8),false);assert.equal(quiet(2,2,2),false);
  assert.equal(nextCheck(c,d,()=>0),d+20*60000);assert.equal(nextCheck(c,d,()=>1),d+40*60000);
  assert.equal(assess(c,{lastChat:d-60000},d,()=>.04).kind,'miss');
  assert.throws(()=>validate({minCheckMinutes:50,maxCheckMinutes:20}),/间隔/);
  assert.throws(()=>validate({peakWindows:[[15,10]]}),/峰时/);
});

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-activity-test-')), saved=new Map(),agents=new Map(),prompts=[],bindings=[],registered=[],memoryEvents=[],moodCalls=[];
  let clock=new Date(2026,9,27,10).getTime(),policy;
  const qq={activityConfig:()=>({workspace:dir,provider:'p',model:'m',personaId:'nia',account:'100',ownerQQ:'200',characterName:'测试角色',preview:false}),recentActivityAt:()=>0,registerActivityPolicy:p=>{policy=p;},unregisterActivityPolicy:p=>{if(policy===p)policy=undefined;},activityContact:x=>({id:'test',args:x})};
  const memory={people(){},attach(a,b){bindings.push(b);},binding(){},recent(){return memoryEvents.slice();}};
  const mood={attach(){},async assess(_m,_a,sid,ids){moodCalls.push({sid,ids});return {status:'updated'};}};
  const ctx={niaQQ:qq,niaMemory:memory,niaMood:mood,get(k){return this[k];},sessionPersistence:{stat:async id=>saved.get(id),flush:async()=>{}},
    agents:{create:open,resume:open},workspaceRegistry:{create:async()=>({attachSession:async()=>{}})}};
  async function open(opts){const id=opts.sessionId||opts.resumeSessionId,a={options:{...opts.agentOptions},session:{id,header:{cwd:dir},append(){},requestHeader:()=>({config:{provider:'p',model:'m'}})},
    ctx:{systemPrompt:{section:x=>{registered.push(x);}},tools:{register:x=>{registered.push(x);},guard:()=>()=>{}}},cancel(){},whenIdle:async()=>{},followup:async m=>{prompts.push(m);}};
    await opts.setup(a.ctx,a);saved.set(id,{});agents.set(id,a);return {agent:a,dispose:async()=>agents.delete(id)};}
  const instance=createActivity(ctx,{home:dir,now:()=>clock,random:()=>0});
  t.after(async()=>{await instance.close();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true});});
  return {dir,ctx,instance,prompts,bindings,registered,saved,agents,memoryEvents,moodCalls,setTime:x=>clock=x,policy:()=>policy};
}
test('real activity wake uses a separate durable session with shared persona and does not require sending QQ',async t=>{
  const f=fixture(t);assert.equal((await f.instance.execute(true)).kind,'complete');
  assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].source.kind,'nia-activity');
  assert.equal(f.bindings[0].chatId,'local:activity');assert.equal(f.bindings[0].personaId,'nia');assert.equal(f.bindings[0].preview,false);
  assert.ok(f.registered.find(x=>x.name==='nia_activity_contact'));assert.ok(f.registered.find(x=>x.name==='nia_activity_groups'));assert.ok(f.registered.find(x=>x.name==='nia_activity_group_contact'));assert.equal(f.instance.snapshot().count,1);
  assert.equal((await f.instance.execute(true)).kind,'complete');assert.equal(f.agents.size,1);
});
test('dry run does not call model; pause and quiet activity hours prevent wake; QQ quiet applies independently',async t=>{
  const f=fixture(t);f.instance.update({dryRun:true});assert.equal((await f.instance.execute(true)).kind,'dry-run');assert.equal(f.prompts.length,0);
  f.instance.update({dryRun:false});f.setTime(new Date(2026,9,27,2).getTime());assert.equal((await f.instance.execute(true)).kind,'quiet');
  f.instance.update({quietActivityStart:0,quietActivityEnd:0});assert.equal(f.instance.canContact(),false);
  assert.equal((await f.instance.execute(true)).kind,'complete');assert.equal(f.prompts.length,1);
  f.instance.update({enabled:false});assert.equal(f.instance.canContact(),false);assert.equal((await f.instance.execute(true)).kind,'unavailable');
});
test('interrupted accepted activity fails closed across restart and can be acknowledged without replay',async t=>{
  const f=fixture(t);await f.instance.close();
  const p=path.join(f.dir,'nia-activity','state.json'),state=JSON.parse(fs.readFileSync(p,'utf8'));state.inflight='accepted';fs.writeFileSync(p,JSON.stringify(state));
  const reopened=createActivity(f.ctx,{home:f.dir,now:()=>new Date(2026,9,27,10).getTime(),random:()=>0});
  assert.equal(reopened.snapshot().status,'结果待核实');assert.equal((await reopened.execute(true)).kind,'uncertain');
  reopened.acknowledge();assert.notEqual(reopened.snapshot().status,'结果待核实');await reopened.close();
});
test('restarts resume the same session and day counter resets on a new date',async t=>{
  const f=fixture(t);await f.instance.execute(true);const sid=f.instance.snapshot().sessionId;await f.instance.close();
  f.setTime(new Date(2026,9,28,10).getTime());const reopened=createActivity(f.ctx,{home:f.dir,now:()=>new Date(2026,9,28,10).getTime(),random:()=>0});
  assert.equal(reopened.snapshot().sessionId,sid);assert.equal(reopened.snapshot().count,0);assert.equal((await reopened.execute(true)).kind,'complete');
  assert.equal(reopened.snapshot().count,1);assert.equal(f.bindings.at(-1).sessionId,sid);await reopened.close();
});
test('an uncertain followup is never automatically replayed',async t=>{
  const f=fixture(t);await f.instance.execute(true);const a=f.agents.values().next().value;
  a.followup=async()=>{throw Error('unknown acceptance');};assert.equal((await f.instance.execute(true)).kind,'error');
  assert.equal(f.instance.snapshot().status,'结果待核实');assert.equal((await f.instance.execute(true)).kind,'uncertain');
});
test('only newly recorded actual tool observations are offered to mood assessment once',async t=>{
  const f=fixture(t);f.memoryEvents.push({id:'old',actorId:'self',type:'tool_result'});await f.instance.execute(true);assert.equal(f.moodCalls.length,0);
  const a=f.agents.values().next().value;a.followup=async()=>{f.memoryEvents.push({id:'new',actorId:'self',type:'tool_result'},{id:'chat',actorId:'qq:100:200',type:'message'});};
  await f.instance.execute(true);assert.deepEqual(f.moodCalls.map(x=>x.ids),[['new']]);
  a.followup=async()=>{};await f.instance.execute(true);assert.equal(f.moodCalls.length,1);
});
test('real memory and mood services share the resulting activity emotion across a QQ binding',async t=>{
  const f=fixture(t),db=new Database(path.join(f.dir,'real-memory')),mem=new Memory(db);
  mem.attach=(a,b)=>mem.bind(b);
  const mood=new LinkedMood(async()=>({overall:{moodDelta:4,dims:{calm:2},reason:'探索有了新发现',confidence:90},targets:[]}));
  mood.attach=()=>{};f.ctx.niaMemory=mem;f.ctx.niaMood=mood;t.after(()=>{mood.close();db.close();});
  await f.instance.execute(true);const a=f.agents.values().next().value,sid=f.instance.snapshot().sessionId;
  a.followup=async()=>{mem.observation(sid,{id:'actual-tool',name:'browser',text:'找到新资料',failed:false,occurredAt:Date.now()});};
  await f.instance.execute(true);assert.equal(mem.mood(sid).version,1);
  mem.bind({sessionId:'qq-session',personaId:'nia',chatId:'qq:100:private:200',actorIds:['qq:100:200'],preview:false,transport:'qq'});
  assert.equal(mem.mood('qq-session').version,1);assert.ok(mem.mood('qq-session').overall.mood>70);assert.equal(mem.mood('qq-session').overall.mood,mem.mood(sid).overall.mood);
  assert.throws(()=>mem.events('qq-session',['actual-tool']),/原聊天/);
});
test('settings routes validate origin and persist safe changes without triggering a model',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-activity-routes-')),old=process.env.DSH_HOME;process.env.DSH_HOME=dir;
  const routes=new Map(),effects=[];let policy;
  const ctx={get(n){return this[n];},provide(n,v){this[n]=v;},effect(fn){const off=fn();effects.push(off);return off;},webServer:{register(r){routes.set(r.path,r.handler);return()=>routes.delete(r.path);}},
    niaQQ:{registerActivityPolicy:f=>policy=f,unregisterActivityPolicy:f=>{if(policy===f)policy=null;},recentActivityAt:()=>0},niaMemory:{},niaMood:{}};
  apply(ctx);t.after(async()=>{for(const off of effects.reverse())await off?.();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true});});
  async function req(name,method,body,origin){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=method;req.headers={host:'localhost','x-nia-activity':'1','content-type':'application/json',...(origin?{origin}:{})};let out;const res={setHeader(){},end(x){out=JSON.parse(x);}};await routes.get('/dsh-nia-activity/'+name)(req,res);return {status:res.statusCode,body:out};}
  assert.equal((await req('config','POST',{dryRun:true},'https://evil.example')).status,400);
  assert.equal((await req('config','POST',{dryRun:true})).status,200);assert.equal((await req('state','GET')).body.config.dryRun,true);
  assert.equal((await req('run','POST',{action:'invalid'})).status,400);
  assert.equal((await req('run','POST',{action:'test'})).body.result.kind,'dry-run');
});
