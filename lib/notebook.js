import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const OPEN = new Set(['idea', 'planned', 'waiting']);
const STATUSES = new Set([...OPEN, 'done', 'cancelled']);
const KINDS = new Set(['app', 'site', 'chat', 'file', 'game']);
const VISIBILITY = new Set(['internal', 'private']);
const MAX_SCOPE = 100, MAX_ENTRIES = 2000, MAX_BYTES = 8 * 1024 * 1024;
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const has = (value, key) => Object.hasOwn(value, key);

function object(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error(label + '包含无效字段');
  return value;
}
function text(value, limit, label, required = false) {
  if (typeof value !== 'string' || value.length > limit || /\u0000/.test(value) || (required && !value.trim())) throw Error(label + '格式或长度无效');
  return value.trim();
}
function identity(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw Error('身份标识无效');
  return value;
}
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) throw Error('时间必须为有效毫秒时间戳');
  return value;
}
function nullableTime(value) { return value === null ? null : time(value); }
function ids(value) {
  if (!Array.isArray(value) || value.length > 20) throw Error('来源或人物列表最多 20 项');
  return [...new Set(value.map(identity))];
}
function visibility(value) { if (!VISIBILITY.has(value)) throw Error('记事范围无效'); return value; }
function scope(binding) {
  if (!plain(binding) || typeof binding.preview !== 'boolean') throw Error('需要可信的完整会话身份');
  return { sessionId: identity(binding.sessionId), chatId: identity(binding.chatId), personaId: identity(binding.personaId), preview: binding.preview };
}
function sameScope(entry, binding) { return entry.personaId === binding.personaId && entry.preview === binding.preview; }
function visible(entry, binding) { return sameScope(entry, binding) && (entry.visibility !== 'private' || (entry.privateChatId || entry.chatId) === binding.chatId); }
const COMMON = ['id', 'sessionId', 'chatId', 'personaId', 'preview', 'visibility', 'evidenceIds', 'createdAt', 'updatedAt'];

function validateEntry(entry, kind) {
  const keys = kind === 'intent'
    ? [...COMMON, 'title', 'reason', 'status', 'nextAt', 'subjects', 'outcome', 'requestId', 'lastConsideredAt']
    : [...COMMON, 'label', 'kind', 'locator', 'note'];
  object(entry, [...keys, 'privateChatId'], '保存的记事');
  if (keys.some(key => !has(entry, key))) throw Error('保存的记事缺少字段');
  scope(entry); identity(entry.id);
  if (!entry.id.startsWith(kind + '-')) throw Error('保存的记事 ID 类型无效');
  visibility(entry.visibility); ids(entry.evidenceIds); time(entry.createdAt); time(entry.updatedAt);
  if (has(entry, 'privateChatId')) {
    identity(entry.privateChatId);
    if (entry.visibility !== 'private') throw Error('内部记事不能指定私密会话');
  }
  if (kind === 'intent') {
    text(entry.title, 120, '想法标题', true); text(entry.reason, 600, '想法缘由'); text(entry.outcome, 1000, '行动结果');
    if (!STATUSES.has(entry.status)) throw Error('想法状态无效');
    nullableTime(entry.nextAt); nullableTime(entry.lastConsideredAt); ids(entry.subjects);
    if (entry.requestId !== null) identity(entry.requestId);
    if (!OPEN.has(entry.status) && entry.nextAt !== null) throw Error('已结束想法不能保留唤醒时间');
  } else {
    text(entry.label, 120, '入口名称', true); text(entry.locator, 1500, '入口位置', true); text(entry.note, 600, '入口说明');
    if (!KINDS.has(entry.kind)) throw Error('入口类型无效');
  }
}
function validateData(data) {
  object(data, ['version', 'intents', 'places'], '记事文件');
  if (data.version !== 1 || !Array.isArray(data.intents) || !Array.isArray(data.places) || data.intents.length + data.places.length > MAX_ENTRIES) throw Error('记事文件格式或版本无效');
  const allIds = new Set(), requests = new Set(), counts = new Map();
  for (const [kind, entries] of [['intent', data.intents], ['place', data.places]]) for (const entry of entries) {
    validateEntry(entry, kind);
    if (allIds.has(entry.id)) throw Error('记事文件包含重复 ID');
    allIds.add(entry.id);
    if (kind === 'intent' && entry.requestId) {
      const key = JSON.stringify([entry.personaId, entry.preview, entry.chatId, entry.requestId]);
      if (requests.has(key)) throw Error('记事文件包含重复请求 ID');
      requests.add(key);
    }
    if (kind === 'place' || OPEN.has(entry.status)) {
      const key = JSON.stringify([kind, entry.personaId, entry.preview]);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (counts.get(key) > MAX_SCOPE) throw Error('同一角色最多保留 100 个未结束想法及 100 个入口');
    }
  }
}

