import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityNotebook } from '../lib/notebook.js';

const owner = { sessionId: 'owner-chat', chatId: 'qq:private:owner', personaId: 'whale', preview: false };
const activity = { ...owner, sessionId: 'activity-session', chatId: 'local:activity' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-notebook-test-'));
  let clock = 1000;
  const options = { now: () => clock };
  const book = new ActivityNotebook(dir, options);
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, book, options, file: path.join(dir, 'notebook.json'), setTime: value => { clock = value; } };
}

test('intentions survive restart with their origins and can be continued from another visible session', t => {
  const f = fixture(t);
  const idea = f.book.intent(owner, { title: '了解那个 Codex', reason: '上次聊到了它', subjects: ['self'], evidenceIds: ['event-1'], requestId: 'save-1', nextAt: 5000 });
  const reopened = new ActivityNotebook(f.dir, f.options);
  assert.equal(reopened.list(activity).intents[0].id, idea.id);
  f.setTime(2000);
  const planned = reopened.intent(activity, { id: idea.id, status: 'planned' });
  assert.equal(planned.sessionId, owner.sessionId); assert.equal(planned.chatId, owner.chatId);
  assert.equal(planned.createdAt, 1000); assert.equal(planned.updatedAt, 2000);
  assert.equal(planned.title, idea.title); assert.equal(planned.requestId, 'save-1');
  assert.deepEqual(planned.evidenceIds, ['event-1']);
});

test('private sources, other personas and preview sessions remain isolated for reads and edits', t => {
  const { book } = fixture(t);
  const secret = book.intent(owner, { title: '私下的想法', visibility: 'private' });
  const place = book.place(owner, { label: '私下入口', kind: 'chat', locator: 'verified-session', visibility: 'private' });
  const visible = book.intent(owner, { title: '可以内部想起的事' });
  assert.deepEqual(book.list(activity).intents.map(e => e.id), [visible.id]);
  assert.equal(book.list(activity).places.length, 0);
  for (const b of [{ ...owner, personaId: 'other' }, { ...owner, preview: true }]) {
    assert.deepEqual(book.list(b), { intents: [], places: [] });
    assert.throws(() => book.intent(b, { id: visible.id, title: '越界修改' }), /范围/);
  }
  assert.throws(() => book.intent(activity, { id: secret.id, status: 'planned' }), /范围/);
  assert.throws(() => book.place(activity, { id: place.id, note: '越界修改' }), /范围/);
  assert.throws(() => book.intent(owner, { id: secret.id, visibility: 'internal' }), /扩大/);
  assert.throws(() => book.place(owner, { id: place.id, visibility: 'internal' }), /扩大/);
});

test('request idempotency survives restart and cannot merge unrelated origins or overwrite prior intent', t => {
  const f = fixture(t);
  const first = f.book.intent(owner, { title: '第一件事', requestId: 'req-1' });
  const second = f.book.intent(owner, { title: '第二件事', requestId: 'req-2' });
  const reopened = new ActivityNotebook(f.dir, f.options);
  assert.deepEqual(reopened.intent(owner, { title: '重试时不同的文字', requestId: 'req-1' }), first);
  assert.equal(reopened.list(owner).intents.length, 2);
  assert.throws(() => reopened.intent(owner, { id: second.id, requestId: 'req-1' }), /其他想法/);
  assert.throws(() => reopened.intent(owner, { id: first.id, requestId: 'req-3' }), /请求 ID/);
  assert.notEqual(reopened.intent(activity, { title: '另一个来源', requestId: 'req-1' }).id, first.id);
});

test('due reminders are consumed once after acceptance; future and closed entries are preserved', t => {
  const { book } = fixture(t);
  const due = book.intent(owner, { title: '到时再看', nextAt: 2000, status: 'planned' });
  const future = book.intent(owner, { title: '明天再看', nextAt: 8000 });
  const waiting = book.intent(owner, { title: '等回复', status: 'waiting' });
  const closed = book.intent(owner, { title: '已经取消', status: 'cancelled', nextAt: 1500 });
  assert.deepEqual(book.due(activity, 2000).map(e => e.id), [due.id]);
  assert.deepEqual(book.markConsidered([due.id, future.id, waiting.id, closed.id], 2000).sort(), [due.id, waiting.id].sort());
  assert.deepEqual(book.due(activity, 2000), []);
  assert.deepEqual(book.markConsidered([due.id, waiting.id], 2000), []);
  const all = book.list(owner, { includeClosed: true }).intents;
  assert.equal(all.find(e => e.id === due.id).status, 'planned');
  assert.equal(all.find(e => e.id === due.id).nextAt, null);
  assert.equal(all.find(e => e.id === due.id).lastConsideredAt, 2000);
  assert.equal(all.find(e => e.id === waiting.id).lastConsideredAt, 2000);
  assert.equal(all.find(e => e.id === future.id).nextAt, 8000);
  assert.equal(all.find(e => e.id === future.id).lastConsideredAt, null);
  assert.equal(all.find(e => e.id === closed.id).nextAt, null);
  assert.deepEqual(book.markConsidered([waiting.id], 3000), [waiting.id]);
});

