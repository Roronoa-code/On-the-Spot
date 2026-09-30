# On the Spot: the practice instrument

## The object

On the Spot is a place to practise remembering, explaining and reasoning. The interface centres on a segmented circular dial. Its four or twelve segments correspond to actual exercises. The current segment signals the next exercise; completed segments mark work already saved. During practice the same ring becomes a compact position marker. At the end it represents the completed session.

The visual language is warm ink, chalk, coral and sage. Coral identifies the next action and current exercise; sage marks completed work. Manrope provides the rounded, readable voice and IBM Plex Mono supplies precise exercise numbers and indices. Both fonts are bundled under the SIL Open Font License. There are no font-service requests.

The uploaded reference informed coherent surfaces and related circular shapes. Mochi Tunes informed the more important principle: controls and reactions should belong to a complete product object. Neither reference was copied literally. There are no decorative brain scores, unrelated statistics, ambient spinning rings or ornamental gradients.

## What each surface does

| Surface | Priority | Supporting controls |
| --- | --- | --- |
| Today | Choose the size of a round and start or continue it | A real review queue, personal goal and optional reviewed AI question |
| Practice | Read the prompt and give an answer | Teaching and hints expand beside the task; voice belongs to the answer toolbar |
| Feedback | Understand what was checked and continue | Your answer, expandable reference, correctable result and optional AI review |
| Summary | Recognise a finished round and choose what follows | Actual checked/skipped counts and an optional conversation prompt |
| Progress | Return to learned ideas and inspect your answers | Expandable examples, profile, review preferences and data controls |
| Settings | Adjust motion or manage the optional ChatGPT connection | Models, usage, renewal and connection evidence remain available behind disclosures |

## Continuity

The three views remain mounted while inactive. A typed answer, hidden sequence, selected session size and open disclosure therefore keep their state when moving between views. A different exercise resets its own working state. Moving away from practice or covering it with Settings stops active microphone/read-aloud work.

The navigation marker moves from its currently painted position. Repeated navigation targets the latest selection instead of queuing animation. Scroll position belongs to the committed page, so a cancelled transition cannot overwrite a different page's saved position. A delayed session-start response cannot override a more recent navigation choice.

Where supported, native View Transitions carry the dial and its counter together between Today and Practice. Incoming prompt text waits until the dial's path is clear. Other page changes finish fading the outgoing text before revealing the next page, avoiding superimposed paragraphs. The persistent chrome remains live. Settings uses a native dialog for focus containment and background inertness, with interruptible entrance/exit motion and focus restoration. Only surfaces with content behind them use blur: the title bar, narrow-screen navigation and modal backdrop.

Interface motion can be Fluid or Gentle. System reduced motion takes priority. Core information, sequence gating, focus and feedback remain available without movement.

## Feedback and interruptions

A short local operation does not flash a loader. Longer requests use one visible status surface and retain their cancel action, including inside Settings. Backend messages from failed optional AI requests appear in the task context. A stale state poll cannot replace a newer answer or session state. Starts and submissions have synchronous guards against duplicate activation.

Feedback reserves its full text layout during the letter reveal. Stopping freezes the visible portion without pulling surrounding controls upward; Show all finishes it. Teaching, hints, reference material and reflection choices expand within the current task.

Voice input starts only after a deliberate action and consent. Recording feedback comes from the captured signal. Transcription consumes each recording once, and a cancelled/old request cannot overwrite newer work. If typing already exists, the transcript offers Add, Replace and Discard. Leaving the working surface releases the capture, and the recording length is bounded. The separate native consent/deletion window retains a safe default focus and scrollable copy with stable actions.

## Runtime boundaries

The learning engine, spaced review, content, encryption implementation, OAuth contracts and IPC allowlists retain their existing production behaviour. The only desktop-main changes are background colours to prevent a mismatched first frame. No production network permission or renderer Node access was added.

`npm run dev` uses a serve-only Vite plugin and the real `Learning` engine with temporary in-memory storage per preview session. Duplicated browser tabs can share that session. It neither opens the desktop database nor makes account/AI requests. Development allowances needed for Vite are applied only by the development transform; the packaged page keeps its restrictive CSP. Preview exports and deletion apply only to the preview session's temporary record.

`npm run check` runs the existing backend contracts plus preview boundary tests and a production build. `npm run test:ui` exercises the actual practice flow in an isolated browser. Hardware microphone quality, installed Windows voices, authenticated account use and the packaged Windows executable require verification on Windows.

## Verification of this redesign

| Check | Result |
| --- | --- |
| Backend and preview tests | 21 passed |
| TypeScript and production build | Passed |
| Real learning journey | 10 groups passed, including interrupted Fluid navigation and saved drafts |
| Automated accessibility scans | No axe violations on 7 representative screens; WCAG 2 A/AA and 2.1 AA tags |
| Voice and prompt lifecycle fixtures | 12 groups passed |
| Built renderer | Original CSP, local fonts, real saved/scored answer, no preview bridge |
| Browser errors and unexpected external requests | None in the verified flows |

The [browser report](revamp/verification.json), [production renderer report](revamp/production-verification.json) and [voice fixture report](revamp/voice-verification.json) retain the results and their scope. Screenshots and the [motion walkthrough](revamp/walkthrough.mp4) were captured from the working browser preview using synthetic practice data. Automated scans supplement keyboard and visual inspection; they are not a claim of complete accessibility conformance. The existing Windows-native smoke suites were updated for the new interface and syntax-checked, but were not executed on Windows during this redesign.
