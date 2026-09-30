# On the Spot / the practice instrument

## The object
A small place to practise learning, recall, words and reasoning. Not a cognitive-health dashboard or a timed game. The circular spot is both the primary session control and its progress marker, never a decorative orb. Charcoal, paper and coral give it an identity. Solid reading surfaces, structural seams, an exercise path and expressive serif numerals do the work. No gradients, glow, autoplay motion or unearned metrics.

## Hierarchy
- Today: choose short/daily and a starting idea; start from the spot. The four skills describe the mix, not four nonexistent standalone modes. Resume continues the existing session.
- Practice: spot/path left, actual task right. Teaching precedes testing. Feedback replaces the answer area. References and corrections stay in context. At narrow widths the path sits above the task.
- Progress: an indexed collection with honest introduced/due states, real comparisons and correctable answers. No streak or general-intelligence score.
- Your space: one modal settings surface for practice, profile, data and connection. No administrative panel dominating Today. Only this functional overlay uses blur/translucency.
- First launch, empty, loading and unavailable: honest states, not fake data. Browser mode does not pretend to persist learning.

## Interaction contract
LearningView remains mounted across navigation. Draft answer, note, sequence-hidden state and help choice persist in memory until the exercise changes. No unencrypted localStorage. Voice unmounts/stops when leaving Practice. Reviewed answers remain backend records. Typing is not persisted across app termination; do not claim it is.

Native dialog semantics provide modality and background inertness. Explicit first/last Tab wrapping prevents focus reaching browser chrome. Escape and animated closure restore the original control. Underlying scroll position is kept. Page direction follows Today / Practice / Progress. The spot travels using two pointer-transparent FLIP copies that crossfade old/new content. Document snapshot transitions are avoided because they can swallow rapid navigation. Interrupted flights cancel and restart from the visible position; resize/scroll cleans them up. Gentle and OS reduced motion disable spatial effects. Answer/help geometry uses one measured flow surface.

IPC requests are synchronously guarded against double submission. Stale polls cannot overwrite a newer command. Live polling still surfaces server activity during slow work. Cancellation and window controls remain available. Errors preserve drafts. One delayed status surface appears inside the active settings sheet or outside it, not both. Preparation bookkeeping does not display a spinner. Blank answers are validated in place. Successful Next restores focus to the next task, not a removed button.

## Boundaries
Learning algorithms, grading, FSRS scheduling, encryption, accounts, spending controls, source material and native deletion confirmation are unchanged. Existing command names and strict payload shapes are retained. AI stays explicit, with draft acceptance controlled by the user. No new production dependencies, remote fonts, telemetry or data migrations.

## Verification
`npm run check` runs the existing unit suite and TypeScript/Vite build.
`node tests/ui-smoke.mjs`, after installing Playwright 1.56.1 and Chromium, exercises the built renderer against the real Learning engine with in-memory SQLite. Auth, AI, speech availability and native prompts are mocked. Screenshots and results go to `artifacts/ui/`. CI uploads these and the built renderer even after test failure. These mocks are not a live ChatGPT, microphone or Windows test.

Inspect desktop, 1080x800, 768, 390 and 320 widths, long unbroken text, reduced motion, keyboard focus and rapid navigation. Device-level checks still include actual Windows rendering, native browser zoom, microphone consent/cancellation, export/delete, maximise/restore and live authentication. Passing automation is not a claim that every frame is perfect.