test('closing or cancelling an intent removes its reminder but retains the record', t => {
  const { book } = fixture(t);
  const idea = book.intent(owner, { title: '试试游戏', nextAt: 2000 });
  const finished = book.intent(activity, { id: idea.id, status: 'done', outcome: '自己决定到这里结束', evidenceIds: ['result-1'] });
  assert.equal(finished.nextAt, null); assert.equal(book.list(owner).intents.length, 0);
  assert.equal(book.list(owner, { includeClosed: true }).intents[0].outcome, finished.outcome);
  const revived = book.intent(activity, { id: idea.id, status: 'waiting', nextAt: 4000 });
  assert.equal(revived.status, 'waiting'); assert.equal(book.due(activity, 4000)[0].id, idea.id);
  book.intent(activity, { id: idea.id, status: 'cancelled' });
  assert.deepEqual(book.due(activity, 9000), []);
});

test('known places retain verified location data without executing anything and deduplicate repeated discovery', t => {
  const { book } = fixture(t);
  const original = book.place(owner, { label: 'Codex', kind: 'app', locator: 'C:/Apps/Codex.exe', note: '再次使用前核对窗口', evidenceIds: ['tool-1'] });
  const again = book.place(owner, { label: 'Codex 桌面', kind: 'app', locator: 'C:/Apps/Codex.exe' });
  assert.equal(original.id, again.id); assert.equal(book.list(owner).places.length, 1);
  const changed = book.place(activity, { id: original.id, note: '最近确认过' });
  assert.equal(changed.chatId, owner.chatId); assert.deepEqual(changed.evidenceIds, ['tool-1']);
  assert.equal(changed.locator, 'C:/Apps/Codex.exe');
});

test('strict input validation rejects scope injection, malformed fields and unbounded content before changing disk', t => {
  const f = fixture(t);
  const idea = f.book.intent(owner, { title: '原条目' });
  const before = fs.readFileSync(f.file, 'utf8');
  for (const args of [
    { title: 'x', personaId: 'other' }, { title: 'x', chatId: 'other' }, { title: 'x', preview: true },
    { title: 'x', createdAt: 1 }, { title: '' }, { title: 'x'.repeat(121) }, { title: 'x', reason: 'x'.repeat(601) },
    { title: 'x', nextAt: -1 }, { title: 'x', nextAt: Infinity }, { title: 'x', nextAt: '1000' },
    { title: 'x', status: 'executing' }, { title: 'x', visibility: 'public' }, { title: 'x', subjects: ['__proto__'] },
    { title: 'x', evidenceIds: ['x'.repeat(161)] }, { title: 'x', requestId: 'a/b' }, { id: idea.id, outcome: 'x'.repeat(1001) },
  ]) assert.throws(() => f.book.intent(owner, args));
  for (const args of [
    { label: 'a', locator: 'b', kind: 'shell' }, { label: 'a', locator: '', kind: 'app' },
    { label: 'a', locator: 'b', kind: 'app', sessionId: 'forged' },
    { label: 'a', locator: 'b'.repeat(1501), kind: 'app' },
  ]) assert.throws(() => f.book.place(owner, args));
  assert.throws(() => f.book.intent({ ...owner, preview: 'false' }, { title: 'x' }));
  assert.throws(() => f.book.list(owner, { limit: 101 }));
  assert.throws(() => f.book.list(owner, { includeClosed: 'yes' }));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('returned records are defensive copies', t => {
  const { book } = fixture(t);
  const entry = book.intent(owner, { title: '保留', subjects: ['self'], nextAt: 1000 });
  entry.title = '改写'; entry.subjects.push('other');
  const listed = book.list(owner); listed.intents[0].subjects.push('another'); listed.intents.length = 0;
  const due = book.due(owner, 1000); due[0].title = '再改写';
  assert.equal(book.list(owner).intents[0].title, '保留');
  assert.deepEqual(book.list(owner).intents[0].subjects, ['self']);
});

test('corrupt or unsupported stores fail without overwriting the original bytes', t => {
  const f = fixture(t);
  for (const bad of ['{broken', JSON.stringify({ version: 2, intents: [], places: [] }), JSON.stringify({ version: 1, intents: [{}], places: [] })]) {
    fs.writeFileSync(f.file, bad);
    assert.throws(() => new ActivityNotebook(f.dir), /无效/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), bad);
  }
});

test('a second writer or external file change is detected before any overwrite', t => {
  const f = fixture(t), other = new ActivityNotebook(f.dir, f.options);
  f.book.intent(owner, { title: '第一份写入' });
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => other.intent(owner, { title: '过期写入' }), /其他进程/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(other.list(owner).intents.length, 0);
  assert.deepEqual(fs.readdirSync(f.dir), ['notebook.json']);
});

test('scope quotas reject additions without silently pruning existing ideas; closing makes room', t => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) f.book.intent(owner, { title: '想法 ' + i });
  assert.equal(f.book.list(owner, { limit: 100 }).intents.length, 100);
  assert.throws(() => f.book.intent(owner, { title: '第 101 个' }), /100/);
  const first = f.book.list(owner, { limit: 100 }).intents[0];
  f.book.intent(owner, { id: first.id, status: 'cancelled' });
  f.book.intent(owner, { title: '新位置' });
  assert.equal(f.book.list(owner, { limit: 100 }).intents.length, 100);
  const stored = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(stored.intents.length, 101); assert.equal(stored.intents.find(e => e.id === first.id).status, 'cancelled');
  assert.equal(new ActivityNotebook(f.dir).list(owner, { limit: 100 }).intents.length, 100);
});

