export type Result = { id: string; score: number | null; feedback: string; status: string; reference: string; explanation: string; answer: string; disputed: boolean };
export type LearningState = {
  draft?: { id: string; sourceId: string; lesson: string; prompt: string } | null;
  profile: { name: string; interests: string; goal: string; language: string } | null;
  settings: { reviewsFirst: boolean; newItems: number; motion?: string };
  dueCount: number;
  session: { id: string; mode: string; index: number; count: number; teaching: boolean; exercise: { id: string; family: string; level: number; prompt: string; lesson: string; hint: string; sequence?: string[]; source: string }; result: Result | null } | null;
  summary: { count: number; checked: number; correct: number; skipped: number; completedAt: string; conversation: string } | null;
  progress: { id: string; title: string; learned: boolean; due: string | null; reason: string }[];
  comparisons: { family: string; level: number; matchedTasks: number; recentCorrect: number; comparableKey: string | null; first: { answer: string; score: number; at: string } | null; latest: { answer: string; score: number; at: string } | null }[];
  attempts: { id: string; family: string; answer: string; score: number | null; explanation: string; disputed: boolean; at: string }[];
};
export type State = {
  maximized?: boolean;
  voice?: { available: boolean; consent: boolean; transcript: { text: string; processingMs: number } | null };
  learning?: LearningState;
  accounts: { clientId: string; email: string; signedIn: boolean }[];
  active: string | null;
  signedIn: boolean; planEnabled: boolean; busy: string; message: string; blocked: string; welcome: boolean;
  models: { slug: string; name: string }[];
  evidence: { event: string; at: string }[];
  selectedModel: string; reasoningEffort: string;
  lastError: { code: string; status: number; requestId: string } | null;
};
export type Command = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
export type Page = 'Today' | 'Practice' | 'Progress';
export const families = [
  { id: 'learn', title: 'Make it stick', short: 'Learn', detail: 'Understand an idea, then explain it in your own words.', symbol: 'learn' },
  { id: 'words', title: 'Find the words', short: 'Words', detail: 'Describe, connect and say what you mean.', symbol: 'words' },
  { id: 'reason', title: 'Work it out', short: 'Reason', detail: 'Reason through a problem and make a plan.', symbol: 'reason' },
  { id: 'attention', title: 'Hold that thought', short: 'Focus', detail: 'Keep a short sequence in mind, then recall it.', symbol: 'attention' },
] as const;
export const feelings = ['Never learned it', 'Knew it but could not recall it', 'Question unclear'];
export const familyName = (id: string) => families.find(f => f.id === id)?.title ?? id;
export function dateLabel(value: string, time = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) });
}
declare global {
  interface Window { onTheSpot?: { state(): Promise<State>; command(action: string, payload?: Record<string, unknown>): Promise<State | null> } }
}
