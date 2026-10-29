import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityNotebook } from '../lib/notebook.js';
import { attachNotebook, inspectCapabilities } from '../lib/activity-tools.js';
import { Database } from '../../dsh-nia-memory/lib/store.js';
import { Memory } from '../../dsh-nia-memory/lib/core.js';
import { createAgentExtensions } from '../../dsh-nia-memory/lib/activity-context.js';

const NOW = new Date('2026-10-29T04:00:00Z').getTime();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-activity-tools-'));
  const db = new Database(path.join(dir, 'memory')), memory = new Memory(db);
  const notebook = new ActivityNotebook(path.join(dir, 'activity'), { now: () => NOW });
  const extensions = createAgentExtensions(), agents = new Map();
  const bindings = {
    owner: { sessionId: 'owner-session', personaId: 'nia', chatId: 'qq:100:private:200', preview: false, actorIds: ['qq:100:200'], ownerActorId: 'qq:100:200', transport: 'qq' },
    activity: { sessionId: 'activity-session', personaId: 'nia', chatId: 'local:activity', preview: false, actorIds: ['qq:100:200'], ownerActorId: 'qq:100:200', transport: 'activity' },
    preview: { sessionId: 'preview-session', personaId: 'nia', chatId: 'preview:chat', preview: true, actorIds: ['qq:100:200'], ownerActorId: 'qq:100:200', transport: 'qq' }
  };
  memory.people('nia', [{ id: 'qq:100:200', name: '用户' }]);
  let syncs = 0;
  for (const binding of Object.values(bindings)) {
    memory.bind(binding);
    const tools = new Map(), sections = new Map(), contexts = new Map(), events = [], effects = [];
    const register = collection => value => { collection.set(value.name, value); return () => collection.delete(value.name); };
    const a = { session: { id: binding.sessionId, snapshotEvents: () => events }, ctx: {
      tools: { register: register(tools), schemas: () => [...tools.values()].map(({ name }) => ({ name })) },
      systemPrompt: { section: register(sections), context: register(contexts) },
      effect: fn => { const off = fn(); effects.push(off); return off; }
    }, tools, sections, contexts, events, effects };
    agents.set(binding.sessionId, a);
    extensions.track(a, binding, () => syncs++);
  }
  const off = extensions.register((agent, binding, { sync }) => attachNotebook(agent, binding, {
    memory, notebook, now: () => NOW, config: () => ({ eventDebounceMinutes: 2 }),
    capabilities: a => inspectCapabilities(a, NOW), active: () => true, sync
  }));
  const agent = name => agents.get(bindings[name].sessionId);
  const invoke = (name, tool, args = {}) => agent(name).tools.get(tool).execute(args);
  const message = (id, text, where = 'owner') => memory.ingest(bindings[where].sessionId,
    [{ id, actorId: 'qq:100:200', text, occurredAt: NOW - 1000 }]);
  const result = (callId, name, payload, { where = 'activity', failed = false } = {}) => {
    agent(where).events.push({ type: 'tool/call', time: NOW, data: { callId, name } },
      { type: 'tool/result', time: NOW + 1, data: { message: { source: { callId }, isError: failed,
        content: [{ type: 'text', text: JSON.stringify(payload) }] } } });
  };
  t.after(() => {
    off(); extensions.close(); for (const a of agents.values()) for (const dispose of a.effects.reverse()) dispose?.();
    db.close(); assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, { recursive: true });
  });
  return { memory, notebook, bindings, agents, agent, invoke, message, result, off, syncs: () => syncs };
}

test('late memory extension mounts notebook tools once in existing chats and saves a deferred idea', t => {
  const f = fixture(t);
  f.message('owner-codex', '最近常和 Codex 聊天');
  assert.ok(f.agent('owner').tools.has('nia_activity_intent'));
  const first = f.invoke('owner', 'nia_activity_intent', { title: '想了解 Codex', reason: '用户提到过这个应用',
    evidenceIds: ['owner-codex'], subjects: ['qq:100:200'], afterMinutes: 10, status: 'planned', requestId: 'idea-codex' });
  assert.equal(first.intent.status, 'planned'); assert.equal(first.intent.nextAt, NOW + 600000);
  const listed = f.invoke('activity', 'nia_activity_notebook');
  assert.equal(listed.notebook.intents.length, 1); assert.equal(listed.notebook.intents[0].id, first.intent.id);
  assert.ok(f.syncs() >= 2);
  assert.match(f.agent('owner').contexts.get('nia-activity:notebook').text(), /想了解 Codex/);
  f.off(); assert.equal(f.agent('owner').tools.has('nia_activity_intent'), false);
  assert.equal(f.agent('activity').contexts.has('nia-activity:notebook'), false);
});

test('notebook tools reject untrusted scope, unknown people, invalid times and absent or preview evidence', t => {
  const f = fixture(t);
  f.message('preview-message', '预演记录', 'preview');
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'scope', personaId: 'other' }), /参数/);
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'unknown', subjects: ['qq:100:999'] }), /身份/);
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'bad', afterMinutes: 5, nextAt: NOW }), /只能选一个/);
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'bad', afterMinutes: -1 }), /时间/);
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'unknown evidence', evidenceIds: ['not-found'] }), /来源事件/);
  assert.throws(() => f.invoke('owner', 'nia_activity_intent', { title: 'preview evidence', evidenceIds: ['preview-message'] }), /预演/);
  assert.throws(() => f.invoke('activity', 'nia_activity_place', { label: '没有来源', kind: 'app', locator: 'C:/fake/app.exe' }), /引用|来源/);
});

