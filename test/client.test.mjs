import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {defaults} from '../lib/scheduler.js';

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function state(overrides = {}) {
  return {
    config:structuredClone(defaults), status:'运行中', sessionId:'offline-ui-session',
    nextAt:0, lastWake:0, count:0, history:[],
    notebook:{intents:[], places:[]}, lastRun:null, capabilities:null,
    ...overrides
  };
}

function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [];
  return [tree, ...(tree.children || []).flatMap(nodes)];
}

function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree !== 'object') return String(tree);
  if (tree.type === 'style') return '';
  return (tree.children || []).map(text).join(' ');
}

function one(tree, predicate, description) {
  const matches = nodes(tree).filter(predicate);
  assert.equal(matches.length, 1, 'Expected one ' + description);
  return matches[0];
}

function button(tree, label) {
  return one(tree, node => node.type === 'button' && text(node) === label, 'button ' + label);
}

function input(tree, label) {
  return one(tree, node => node.type === 'input' && node.props?.['aria-label'] === label, 'input ' + label);
}

function card(tree, label) {
  return one(tree, node => node.type === 'section' && node.children?.[0]?.type === 'h3' && text(node.children[0]) === label, 'card ' + label);
}

// A small hook runner executes the real panel and its real event handlers.
// Fetch, timers and the settings host are entirely in memory; no browser or DSH.
function mount(t, initialState) {
  let server = structuredClone(initialState), component, cursor = 0, timerId = 0, tree;
  const hooks = [], pendingEffects = [], timers = new Map(), requests = [];
  const React = {
    Fragment:'fragment',
    createElement:(type, props, ...children) => ({type, props:props || {}, children}),
    useState(initial) {
      const at = cursor++;
      if (!hooks[at]) hooks[at] = {kind:'state', value:typeof initial === 'function' ? initial() : initial};
      assert.equal(hooks[at].kind, 'state');
      return [hooks[at].value, value => {
        hooks[at].value = typeof value === 'function' ? value(hooks[at].value) : value;
      }];
    },
    useEffect(effect, deps) {
      const at = cursor++;
      if (hooks[at] && deps?.length === hooks[at].deps?.length && deps.every((value, i) => Object.is(value, hooks[at].deps[i]))) return;
      hooks[at]?.cleanup?.();
      hooks[at] = {kind:'effect', deps};
      pendingEffects.push(() => { hooks[at].cleanup = effect(); });
    }
  };
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET', body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({url, method, body, headers:options.headers});
    if (url === '/dsh-nia-activity/state' && method === 'GET') {
      const snapshot = structuredClone(server);
      return {ok:true, status:200, json:async () => snapshot};
    }
    if (url === '/dsh-nia-activity/config' && method === 'POST') {
      server.config = {...server.config, ...body};
      return {ok:true, status:200, json:async () => ({ok:true})};
    }
    if (url === '/dsh-nia-activity/intent' && method === 'POST') {
      const record = server.notebook.intents.find(item => item.id === body.id);
      assert.ok(record, 'Intent action must use a real displayed record');
      if (body.action === 'cancel') record.status = 'cancelled';
      else if (body.action === 'defer') record.nextAt = Date.now() + body.minutes * 60000;
      else assert.fail('Unexpected intent action');
      return {ok:true, status:200, json:async () => ({ok:true})};
    }
    assert.fail('Unexpected request; these tests must never wake an agent: ' + method + ' ' + url);
  };
  const sandbox = {
    fetch,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    window:{__ModuleLoader__:{load(entry) {
      assert.equal(entry.id, 'dsh-nia-activity');
      entry.factory(name => { assert.equal(name, 'react'); return React; }).apply({slots:{
        inject(_slot, callback) { callback(); },
        register(_settings, callback) { component = callback().type; }
      }});
    }}}
  };
  vm.runInNewContext(source, sandbox, {filename:'activity-client.js'});
  const render = () => {
    cursor = 0;
    tree = component();
    while (pendingEffects.length) pendingEffects.shift()();
    return tree;
  };
  render();
  t.after(() => { for (const hook of hooks) hook?.cleanup?.(); timers.clear(); });
  return {
    requests,
    get tree() { return tree; },
    get server() { return server; },
    async ready() { await new Promise(resolve => setImmediate(resolve)); return render(); },
    change(label, value) {
      const control = input(tree, label);
      assert.equal(!!control.props.disabled, false);
      control.props.onChange({target:control.props.type === 'checkbox' ? {checked:value} : {value}});
      return render();
    },
    async click(label, within = tree) {
      const control = button(within, label);
      assert.equal(!!control.props.disabled, false, label + ' should be enabled');
      await control.props.onClick();
      return render();
    },
    async poll() {
      const next = timers.entries().next().value;
      assert.ok(next, 'Polling timer should be scheduled');
      timers.delete(next[0]);
      await next[1]();
      return render();
    }
  };
}

test('settings render empty notebook and loading state without executing an activity', async t => {
  const ui = mount(t, state());
  assert.match(text(ui.tree), /读取中/);
  await ui.ready();
  assert.match(text(card(ui.tree, '想做的事')), /暂时没有待考虑的想法/);
  assert.match(text(card(ui.tree, '已认识的入口')), /尚未保存入口/);
  assert.match(text(card(ui.tree, '最近活动结果')), /尚未记录本轮结果/);
  assert.match(text(card(ui.tree, '工具状态')), /首次打开活动会话/);
  assert.equal(button(ui.tree, '保存设置').props.disabled, true);
  assert.ok(ui.requests.every(request => request.method === 'GET'));
});