test('entry validation on restore rejects duplicate IDs and malformed reminders', t => {
  const f = fixture(t);
  f.book.intent(owner, { title: '原始' });
  const valid = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  const duplicate = structuredClone(valid); duplicate.intents.push(structuredClone(duplicate.intents[0]));
  fs.writeFileSync(f.file, JSON.stringify(duplicate)); assert.throws(() => new ActivityNotebook(f.dir), /重复 ID/);
  const malformed = structuredClone(valid); malformed.intents[0].nextAt = 'tomorrow';
  fs.writeFileSync(f.file, JSON.stringify(malformed)); assert.throws(() => new ActivityNotebook(f.dir), /时间/);
});

test('single-record lookup includes closed entries but never bypasses visibility', t => {
  const { book } = fixture(t);
  const closed = book.intent(owner, { title: '结束的事', status: 'done' });
  const secret = book.place(owner, { label: '私密入口', kind: 'chat', locator: 'private-chat', visibility: 'private' });
  assert.equal(book.get(activity, closed.id).status, 'done');
  assert.equal(book.get(activity, secret.id), null);
  assert.equal(book.get(owner, 'intent-does-not-exist'), null);
  const copy = book.get(owner, closed.id); copy.title = '不可写入';
  assert.equal(book.get(owner, closed.id).title, '结束的事');
});

test('cross-chat execution may narrow a shared idea to the executor without changing its origin', t => {
  const f = fixture(t);
  const idea = f.book.intent(owner, { title: '探索 Codex', requestId: 'origin-request', evidenceIds: ['owner-msg'] });
  const entry = f.book.intent(activity, { id: idea.id, status: 'done', visibility: 'private', evidenceIds: ['owner-msg', 'private-result'], outcome: '只在执行环境保留的结果' });
  assert.equal(entry.chatId, owner.chatId); assert.equal(entry.sessionId, owner.sessionId);
  assert.equal(entry.privateChatId, activity.chatId);
  assert.equal(f.book.get(owner, idea.id), null); assert.equal(f.book.get(activity, idea.id).outcome, entry.outcome);
  assert.throws(() => f.book.intent(owner, { title: '重试', requestId: 'origin-request' }), /不可见/);
  assert.throws(() => f.book.intent(owner, { id: idea.id, title: '不能再修改' }), /范围/);
  assert.throws(() => f.book.intent(activity, { id: idea.id, visibility: 'internal' }), /扩大/);
  assert.throws(() => f.book.intent(activity, { id: idea.id, privateChatId: owner.chatId }), /字段/);
  const reopened = new ActivityNotebook(f.dir);
  assert.equal(reopened.get(activity, idea.id).privateChatId, activity.chatId);
  assert.equal(reopened.get(owner, idea.id), null);
});

test('narrowing a place preserves origin and cannot leak through locator deduplication', t => {
  const { book } = fixture(t);
  const initial = book.place(owner, { label: '入口', kind: 'app', locator: 'C:/App.exe', evidenceIds: ['owner-msg'] });
  const narrowed = book.place(activity, { id: initial.id, note: '执行时发现的私密信息', visibility: 'private' });
  assert.equal(narrowed.chatId, owner.chatId); assert.equal(narrowed.privateChatId, activity.chatId);
  assert.equal(book.get(owner, initial.id), null); assert.equal(book.get(activity, initial.id).note, narrowed.note);
  assert.throws(() => book.place(owner, { label: '入口', kind: 'app', locator: 'C:/App.exe' }), /范围/);
});

test('old v1 private entries without privateChatId retain original-chat visibility', t => {
  const f = fixture(t);
  const entry = f.book.intent(owner, { title: '旧私密条目', visibility: 'private' });
  const data = JSON.parse(fs.readFileSync(f.file, 'utf8')); delete data.intents[0].privateChatId;
  fs.writeFileSync(f.file, JSON.stringify(data));
  const reopened = new ActivityNotebook(f.dir);
  assert.equal(reopened.get(owner, entry.id).title, entry.title);
  assert.equal(reopened.get(activity, entry.id), null);
  assert.equal(reopened.intent(owner, { id: entry.id, reason: '仍在原处' }).chatId, owner.chatId);
});