test('queued contacts and internal bookkeeping cannot prove completed external actions', t => {
  const f = fixture(t);
  f.result('contact-private', 'nia_qq_contact', { status: 'pending', instruction: '尚未发送' });
  f.result('contact-group', 'nia_qq_group_contact', { status: 'pending', instruction: '目标群稍后决定' });
  f.result('remember', 'nia_remember', { saved: true, id: 'memory-1' });
  f.result('intent', 'nia_activity_intent', { intent: { status: 'planned' } });
  for (const callId of ['contact-private', 'contact-group', 'remember', 'intent']) {
    assert.throws(() => f.invoke('activity', 'nia_activity_intent', { title: '已经发出了', status: 'done', callIds: [callId] }), undefined, callId);
  }
  assert.equal(f.invoke('activity', 'nia_activity_notebook', { includeClosed: true }).notebook.intents.length, 0);
});

test('successful external tool results can record a private outcome while failed or nonexistent receipts cannot', t => {
  const f = fixture(t);
  f.result('read-success', 'cua_driver_native__get_window_state', { title: 'Codex', ready: true });
  f.result('read-failure', 'cua_driver_native__get_window_state', { error: 'window disappeared' }, { failed: true });
  assert.throws(() => f.invoke('activity', 'nia_activity_intent', { title: '看到了窗口', status: 'done', callIds: ['missing'] }), /回执/);
  assert.throws(() => f.invoke('activity', 'nia_activity_intent', { title: '看到了窗口', status: 'done', callIds: ['read-failure'] }), /成功|完成/);
  const done = f.invoke('activity', 'nia_activity_intent', { title: '确认窗口已打开', status: 'done', callIds: ['read-success'], outcome: '实际窗口回执显示 Codex 标题' }).intent;
  assert.equal(done.visibility, 'private'); assert.equal(done.status, 'done'); assert.equal(done.evidenceIds.length, 1);
  const own = f.invoke('activity', 'nia_activity_notebook', { includeClosed: true });
  assert.ok(own.notebook.intents.some(x => x.id === done.id));
  assert.equal(f.invoke('owner', 'nia_activity_notebook', { includeClosed: true }).notebook.intents.length, 0);
});

test('a source later made private removes cross-chat ideas and places and blocks updates', t => {
  const f = fixture(t);
  f.message('source', '我使用的应用在 C:/Example/app.exe');
  const memory = f.memory.remember(f.bindings.owner.sessionId, { text: '用户提供的应用入口', kind: 'fact', status: 'reported',
    subjects: ['qq:100:200'], evidenceIds: ['source'], visibility: 'internal' });
  const intent = f.invoke('owner', 'nia_activity_intent', { title: '看看这个应用', evidenceIds: ['source'] }).intent;
  const place = f.invoke('owner', 'nia_activity_place', { label: '用户提到的应用', kind: 'app', locator: 'C:/Example/app.exe', evidenceIds: ['source'] }).place;
  assert.equal(f.invoke('activity', 'nia_activity_notebook').notebook.intents.length, 1);
  f.memory.edit(memory.id, 'private');
  const hidden = f.invoke('activity', 'nia_activity_notebook').notebook;
  assert.equal(hidden.intents.length, 0); assert.equal(hidden.places.length, 0);
  assert.throws(() => f.invoke('activity', 'nia_activity_intent', { id: intent.id, status: 'cancelled' }), /原聊天|不可见/);
  assert.throws(() => f.invoke('activity', 'nia_activity_place', { id: place.id, label: '换名字' }), /原聊天|不可见/);
  assert.equal(f.invoke('owner', 'nia_activity_notebook').notebook.intents.length, 1);
});

test('cross-chat progress with an activity-private receipt stays visible to the writer and retains original provenance', t => {
  const f = fixture(t);
  f.message('owner-app', '我最近在用 Codex');
  const idea = f.invoke('owner', 'nia_activity_intent', { title: '确认 Codex 窗口', evidenceIds: ['owner-app'] }).intent;
  f.result('inspect-app', 'cua_driver_native__get_window_state', { title: 'Codex' });
  const updated = f.invoke('activity', 'nia_activity_intent', { id: idea.id, status: 'done', outcome: '已确认窗口', callIds: ['inspect-app'] }).intent;
  assert.equal(updated.chatId, f.bindings.owner.chatId);
  assert.equal(updated.visibility, 'private');
  assert.ok(f.invoke('activity', 'nia_activity_notebook', { includeClosed: true }).notebook.intents.some(x => x.id === idea.id));
  assert.ok(!f.invoke('owner', 'nia_activity_notebook', { includeClosed: true }).notebook.intents.some(x => x.id === idea.id));
});

test('capability inspection reports registry evidence without claiming provider verification', t => {
  const f = fixture(t);
  f.agent('activity').ctx.tools.register({ name: 'cua_driver_native__get_window_state' });
  const report = f.invoke('activity', 'nia_activity_capabilities');
  assert.equal(report.source, 'runtime-registry'); assert.equal(report.providerVerified, false);
  assert.ok(report.desktopTools.includes('cua_driver_native__get_window_state'));
  assert.equal(f.agent('activity').events.length, 0, 'diagnostics must not call the desktop');
});
