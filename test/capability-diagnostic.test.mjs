import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createActivity} from '../lib/index.js';

test('provider verification requires current model, current wake and all current activity/desktop tool names',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-cap-diagnostic-'));
  const clock=new Date(2026,9,29,12).getTime(),map=new Map();let a;
  const ctx={get(k){return this[k];},niaQQ:{activityConfig:()=>({workspace:dir,provider:'test',model:'offline',personaId:'role',preview:false}),registerActivityPolicy(){},unregisterActivityPolicy(){}},niaMemory:{people(){},attach(){},recent:()=>[],binding:()=>undefined},niaMood:{attach(){}},sessionPersistence:{stat:async()=>null,flush:async()=>{}},agents:{create:async o=>{
    a={options:{model:'offline'},session:{id:o.sessionId,header:{cwd:dir},append(){},snapshotEvents:()=>[]},cancel(){},followup(){},whenIdle:async()=>{},ctx:{systemPrompt:{section:()=>()=>{}},tools:{register:x=>{map.set(x.name,x);return()=>map.delete(x.name);},schemas:()=>[...map.values()],guard:()=>()=>{}}}};
    map.set('cua_driver_native__list_windows',{name:'cua_driver_native__list_windows'});await o.setup(a.ctx,a);return {agent:a,dispose:async()=>{}};
  }}};
  const app=createActivity(ctx,{home:dir,now:()=>clock});
  t.after(async()=>{await app.close();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true});});
  assert.equal((await app.execute(true)).kind,'complete');
  const file=path.join(dir,'nia-activity','provider-tools.json');
  const write=value=>fs.writeFileSync(file,JSON.stringify(value));
  const valid={at:clock,model:'offline',tools:[...map.keys()],additionalTools:[]};
  assert.equal(app.snapshot().capabilities.providerVerified,false);
  write({...valid,at:clock-1});assert.equal(app.snapshot().capabilities.providerVerified,false);
  write({...valid,model:'other'});assert.equal(app.snapshot().capabilities.providerVerified,false);
  write({...valid,tools:valid.tools.filter(x=>x!=='nia_activity_intent')});assert.equal(app.snapshot().capabilities.providerVerified,false);
  write(valid);assert.equal(app.snapshot().capabilities.providerVerified,true);assert.equal(app.snapshot().capabilities.topLevelVerified,true);
  write({...valid,tools:valid.tools.filter(x=>x!=='nia_activity_intent'),additionalTools:['nia_activity_intent']});
  assert.equal(app.snapshot().capabilities.providerVerified,true);assert.equal(app.snapshot().capabilities.topLevelVerified,false);
  fs.writeFileSync(file,'partial');assert.equal(app.snapshot().capabilities.providerVerified,false);
});