/** Persistent self-chosen intentions and known places; this class never executes actions.
 * Callers must revalidate evidence visibility through the memory service before use.
 * `done` is the agent's reported status, not proof that an external action succeeded.
 */
export class ActivityNotebook {
  constructor(dir, { now = Date.now } = {}) {
    this.file = path.join(dir, 'notebook.json'); this.now = now;
    const bytes = this.readDisk(); this.diskHash = bytes === null ? null : hash(bytes);
    try { this.data = bytes === null ? { version: 1, intents: [], places: [] } : JSON.parse(bytes.toString('utf8')); validateData(this.data); }
    catch (error) { throw Error('自主活动记事文件无效，已保留原文件：' + error.message); }
  }
  readDisk() {
    try {
      if (fs.statSync(this.file).size > MAX_BYTES) throw Error('自主活动记事文件过大');
      const bytes = fs.readFileSync(this.file);
      if (bytes.length > MAX_BYTES) throw Error('自主活动记事文件过大');
      return bytes;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  commit(next) {
    validateData(next);
    const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) throw Error('自主活动记事容量已满，请整理后再记录');
    const current = this.readDisk();
    if ((current === null ? null : hash(current)) !== this.diskHash) throw Error('自主活动记事已被其他进程修改，请重新加载后再操作');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.file);
      this.data = next; this.diskHash = hash(bytes);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  list(binding, options = {}) {
    const b = scope(binding);
    object(options, ['includeClosed', 'limit'], '筛选选项');
    const includeClosed = options.includeClosed ?? false, limit = options.limit ?? 30;
    if (typeof includeClosed !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('记事列表数量范围为 1–100');
    const select = entries => entries.filter(e => visible(e, b)).sort((a, z) => z.updatedAt - a.updatedAt || a.id.localeCompare(z.id)).slice(0, limit);
    return clone({ intents: select(this.data.intents.filter(e => includeClosed || OPEN.has(e.status))), places: select(this.data.places) });
  }
  get(binding, entryId) {
    const b = scope(binding); identity(entryId);
    const entry = [...this.data.intents, ...this.data.places].find(e => e.id === entryId && visible(e, b));
    return entry ? clone(entry) : null;
  }
  intent(binding, args) {
    const b = scope(binding);
    object(args, ['id', 'title', 'reason', 'status', 'nextAt', 'subjects', 'evidenceIds', 'visibility', 'outcome', 'requestId'], '想法参数');
    // Validate even repeated requests: idempotency must not hide malformed or injected fields.
    if (has(args, 'id')) identity(args.id);
    if (has(args, 'title')) text(args.title, 120, '想法标题', true);
    for (const [key, max, label] of [['reason', 600, '想法缘由'], ['outcome', 1000, '行动结果']]) if (has(args, key)) text(args[key], max, label);
    if (has(args, 'status') && !STATUSES.has(args.status)) throw Error('想法状态无效');
    if (has(args, 'nextAt')) nullableTime(args.nextAt);
    for (const key of ['subjects', 'evidenceIds']) if (has(args, key)) ids(args[key]);
    if (has(args, 'visibility')) visibility(args.visibility);
    if (has(args, 'requestId')) identity(args.requestId);
    const old = args.id ? this.data.intents.find(e => e.id === args.id) : null;
    if (args.id && (!old || !visible(old, b))) throw Error('想法不存在或不属于当前可见范围');
    const repeated = args.requestId && this.data.intents.find(e => sameScope(e, b) && e.chatId === b.chatId && e.requestId === args.requestId);
    if (repeated && (!args.id || repeated.id !== args.id)) {
      if (args.id) throw Error('请求 ID 已用于其他想法');
      if (!visible(repeated, b)) throw Error('该请求的想法已收紧范围，当前会话不可见');
      return clone(repeated);
    }
    if (old?.requestId && has(args, 'requestId') && args.requestId !== old.requestId) throw Error('不能修改想法的请求 ID');
    const at = time(this.now());
    const entry = old ? clone(old) : { ...b, id: 'intent-' + randomUUID(), title: '', reason: '', status: 'idea', nextAt: null, subjects: [], evidenceIds: [], visibility: 'internal', outcome: '', requestId: null, createdAt: at, updatedAt: at, lastConsideredAt: null };
    for (const key of ['title', 'reason', 'status', 'nextAt', 'visibility', 'outcome', 'requestId']) if (has(args, key)) entry[key] = typeof args[key] === 'string' ? args[key].trim() : args[key];
    for (const key of ['subjects', 'evidenceIds']) if (has(args, key)) entry[key] = ids(args[key]);
    text(entry.title, 120, '想法标题', true);
    if (old?.visibility === 'private' && entry.visibility !== 'private') throw Error('不能扩大私密想法的范围');
    if (entry.visibility === 'private' && old?.visibility !== 'private') entry.privateChatId = b.chatId;
    if (!OPEN.has(entry.status)) entry.nextAt = null;
    entry.updatedAt = at;
    const next = clone(this.data);
    if (old) next.intents[next.intents.findIndex(e => e.id === old.id)] = entry; else next.intents.push(entry);
    this.commit(next); return clone(entry);
  }
  place(binding, args) {
    const b = scope(binding);
    object(args, ['id', 'label', 'kind', 'locator', 'note', 'evidenceIds', 'visibility'], '入口参数');
    if (has(args, 'id')) identity(args.id);
    for (const [key, max, required] of [['label', 120, true], ['locator', 1500, true], ['note', 600, false]]) if (has(args, key)) text(args[key], max, key, required);
    if (has(args, 'kind') && !KINDS.has(args.kind)) throw Error('入口类型无效');
    if (has(args, 'evidenceIds')) ids(args.evidenceIds);
    if (has(args, 'visibility')) visibility(args.visibility);
    const old = args.id ? this.data.places.find(e => e.id === args.id) : this.data.places.find(e => sameScope(e, b) && e.chatId === b.chatId && e.kind === args.kind && e.locator === args.locator?.trim());
    if ((args.id && !old) || (old && !visible(old, b))) throw Error('入口不存在或不属于当前可见范围');
    const at = time(this.now());
    const entry = old ? clone(old) : { ...b, id: 'place-' + randomUUID(), label: '', kind: '', locator: '', note: '', evidenceIds: [], visibility: 'internal', createdAt: at, updatedAt: at };
    for (const key of ['label', 'kind', 'locator', 'note', 'visibility']) if (has(args, key)) entry[key] = args[key].trim();
    if (has(args, 'evidenceIds')) entry.evidenceIds = ids(args.evidenceIds);
    if (old?.visibility === 'private' && entry.visibility !== 'private') throw Error('不能扩大私密入口的范围');
    if (entry.visibility === 'private' && old?.visibility !== 'private') entry.privateChatId = b.chatId;
    entry.updatedAt = at;
    const next = clone(this.data);
    if (old) next.places[next.places.findIndex(e => e.id === old.id)] = entry; else next.places.push(entry);
    this.commit(next); return clone(entry);
  }
  due(binding, at = this.now()) {
    const b = scope(binding); time(at);
    return clone(this.data.intents.filter(e => visible(e, b) && OPEN.has(e.status) && e.nextAt !== null && e.nextAt <= at)
      .sort((a, z) => a.nextAt - z.nextAt || a.createdAt - z.createdAt));
  }
  /** Trusted scheduler only: IDs come from candidates it has already scope-checked.
   * A waiting-for-event candidate with no date is acknowledged without inventing a date.
   * Future dates and closed entries are never consumed.
   */
  markConsidered(entryIds, at = this.now()) {
    time(at);
    if (!Array.isArray(entryIds) || entryIds.length > 100) throw Error('一次最多处理 100 个想法');
    const wanted = new Set(entryIds.map(identity)), updated = [];
    const next = clone(this.data);
    for (const entry of next.intents) {
      if (!wanted.has(entry.id) || !OPEN.has(entry.status) || (entry.nextAt !== null && entry.nextAt > at)) continue;
      if (entry.nextAt === null && entry.lastConsideredAt !== null && entry.lastConsideredAt >= at) continue;
      entry.nextAt = null; entry.lastConsideredAt = Math.max(entry.lastConsideredAt ?? 0, at); updated.push(entry.id);
    }
    if (updated.length) this.commit(next);
    return updated;
  }
}
