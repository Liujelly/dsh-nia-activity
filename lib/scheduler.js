export const defaults = { enabled:true, dryRun:false, minCheckMinutes:20, maxCheckMinutes:40,
  peakChance:20, offpeakChance:60, missBonus:10, bonusCap:40, cooldownMinutes:30,
  dailyLimit:8, nearMinutes:20, farMinutes:360, quietActivityStart:1, quietActivityEnd:8, quietQQStart:23, quietQQEnd:8,
  peakWindows:[[9,12],[14,18]], peakWeekdays:[1,2,3,4,5] };
export function validate(input, previous=defaults) {
  const c={...previous};
  for(const k of ['enabled','dryRun'])if(k in input){if(typeof input[k]!=='boolean')throw Error(k+' 必须是开关');c[k]=input[k];}
  for(const [k,lo,hi] of [['minCheckMinutes',1,1440],['maxCheckMinutes',1,1440],['peakChance',0,100],['offpeakChance',0,100],['missBonus',0,100],['bonusCap',0,100],['cooldownMinutes',0,1440],['dailyLimit',1,100],['nearMinutes',0,1440],['farMinutes',1,10080],['quietActivityStart',0,23],['quietActivityEnd',0,23],['quietQQStart',0,23],['quietQQEnd',0,23]])if(k in input){if(!Number.isInteger(input[k])||input[k]<lo||input[k]>hi)throw Error(k+' 数值超出范围');c[k]=input[k];}
  if(c.minCheckMinutes>c.maxCheckMinutes)throw Error('最短检查间隔不能大于最长间隔');
  if('peakWindows' in input){if(!Array.isArray(input.peakWindows)||input.peakWindows.length>8||input.peakWindows.some(w=>!Array.isArray(w)||w.length!==2||!w.every(Number.isInteger)||w[0]<0||w[1]>24||w[0]>=w[1]))throw Error('峰时时段格式不正确');c.peakWindows=input.peakWindows.map(w=>[...w]);}
  if('peakWeekdays' in input){if(!Array.isArray(input.peakWeekdays)||input.peakWeekdays.some(x=>!Number.isInteger(x)||x<0||x>6))throw Error('峰时工作日格式不正确');c.peakWeekdays=[...new Set(input.peakWeekdays)];}
  return c;
}
export const quiet=(hour,start,end)=>start!==end&&(start<end?hour>=start&&hour<end:hour>=start||hour<end);
export function assess(c, state, now, random=Math.random) {
  const d=new Date(now), day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  if(!c.enabled)return {kind:'disabled'};
  if(quiet(d.getHours(),c.quietActivityStart,c.quietActivityEnd))return {kind:'quiet'};
  if((state.day===day?state.count:0)>=c.dailyLimit)return {kind:'limit'};
  if(state.lastWake&&now-state.lastWake<c.cooldownMinutes*60000)return {kind:'cooldown'};
  const peak=c.peakWeekdays.includes(d.getDay())&&c.peakWindows.some(([a,b])=>d.getHours()>=a&&d.getHours()<b);
  const elapsed=state.lastChat?Math.max(0,(now-state.lastChat)/60000):null;
  const factor=elapsed===null?1:elapsed<c.nearMinutes?0.15:elapsed>c.farMinutes?1.5:1;
  const chance=Math.min(100,(peak?c.peakChance:c.offpeakChance)*factor+Math.min(c.bonusCap,(state.misses||0)*c.missBonus));
  const roll=random()*100;return {kind:roll<chance?'hit':'miss',peak,chance,roll,day};
}
export function nextCheck(c,now,random=Math.random){return now+Math.round((c.minCheckMinutes+random()*(c.maxCheckMinutes-c.minCheckMinutes))*60000);}
