import { randomUUID } from 'node:crypto';
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs';
import { concepts, exercise, grade } from './content.mjs';

const scheduler = fsrs();
const explanations = ['Never learned it', 'Knew it but could not recall it', 'Question unclear', ''];
const initial = () => ({ version: 1, catalog: concepts.map(c=>({...c,version:2})), profile: null, concepts: {}, sessions: [], attempts: [], levels: { reason: 0, attention: 0 }, settings: { reviewsFirst: true, newItems: 2 } });
export class Learning {
  constructor(storage, now = () => new Date()) {
    this.store = storage; this.now = now;
    storage.db.exec('CREATE TABLE IF NOT EXISTS learner (id INTEGER PRIMARY KEY CHECK(id = 1), protected BLOB NOT NULL)');
    const row = storage.db.prepare('SELECT protected FROM learner WHERE id = 1').get();
    this.data = row ? JSON.parse(storage.crypto.decryptString(Buffer.from(row.protected))) : initial();
  }
  save() {
    // ponytail: one encrypted personal record; split records if history makes writes slow.
    this.store.db.prepare('INSERT INTO learner(id, protected) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET protected=excluded.protected').run(this.store.crypto.encryptString(JSON.stringify(this.data)));
  }
  get session() { return this.data.sessions.find(s => s.status === 'active'); }
  due() { return concepts.filter(c => this.data.concepts[c.id]?.learned && new Date(this.data.concepts[c.id].card.due) <= this.now()); }
  state() {
    const session = this.session;
    const item = session?.items[session.index];
    const result = item && this.data.attempts.find(a => a.sessionId === session.id && a.exerciseId === item.id);
    const { answer: _answer, accepted: _accepted, terms: _terms, reference: _reference, ...safeItem } = item ?? {};
    return { profile: this.data.profile, settings: this.data.settings, dueCount: this.due().length, draft: this.data.draft ?? null,
      session: session ? { id: session.id, mode: session.mode, index: session.index, count: session.items.length, exercise: safeItem, result: result ? { ...result, reference: item.reference } : null, teaching: item.family === 'learn' && !this.data.concepts[item.conceptId]?.learned } : null,
      summary: !session ? this.data.sessions.filter(s => s.status === 'completed').at(-1)?.summary ?? null : null,
      progress: concepts.map(c => ({ id: c.id, title: c.title, prerequisites: c.prerequisites, learned: !!this.data.concepts[c.id]?.learned, due: this.data.concepts[c.id]?.card.due ?? null, reason: this.data.concepts[c.id]?.reason ?? 'Start with teaching and a comprehension check.' })),
      comparisons: ['reason', 'attention'].map(family => {
        const records = this.data.attempts.filter(a => a.family === family && a.score !== null && !a.disputed);
        const key = records.at(-1)?.comparableKey;
        const matched = records.filter(a => a.comparableKey === key);
        return { family, level: this.data.levels[family], matchedTasks: matched.length, recentCorrect: matched.slice(-5).filter(a => a.score === 1).length, comparableKey: key ?? null, first: matched[0] ? { answer: matched[0].answer, score: matched[0].score, at: matched[0].at } : null, latest: matched.at(-1) ? { answer: matched.at(-1).answer, score: matched.at(-1).score, at: matched.at(-1).at } : null };
      }), attempts: this.data.attempts.slice(-20).map(a => ({ id: a.id, family: a.family, answer: a.answer, score: a.score, explanation: a.explanation, disputed: a.disputed, at: a.at })) };
  }
  run(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_learning_payload');
    if (action === 'profile') {
      for (const key of ['name', 'interests', 'goal', 'language']) if (typeof payload[key] !== 'string' || payload[key].length > 300) throw new Error('invalid_profile');
      this.data.profile = { name: payload.name.trim(), interests: payload.interests.trim(), goal: payload.goal.trim(), language: payload.language.trim() || 'English' };
    } else if (action === 'start') {
      if (!this.data.profile) throw new Error('profile_required');
      if (this.session) return this.state();
      if (!['short', 'daily'].includes(payload.mode)) throw new Error('invalid_session_mode');
      const seed = this.data.sessions.length, items = [];
      const due = this.due();
      const newConcepts = concepts.filter(c => !this.data.concepts[c.id]?.learned).slice(0, this.data.settings.newItems);
      const known = concepts.filter(c => this.data.concepts[c.id]?.learned && !due.includes(c));
      const chosen = concepts.find(c => c.id === payload.conceptId);
      if (payload.conceptId && !chosen) throw new Error('invalid_concept');
      const selected = this.data.settings.reviewsFirst ? [...due, ...newConcepts, ...known] : [...newConcepts, ...due, ...known];
      if (chosen) selected.unshift(chosen);
      const weak = concepts.find(c => this.data.concepts[c.id]?.misses >= 2);
      if (weak) selected.unshift(...weak.prerequisites.map(id => concepts.find(c => c.id === id)), weak);
      // Teach an unfamiliar prerequisite before using its dependent concept.
      for (const c of [...selected].reverse()) for (const id of c.prerequisites) if (!this.data.concepts[id]?.learned) selected.unshift(concepts.find(p => p.id === id));
      let unfamiliar = 0;
      const ordered = [...new Set(selected)].filter(c => this.data.concepts[c.id]?.learned || unfamiliar++ < this.data.settings.newItems);
      const count = payload.mode === 'short' ? 4 : 12;
      const families = ['learn', 'words', 'reason', 'attention'];
      for (let i = 0; i < count; i++) {
        const family = families[i % 4];
        const concept = ordered[Math.floor(i / 4) % ordered.length];
        items.push(exercise(family, this.data.levels[family] ?? 0, seed * 8 + i, family === 'learn' ? concept : null));
        const variation = this.data.variations?.[concept?.id];
        if (family === 'learn' && variation) Object.assign(items.at(-1), { prompt: variation.prompt, version: 2, aiReviewed: true });
      }
      this.data.sessions.push({ id: randomUUID(), status: 'active', mode: payload.mode, started: this.now().toISOString(), index: 0, items, supports: {}, prepared: {} });
    } else if (action === 'reviewDraft') {
      if (!this.data.draft || payload.draftId !== this.data.draft.id || typeof payload.accept !== 'boolean') throw new Error('invalid_draft');
      if (payload.accept) { this.data.variations ??= {}; this.data.variations[this.data.draft.sourceId] = { ...this.data.draft, reviewedAt: this.now().toISOString() }; }
      this.data.draft = null;
    } else if (action === 'prepare') {
      const s = this.requireSession(payload), item = s.items[s.index];
      s.prepared[item.id] ??= this.now().toISOString();
    } else if (action === 'support') {
      const s = this.requireSession(payload), item = s.items[s.index];
      if (!['teach', 'hint'].includes(payload.kind)) throw new Error('invalid_support');
      s.supports[item.id] = (s.supports[item.id] ?? 0) + 1;
    } else if (action === 'answer') {
      const s = this.requireSession(payload), item = s.items[s.index];
      if (this.data.attempts.some(a => a.sessionId === s.id && a.exerciseId === item.id)) return this.state();
      if (typeof payload.answer !== 'string' || payload.answer.length > 4000 || !explanations.includes(payload.explanation ?? '') || !['typing', 'speech'].includes(payload.inputMode ?? 'typing')) throw new Error('invalid_answer');
      if (payload.speechOnsetMs != null && (!Number.isFinite(payload.speechOnsetMs) || payload.speechOnsetMs < 0 || payload.speechOnsetMs > 86_400_000)) throw new Error('invalid_timing');
      if (item.family === 'attention' && !s.prepared[item.id] && !payload.skip) throw new Error('sequence_not_prepared');
      const result = payload.skip ? { score: null, status: 'skipped', feedback: 'Skipped. A missing answer is not treated as forgetting.' } : grade(item, payload.answer);
      if (['Never learned it', 'Question unclear'].includes(payload.explanation)) { result.score = null; result.status = 'unscored'; result.feedback = payload.explanation === 'Never learned it' ? `Let’s teach this first. ${item.lesson}` : 'Question marked unclear. It will not change your recall or difficulty.'; }
      const record = { id: randomUUID(), sessionId: s.id, exerciseId: item.id, exerciseVersion: item.version, rubricVersion: item.rubricVersion, family: item.family, conceptId: item.conceptId, comparableKey: item.comparableKey ?? null, level: item.level, language: this.data.profile.language, answer: payload.answer, explanation: payload.explanation ?? '', inputMode: payload.inputMode ?? 'typing', hints: s.supports[item.id] ?? 0, preparedAt: s.prepared[item.id] ?? null, at: this.now().toISOString(), ...result, disputed: false };
      record.speechOnsetMs = payload.speechOnsetMs ?? null;
      if (payload.processingMs != null && (!Number.isFinite(payload.processingMs) || payload.processingMs < 0 || payload.processingMs > 86_400_000)) throw new Error('invalid_timing');
      record.processingMs = payload.processingMs ?? 0;
      record.responseMs = record.preparedAt ? Math.max(0, new Date(record.at) - new Date(record.preparedAt) - record.processingMs) : null;
      this.data.attempts.push(record); this.adapt(item, record);
    } else if (action === 'next') {
      const s = this.requireSession(payload), item = s.items[s.index];
      if (!this.data.attempts.some(a => a.sessionId === s.id && a.exerciseId === item.id)) throw new Error('answer_required');
      s.index++;
      if (s.index === s.items.length) {
        s.status = 'completed'; s.finished = this.now().toISOString();
        const attempts = this.data.attempts.filter(a => a.sessionId === s.id);
        s.summary = { count: attempts.length, checked: attempts.filter(a => a.score !== null && !a.disputed).length, correct: attempts.filter(a => a.score === 1 && !a.disputed).length, skipped: attempts.filter(a => a.status === 'skipped').length, completedAt: s.finished, conversation: 'If you feel like it, tell someone one thing you learned today and ask them a follow-up question.' };
      }
    } else if (action === 'correct') {
      const record = this.data.attempts.find(a => a.id === payload.attemptId);
      if (!record || ![0, 0.5, 1, null].includes(payload.score) || !explanations.includes(payload.explanation ?? record.explanation)) throw new Error('invalid_correction');
      record.score = payload.score; record.explanation = payload.explanation ?? record.explanation; record.disputed = payload.score === null; record.status = record.disputed ? 'disputed' : 'corrected'; record.feedback = record.disputed ? 'Result disputed. It is unscored until you correct it.' : 'Your correction is saved.';
      if (['Never learned it', 'Question unclear'].includes(record.explanation)) record.score = null;
      this.rebuild();
    } else if (action === 'settings') {
      if (typeof payload.reviewsFirst !== 'boolean' || !Number.isInteger(payload.newItems) || payload.newItems < 1 || payload.newItems > 4) throw new Error('invalid_settings');
      const motion = payload.motion ?? this.data.settings.motion ?? 'liquid';
      if (!['liquid','gentle'].includes(motion)) throw new Error('invalid_settings');
      this.data.settings = { reviewsFirst: payload.reviewsFirst, newItems: payload.newItems, motion };
    } else throw new Error('invalid_learning_action');
    this.save(); return this.state();
  }
  requireSession(payload) {
    const s = this.session;
    if (!s || payload.sessionId !== s.id || payload.exerciseId !== s.items[s.index]?.id) throw new Error('stale_exercise');
    return s;
  }
  adapt(item, record) {
    if (record.score === null || record.disputed || record.status === 'skipped') return;
    if (item.family === 'learn') {
      const previous = this.data.concepts[item.conceptId];
      if (!previous?.learned && record.score < 1) return;
      const rating = record.score === 1 ? record.hints ? Rating.Hard : Rating.Good : record.score > 0 ? Rating.Hard : Rating.Again;
      const card = scheduler.next(previous?.card ?? createEmptyCard(new Date(record.at)), new Date(record.at), rating).card;
      this.data.concepts[item.conceptId] = { learned: true, card, misses: record.score < 1 ? (previous?.misses ?? 0) + 1 : 0, reason: record.score === 1 ? 'Recall demonstrated; review scheduled with FSRS.' : 'Recall needed support; revisit the explanation and review sooner.' };
    } else if (['reason', 'attention'].includes(item.family)) {
      const recent = this.data.attempts.filter(a => a.family === item.family && a.level === item.level && a.score !== null && !a.disputed).slice(-3);
      if (recent.length === 3 && recent.every(a => a.score === 1 && a.hints === 0)) this.data.levels[item.family] = Math.min(3, item.level + 1);
      else if (recent.filter(a => a.score === 0).length >= 2) this.data.levels[item.family] = Math.max(0, item.level - 1);
    }
  }
  rebuild() {
    this.data.concepts = {}; this.data.levels = { reason: 0, attention: 0 };
    const all = this.data.attempts; this.data.attempts = [];
    for (const record of all) {
      this.data.attempts.push(record);
      const item = this.data.sessions.find(s => s.id === record.sessionId)?.items.find(i => i.id === record.exerciseId);
      if (item) this.adapt(item, record);
    }
    for (const s of this.data.sessions.filter(s => s.status === 'completed')) {
      const attempts = this.data.attempts.filter(a => a.sessionId === s.id);
      s.summary.checked = attempts.filter(a => a.score !== null && !a.disputed).length;
      s.summary.correct = attempts.filter(a => a.score === 1 && !a.disputed).length;
    }
  }
  export() { return JSON.stringify(this.data, null, 2); }
  clear() { this.store.db.prepare('DELETE FROM learner WHERE id = 1').run(); this.data = initial(); }
}
