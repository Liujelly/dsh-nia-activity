window.__ModuleLoader__.load({id:'dsh-nia-activity',factory:require=>{
const React=require('react');
  const CSS = `
  [data-nia-panel]{--n-bg:var(--dsw-alias-bg-layer-1,#fafaf9);--n-line:var(--dsw-alias-border-l2,#8885);--n-muted:var(--dsw-alias-label-tertiary,#888);--n-accent:var(--dsw-alias-state-business-primary,#168575);font:inherit;font-size:13px;line-height:1.65;color:inherit;max-width:920px;padding:8px 4px 28px;box-sizing:border-box}
  [data-nia-panel] *{box-sizing:border-box}[data-nia-panel] h2{font-size:21px;margin:0;font-weight:650}[data-nia-panel] h3{font-size:14px;margin:0 0 12px}[data-nia-panel] p{margin:6px 0}
  [data-nia-panel] .nia-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}[data-nia-panel] .nia-muted{color:var(--n-muted);font-size:12px}[data-nia-panel] .nia-card{border:1px solid var(--n-line);border-radius:10px;background:var(--n-bg);padding:16px;margin:12px 0}
  [data-nia-panel] button,[data-nia-panel] input,[data-nia-panel] textarea{font:inherit;color:inherit;border:1px solid var(--n-line);border-radius:6px;background:var(--n-bg);padding:7px 10px;min-height:34px;max-width:100%}[data-nia-panel] button{cursor:pointer}[data-nia-panel] button:hover{background:color-mix(in srgb,var(--n-accent) 8%,var(--n-bg))}[data-nia-panel] :focus-visible{outline:2px solid var(--n-accent);outline-offset:2px}[data-nia-panel] button:disabled{opacity:.5;cursor:default}
  [data-nia-panel] input:not([type=checkbox]),[data-nia-panel] textarea{width:100%}[data-nia-panel] input[type=checkbox]{min-height:auto;accent-color:var(--n-accent);margin:0 8px 0 0}[data-nia-panel] .nia-field{display:grid;grid-template-columns:minmax(140px, .8fr) minmax(200px,1.5fr);gap:18px;align-items:start;padding:10px 0;border-bottom:1px solid color-mix(in srgb,var(--n-line) 45%,transparent)}
  [data-nia-panel] .nia-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}[data-nia-panel] .nia-stack{display:grid;gap:8px}[data-nia-panel] .nia-tabs{display:flex;gap:4px;border-bottom:1px solid var(--n-line);padding-bottom:8px;flex-wrap:wrap}[data-nia-panel] .nia-tabs button{border-color:transparent;background:transparent}[data-nia-panel] .nia-tabs button[aria-selected=true]{background:color-mix(in srgb,var(--n-accent) 10%,transparent);color:inherit;font-weight:600;border-color:var(--n-line)}
  [data-nia-panel] .nia-save{position:sticky;bottom:0;border:1px solid var(--n-line);border-radius:8px;background:var(--n-bg);padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:3;box-shadow:0 -3px 12px #00000008}[data-nia-panel] .nia-primary{background:var(--n-accent);color:white;border-color:var(--n-accent)}[data-nia-panel] .nia-primary:hover{filter:brightness(.95)}
  [data-nia-panel] .nia-message{padding:9px 12px;border-left:3px solid var(--n-accent);background:color-mix(in srgb,var(--n-accent) 6%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}[data-nia-panel] [role=alert]{border-color:#c45b4e;color:#bb5147}[data-nia-panel] .nia-empty{padding:18px 0;color:var(--n-muted)}
  [data-nia-panel] .nia-picker{min-width:0}[data-nia-panel] .nia-picker>button{width:100%;text-align:left;display:flex;justify-content:space-between;gap:8px}[data-nia-panel] .nia-picker-list{border:1px solid var(--n-line);padding:8px;margin-top:5px;border-radius:8px;max-height:260px;overflow:auto;background:var(--n-bg)}[data-nia-panel] [role=option]{width:100%;display:block;text-align:left;border:0;white-space:normal;overflow-wrap:anywhere;margin-top:3px}[data-nia-panel] [role=option][aria-selected=true]{background:color-mix(in srgb,var(--n-accent) 12%,transparent)}
  [data-nia-panel] .nia-chip{font-size:11px;border:1px solid var(--n-line);padding:2px 7px;border-radius:5px;white-space:nowrap}[data-nia-panel] .nia-record{padding:12px 0;border-bottom:1px solid var(--n-line)}[data-nia-panel] pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:color-mix(in srgb,var(--n-line) 12%,transparent);padding:10px;border-radius:6px;max-height:320px;overflow:auto}[data-nia-panel] summary{cursor:pointer;padding:5px 0}[data-nia-panel] .nia-number{font-size:34px;font-weight:600;line-height:1.2}[data-nia-panel] .nia-metrics{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0}
  @media(max-width:620px){[data-nia-panel] .nia-field{grid-template-columns:1fr;gap:6px}[data-nia-panel] .nia-card{padding:12px}}`;
  const h = React.createElement;
  const card = (title, ...children) => h('section', {className:'nia-card'}, h('h3',null,title), ...children);
  const note = text => h('p',{className:'nia-muted'},text);
  const empty = text => h('div',{className:'nia-empty'},text);
  const fmt = at => at ? new Date(at).toLocaleString() : '未记录';
  const details = (title,value) => h('details',null,h('summary',null,title),h('pre',null,JSON.stringify(value,null,2)));
  function Picker({label, value, options, onChange, placeholder='请选择', emptyText='暂无可选项，请刷新后重试', disabled=false}) {
    const [open,setOpen] = React.useState(false), [query,setQuery] = React.useState('');
    const selected = options.find(o=>o.value===value);
    return h('div',{className:'nia-picker',onKeyDown:e=>{if(e.key==='Escape')setOpen(false);}},
      h('button',{type:'button','aria-label':label,'aria-expanded':open,'aria-haspopup':'listbox',disabled,onClick:()=>setOpen(!open)},h('span',null,selected?.label || value || placeholder),h('span',{'aria-hidden':true},open?'▴':'▾')),
      open?h('div',{className:'nia-picker-list'},h('input',{'aria-label':'搜索'+label,placeholder:'搜索…',value:query,onChange:e=>setQuery(e.target.value)}),
        h('div',{role:'listbox','aria-label':label},...options.filter(o=>(o.label+' '+o.value).toLowerCase().includes(query.toLowerCase())).map(o=>h('button',{type:'button',role:'option',key:o.value,'aria-selected':o.value===value,onClick:()=>{onChange(o.value);setOpen(false);setQuery('');}},o.label))),
        !options.length?empty(emptyText):null):null);
  }
  const field=(label,control,hint)=>h('div',{className:'nia-field'},h('div',null,h('strong',null,label),hint?note(hint):null),control);
  const tabs=(items,current,set)=>h('div',{className:'nia-tabs',role:'tablist'},...items.map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':current===id,onClick:()=>set(id)},label)));
  const message=(text,error=false)=>text?h('div',{className:'nia-message',role:error?'alert':'status'},text):null;
  const root=(name,...children)=>h('div',{'data-nia-panel':name},h('style',null,CSS),...children);
  const header=(title,subtitle,action)=>h('div',{className:'nia-head'},h('div',null,h('h2',null,title),note(subtitle)),action);
  async function request(base,path,body) {
    const response=await fetch(base+'/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json',['x-nia-'+base.split('-').at(-1)]:'1'},body:JSON.stringify(body)});
    let data; try {data=await response.json();} catch {throw Error('服务未返回有效数据（HTTP '+response.status+'），请检查插件是否启用。');}
    if(!response.ok || data.ok===false)throw Error(data.error || '请求失败（HTTP '+response.status+'）'); return data;
  }
  const api=(p,b)=>request('/dsh-nia-activity',p,b);
  function Panel(){
    const [data,setData]=React.useState(null),[form,setForm]=React.useState(null),[saved,setSaved]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
    const toForm=c=>({...c,peakWindows:c.peakWindows.map(w=>w.join('-')).join(', '),peakWeekdays:c.peakWeekdays.join(', ')});
    const refresh=async(reset=false)=>{const d=await api('state');setData(d);if(reset){const f=toForm(d.config);setForm(f);setSaved(f);}};
    React.useEffect(()=>{let active=true,timer;const poll=async()=>{try{const d=await api('state');if(active){setData(d);setForm(f=>{if(f)return f;const n=toForm(d.config);setSaved(n);return n;});}}catch(e){if(active)setError(e.message);}finally{if(active)timer=setTimeout(poll,3000);}};poll();return()=>{active=false;clearTimeout(timer);};},[]);
    const act=async(fn,msg,reset=false)=>{setBusy(true);setError('');setNotice('');try{await fn();await refresh(reset);setNotice(msg);}catch(e){setError(e.message);}finally{setBusy(false);}};
    if(!form)return root('activity',header('自主活动','读取中'),message(error,true));
    const edit=(k,v)=>setForm(f=>({...f,[k]:v}));const dirty=JSON.stringify(form)!==JSON.stringify(saved);
    const number=(key,label,hint)=>field(label,h('input',{type:'number','aria-label':label,value:form[key],disabled:busy,onChange:e=>edit(key,e.target.value)}),hint);
    const toggle=(key,label,hint)=>field(label,h('label',null,h('input',{type:'checkbox','aria-label':label,checked:!!form[key],disabled:busy,onChange:e=>edit(key,e.target.checked)}),'启用'),hint);
    const save=()=>act(()=>{const x={...form};for(const k of ['minCheckMinutes','maxCheckMinutes','peakChance','offpeakChance','missBonus','bonusCap','cooldownMinutes','dailyLimit','nearMinutes','farMinutes','quietActivityStart','quietActivityEnd','quietQQStart','quietQQEnd']){if(String(x[k]).trim()==='')throw Error('请填写全部数值');x[k]=Number(x[k]);}x.peakWindows=x.peakWindows.trim()?x.peakWindows.split(/[,，]/).map(s=>{const m=s.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);if(!m)throw Error('峰时时段请按 9-12, 14-18 格式填写');return [+m[1],+m[2]];}):[];x.peakWeekdays=x.peakWeekdays.trim()?x.peakWeekdays.split(/[,，]/).map(s=>{if(!/^\s*[0-6]\s*$/.test(s))throw Error('峰时星期请填写 0 到 6');return Number(s);}):[];return api('config',x);},'设置已保存',true);
    return root('activity',header('自主活动','0.1.0 · '+data.status,h('button',{disabled:busy,onClick:()=>act(()=>refresh(true),'已刷新',true)},'刷新状态')),
      message(error,true),message(notice),
      card('活动状态',note('使用独立的角色工作会话。唤醒后可以继续自己的事、联系熟人，或者选择休息。'),note('下次随机检查：'+fmt(data.nextAt)+' · 最近唤醒：'+fmt(data.lastWake)+' · 今日 '+data.count+' 次'),note('自主活动会话：'+data.sessionId),
        h('div',{className:'nia-row'},h('button',{disabled:busy||dirty,onClick:()=>act(async()=>{const r=await api('run',{action:'test'});if(!['complete','dry-run'].includes(r.result?.kind))throw Error('本次未运行，请查看活动状态和记录');},form.dryRun?'已演练，查看记录':'已执行一次，查看记录')},form.dryRun?'演练一次':'唤醒一次'),data.status==='结果待核实'?h('button',{disabled:busy,onClick:()=>act(()=>api('run',{action:'acknowledge'}),'已停止重放，后续按计划运行')},'已核实，不重放'):null)),
      card('运行方式',toggle('enabled','启用自主活动','DSH 运行时才会检查。暂停后当前操作正常结束。'),toggle('dryRun','仅演练','随机命中只记录，不调用模型。'),number('dailyLimit','每天自动活动上限','默认 8 次，唤醒即计数；手动唤醒不受此限制。'),number('cooldownMinutes','活动冷却（分钟）','默认 30。'),number('minCheckMinutes','最短检查间隔（分钟）','默认 20；每次重新随机安排。'),number('maxCheckMinutes','最长检查间隔（分钟）','默认 40。')),
      card('峰谷与随机机会',number('peakChance','峰时基础命中线（%）','默认 20。'),number('offpeakChance','谷时基础命中线（%）','默认 60。'),number('missBonus','未命中加成（百分点）','默认 10；0 关闭。'),number('bonusCap','未命中加成上限','默认 40。'),number('nearMinutes','最近聊天阈值（分钟）','刚聊天时降低唤醒机会。'),number('farMinutes','长时间未聊天阈值（分钟）','较久没聊天时增加唤醒机会，不要求发消息。'),
        field('峰时时段',h('input',{'aria-label':'峰时时段',value:form.peakWindows,onChange:e=>edit('peakWindows',e.target.value)}),'按小时填写，例如 9-12, 14-18；留空表示没有峰时。'),field('峰时星期',h('input',{'aria-label':'峰时星期',value:form.peakWeekdays,onChange:e=>edit('peakWeekdays',e.target.value)}),'1 到 6 表示周一至周六，0 表示周日；例如 1, 2, 3, 4, 5。')),
      card('安静时段',note('按本机时间。起止相同代表不设该安静时段；主动 QQ 限制独立于自主活动。'),number('quietActivityStart','活动安静开始（小时）'),number('quietActivityEnd','活动安静结束（小时）'),number('quietQQStart','主动 QQ 安静开始（小时）'),number('quietQQEnd','主动 QQ 安静结束（小时）')),
      card('最近记录',...(data.history||[]).slice().reverse().map((x,i)=>h('div',{className:'nia-record',key:i},h('strong',null,fmt(x.at)),note(x.message))),!data.history?.length?empty('暂无记录'):null),
      h('div',{className:'nia-save'},h('span',{style:{flex:1}},busy?'处理中…':dirty?'有未保存的修改':'设置已同步'),h('button',{disabled:busy||!dirty,onClick:()=>setForm(saved)},'撤销修改'),h('button',{className:'nia-primary',disabled:busy||!dirty,onClick:save},'保存设置')));
  }

 return {inject:['slots'],apply(ctx){const slots=ctx.get?.('slots')||ctx.slots;slots.inject('settings.section',()=>slots.register({name:'settings.section',id:'nia-activity',order:44,label:'自主活动'},()=>h(Panel)));}};
}});