test('settings render notebook data as text and intent controls only update their own record', async t => {
  const unsafeText = '<script>window.bad=true</script>';
  const ui = mount(t, state({notebook:{
    intents:[{id:'idea-1',title:unsafeText,reason:'研究这个应用',status:'planned',outcome:'尚未开始'}],
    places:[{id:'place-1',label:'资料网站',kind:'site',locator:'https://example.invalid/page',note:'以前读过的资料'}]
  }}));
  await ui.ready();
  assert.ok(text(card(ui.tree, '想做的事')).includes(unsafeText));
  assert.ok(text(card(ui.tree, '已认识的入口')).includes('https://example.invalid/page'));
  assert.equal(nodes(ui.tree).some(node => node.type === 'script' || Object.hasOwn(node.props, 'dangerouslySetInnerHTML')), false);
  await ui.click('一小时后再考虑', card(ui.tree, '想做的事'));
  assert.deepEqual(ui.requests.filter(request => request.method === 'POST').map(request => request.body), [
    {id:'idea-1',action:'defer',minutes:60}
  ]);
  assert.match(text(card(ui.tree, '想做的事')), /下次考虑/);
  await ui.click('不再考虑', card(ui.tree, '想做的事'));
  assert.deepEqual(ui.requests.filter(request => request.method === 'POST').map(request => request.body), [
    {id:'idea-1',action:'defer',minutes:60}, {id:'idea-1',action:'cancel'}
  ]);
  assert.equal(nodes(card(ui.tree, '想做的事')).filter(node => node.type === 'button').length, 0);
  for (const request of ui.requests.filter(request => request.method === 'POST')) {
    assert.equal(request.url, '/dsh-nia-activity/intent');
    assert.equal(request.headers['x-nia-activity'], '1');
    assert.equal(request.headers['content-type'], 'application/json');
  }
});

test('new settings serialize booleans and numbers, while polling and refresh preserve unsaved edits', async t => {
  const ui = mount(t, state());
  await ui.ready();
  ui.change('允许相关事件与到期想法唤醒', false);
  ui.change('事件等待时间（分钟）', '7');
  ui.change('每轮活动时间预算（分钟）', '12');
  ui.change('每轮工具调用预算', '25');
  assert.equal(button(ui.tree, '保存设置').props.disabled, false);
  ui.server.config.eventDebounceMinutes = 99;
  ui.server.notebook.intents.push({id:'new-event',title:'轮询带来的新想法',status:'idea'});
  await ui.poll();
  assert.equal(input(ui.tree, '事件等待时间（分钟）').props.value, '7');
  assert.equal(input(ui.tree, '允许相关事件与到期想法唤醒').props.checked, false);
  assert.match(text(card(ui.tree, '想做的事')), /轮询带来的新想法/);
  await ui.click('刷新状态');
  assert.equal(input(ui.tree, '事件等待时间（分钟）').props.value, '7');
  assert.equal(input(ui.tree, '每轮活动时间预算（分钟）').props.value, '12');
  assert.equal(input(ui.tree, '每轮工具调用预算').props.value, '25');
  assert.equal(input(ui.tree, '允许相关事件与到期想法唤醒').props.checked, false);
  await ui.click('保存设置');
  const saved = ui.requests.filter(request => request.url === '/dsh-nia-activity/config');
  assert.equal(saved.length, 1);
  assert.deepEqual({
    eventWakes:saved[0].body.eventWakes,
    eventDebounceMinutes:saved[0].body.eventDebounceMinutes,
    maxRunMinutes:saved[0].body.maxRunMinutes,
    maxToolCalls:saved[0].body.maxToolCalls
  }, {eventWakes:false,eventDebounceMinutes:7,maxRunMinutes:12,maxToolCalls:25});
  assert.deepEqual(saved[0].body.peakWindows, defaults.peakWindows);
  assert.deepEqual(saved[0].body.peakWeekdays, defaults.peakWeekdays);
  assert.equal(button(ui.tree, '保存设置').props.disabled, true);
  assert.match(text(ui.tree), /设置已保存/);
});

test('tool registration and request verification never stand in for successful execution', async t => {
  const ui = mount(t, state({capabilities:{
    registeredAt:1000, registeredToolsCount:108, desktopTools:['cua_driver_native__list_windows'],
    providerVerified:false, note:'仅包含工具名称'
  }}));
  await ui.ready();
  const unverified = text(card(ui.tree, '工具状态'));
  assert.match(unverified, /已登记 108 个工具/);
  assert.match(unverified, /尚未确认/);
  assert.doesNotMatch(unverified, /工具返回成功|执行成功|已发送消息/);
  ui.server.capabilities.providerVerified = true;
  await ui.poll();
  const verified = text(card(ui.tree, '工具状态'));
  assert.match(verified, /已核对.*请求/);
  assert.match(verified, /实际接收与执行仍需另看回执/);
  assert.doesNotMatch(verified, /工具返回成功|执行成功|已发送消息/);
  assert.match(text(card(ui.tree, '最近活动结果')), /尚未记录本轮结果/);
  assert.ok(ui.requests.every(request => request.method === 'GET'));
});
