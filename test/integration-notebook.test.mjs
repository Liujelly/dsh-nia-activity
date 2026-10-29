import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityNotebook } from '../lib/notebook.js';
import { attachNotebook, visibleNotebook } from '../lib/activity-tools.js';
import { Database } from '../../dsh-nia-memory/lib/store.js';
import { Memory } from '../../dsh-nia-memory/lib/core.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-notebook-integration-'));
  const db = new Database(path.join(dir, 'memory')), memory = new Memory(db);
  const notebook = new ActivityNotebook(path.join(dir, 'activity'), { now: () => 1000000 });
  const owner = { sessionId: 'owner', chatId: 'qq:100:private:200', personaId: 'whale', preview: false, actorIds: ['qq:100:200'], ownerActorId: 'qq:100:200', transport: 'qq' };
  const activity = { ...owner, sessionId: 'activity', chatId: 'local:activity', transport: 'activity' };
  memory.bind(owner); memory.bind(activity); memory.people('whale', [{ id: 'qq:100:200', name: '主人' }]);
  memory.ingest('owner', [{ id: 'conversation-1', actorId: 'qq:100:200', text: '最近在研究这个应用', occurredAt: 1000 }]);
  const cleanups = [];
  const mount = (binding, events = []) => {
    const tools = new Map();
    const agent = { session: { id: binding.sessionId, snapshotEvents: () => events }, ctx: {
      tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
      systemPrompt: { section: () => () => {}, context: () => () => {} },
    } };
    cleanups.push(attachNotebook(agent, binding, { memory, notebook, now: () => 1000000, config: () => ({ eventDebounceMinutes: 3 }), capabilities: () => ({}), active: () => true }));
    return { agent, tools, invoke: (name, args) => tools.get(name).execute(args) };
  };
  t.after(() => { for (const off of cleanups) off(); db.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  return { memory, notebook, owner, activity, mount };
}

test('actual execution receipt narrows a cross-chat intention to its executor without losing it', t => {
  const f = fixture(t), initial = f.mount(f.owner);
  const first = initial.invoke('nia_activity_intent', { title: '看看那个应用', evidenceIds: ['conversation-1'], requestId: 'first-idea' }).intent;
  const current = f.mount(f.activity, [
    { type: 'tool/call', data: { callId: 'real-1', name: 'cua_driver_native__list_apps' }, time: 900000 },
    { type: 'tool/result', data: { message: { source: { callId: 'real-1' }, content: [{ type: 'text', text: '应用列表已读取' }] } }, time: 900001 },
  ]);
  const completed = current.invoke('nia_activity_intent', { id: first.id, status: 'done', outcome: '已读到应用列表', callIds: ['real-1'] }).intent;
  assert.equal(completed.chatId, f.owner.chatId);
  assert.equal(completed.privateChatId, f.activity.chatId);
  assert.equal(completed.visibility, 'private');
  assert.deepEqual(visibleNotebook(f.notebook, f.owner, f.memory, { includeClosed: true }).intents, []);
  assert.equal(visibleNotebook(f.notebook, f.activity, f.memory, { includeClosed: true }).intents[0].id, first.id);
});

test('source privacy tightening removes a formerly visible intention and rejects later edits', t => {
  const f = fixture(t), initial = f.mount(f.owner), current = f.mount(f.activity);
  const first = initial.invoke('nia_activity_intent', { title: '稍后了解', evidenceIds: ['conversation-1'] }).intent;
  assert.equal(visibleNotebook(f.notebook, f.activity, f.memory).intents[0].id, first.id);
  f.memory.remember('owner', { text: '不向其他聊天传递这个话题', subjects: ['qq:100:200'], evidenceIds: ['conversation-1'], kind: 'event', status: 'reported', visibility: 'private' });
  assert.deepEqual(visibleNotebook(f.notebook, f.activity, f.memory).intents, []);
  assert.throws(() => current.invoke('nia_activity_intent', { id: first.id, reason: '不能绕过新范围' }), /原聊天/);
  assert.equal(visibleNotebook(f.notebook, f.owner, f.memory).intents[0].id, first.id);
});

test('missing receipts and queued activity-contact requests do not prove completion', t => {
  const f = fixture(t), current = f.mount(f.activity, [
    { type: 'tool/call', data: { callId: 'queued', name: 'nia_activity_contact' }, time: 900000 },
    { type: 'tool/result', data: { message: { source: { callId: 'queued' }, content: [{ type: 'text', text: '已排队' }] } }, time: 900001 },
  ]);
  assert.throws(() => current.invoke('nia_activity_intent', { title: '已经发出', status: 'done', evidenceIds: ['conversation-1'] }), /真实|实际回执/);
  assert.throws(() => current.invoke('nia_activity_intent', { title: '已经发出', status: 'done', callIds: ['queued'] }), /不等于已完成/);
  assert.throws(() => current.invoke('nia_activity_intent', { title: '已经发出', status: 'done', callIds: ['missing'] }), /真实回执/);
  assert.equal(f.notebook.list(f.activity).intents.length, 0);
});
