// Reviewed, versioned starter material. Scores are owned by the application.
export const concepts = [
  { id: 'estimate', title: 'An estimate', prerequisites: [], source: 'Locally authored arithmetic definition and examples.', lesson: 'An estimate is a rough answer, close enough to help you plan. Round £4.90 to £5: three items cost about £15. Check the exact total when precision matters.', prompt: 'In your own words, what is an estimate, and when could you use one?', hint: 'Think about a rough answer and planning a shopping trip.', terms: [['rough', 'approximate', 'about', 'close', 'guess'], ['plan', 'shopping', 'cost', 'time', 'check', 'price']] },
  { id: 'sequence', title: 'Follow a sequence', prerequisites: [], source: 'Locally authored instruction-following exercise.', lesson: 'A sequence is an ordered set of steps. For this exercise, read each item in order and repeat it in the same order. You can group items into pairs to help keep their order.', prompt: 'What matters when you follow a sequence?', hint: 'Think about the order of steps.', terms: [['order', 'first', 'then', 'step']] },
  { id: 'budget', title: 'Plan a small budget', prerequisites: ['estimate'], source: 'Locally authored arithmetic example.', lesson: 'A budget is a plan for money. Start with the money available, subtract planned costs, and keep some for unexpected costs. With £20 and a planned cost of £12, £8 remains. An estimate helps you plan; exact subtraction checks what remains.', prompt: 'How would you use a budget before buying something?', hint: 'Start with available money, then consider costs and what remains.', terms: [['money', 'available', 'start'], ['cost', 'costs', 'subtract', 'left', 'remain', 'remaining']] },
  { id: 'vocabulary', title: 'Use a word in context', prerequisites: [], source: 'Locally authored English vocabulary example.', lesson: 'Context means the surrounding words or situation that help explain a word. In “I deposited money at the bank”, money suggests a financial bank. In “We sat on the river bank”, river suggests the edge of a river.', prompt: 'How can context help you understand the word bank?', hint: 'Compare a sentence about money with a sentence about a river.', terms: [['money', 'river'], ['sentence', 'words', 'surrounding', 'situation', 'meaning']] },
  { id: 'spanish', title: 'A Spanish greeting', prerequisites: [], source: 'Reviewed starter vocabulary: Spanish hola = hello; gracias = thank you.', lesson: 'In Spanish, hola means hello and gracias means thank you. A simple greeting could start with hola. After someone helps you, you could say gracias.', prompt: 'Which Spanish word would you use to greet someone, and which to thank them?', hint: 'Hola is a greeting; gracias expresses thanks.', terms: [['hola'], ['gracias']] },
  { id: 'programming', title: 'A variable', prerequisites: ['sequence'], source: 'Locally authored beginner programming definition; no code execution.', lesson: 'A variable is a named place for a value in a program. For example, a variable named score can hold the number 3. The program can later change its value to 4. The name helps you refer to the value.', prompt: 'What is a variable, and what could a variable named score hold?', hint: 'Think of a name that refers to a value.', terms: [['name', 'named', 'score'], ['value', 'number', '3', '4']] },
];

export function exercise(family, level, seed, concept) {
  const base = { id: `${family}-${seed}`, version: 2, rubricVersion: 2, family, level, language: 'en', source: 'On the Spot reviewed starter set v2', conceptId: concept?.id ?? null };
  if (family === 'learn') return { ...base, prompt: concept.prompt, lesson: concept.lesson, hint: concept.hint, terms: concept.terms, reference: concept.lesson, source: concept.source };
  if (family === 'words') {
    const words = [
      ['You use this small utensil to stir tea or eat soup. What is it called?', ['spoon', 'teaspoon', 'tablespoon'], 'It has a handle and a rounded bowl.', 'A spoon.'],
      ['You open this above your head to stay dry in the rain. What is it called?', ['umbrella', 'brolly'], 'It folds up when you do not need it.', 'An umbrella.'],
      ['You use this to tell someone a short story about something that happened. Describe one ordinary event from today.', [], 'Where were you? What happened first? What happened next?', 'There is no single correct story. Look for a clear event and an order the listener can follow.'],
    ];
    const [prompt, accepted, hint, reference] = words[seed % words.length];
    return { ...base, prompt, accepted, hint, lesson: reference, reference, conversation: accepted.length === 0 };
  }
  if (family === 'reason') {
    const money = 20 + level * 5, cost = 7 + seed % 6;
    if (seed % 3 === 1) {
      const rounded = Math.round(cost / 5) * 5;
      return { ...base, prompt: `For a quick shopping estimate, round £${cost} to the nearest £5. What amount would you use?`, answer: rounded, hint: 'Compare the two nearest multiples of 5.', lesson: `The nearest multiple of 5 to ${cost} is ${rounded}. This is an estimate; check the exact price before paying.`, reference: `£${rounded}`, comparableKey: `rounding-5-${level}` };
    }
    if (seed % 3 === 0) {
      return { ...base, prompt: 'You need to arrive within 20 minutes and spend no more than £5. Walking takes 30 minutes and is free. The bus takes 15 minutes and costs £3. A taxi takes 10 minutes and costs £12. Which option meets both conditions?', answer: 'bus', hint: 'Check the time AND cost of each option.', lesson: 'Walking takes too long. The taxi costs too much. The bus takes 15 minutes and costs £3, meeting both conditions.', reference: 'The bus.', comparableKey: `two-constraints-${level}` };
    }
    return { ...base, prompt: `You have £${money}. A notebook costs £${cost}. How much is left?`, answer: money - cost, hint: `Subtract ${cost} from ${money}. Try taking away a small part first.`, lesson: `Start with ${money} and subtract ${cost}: ${money} − ${cost} = ${money - cost}.`, reference: `£${money - cost}`, comparableKey: `subtraction-${level}` };
  }
  const items = seed % 3 === 2 ? ['circle', 'square', 'triangle', 'diamond', 'star', 'rectangle'] : ['red', 'blue', 'green', 'yellow', 'white', 'purple'];
  const sequence = Array.from({ length: 3 + Math.min(level, 3) }, (_, i) => items[(seed + i * 2) % items.length]);
  return { ...base, prompt: `Read the ${seed % 3 === 2 ? 'shape' : 'colour'} sequence. Hide it when you are ready, then type the names in the same order.`, sequence, answer: sequence.join(' '), hint: 'Group the items into pairs. Keep each pair in order.', lesson: 'Read from left to right. Repeat each pair to yourself, then put the pairs together.', reference: sequence.join(', '), comparableKey: `${seed % 3 === 2 ? 'shape' : 'colour'}-sequence-${sequence.length}` };
}

const clean = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export function grade(item, answer) {
  const text = clean(answer);
  if (!text) return { score: null, status: 'unanswered', feedback: 'No answer was recorded. This is not treated as forgetting.' };
  if (item.family === 'reason') {
    const number = Number(answer.trim().replace(/^£\s*/, ''));
    const score = typeof item.answer === 'number' ? Number.isFinite(number) && number === item.answer ? 1 : 0 : text.replace(/^(the|a) /,'') === clean(item.answer) ? 1 : 0;
    return { score, status: 'checked', feedback: score ? `That’s right. ${item.reference}.` : `Let’s work through it. ${item.lesson}` };
  }
  if (item.family === 'attention') {
    const score = text === clean(item.answer) ? 1 : 0;
    return { score, status: 'checked', feedback: score ? 'The sequence is in the right order.' : `The original order was ${item.reference}. You can practise another sequence later.` };
  }
  if (item.conversation) return { score: null, status: 'self_review', feedback: 'This is your story. Check whether it describes an event and makes the order clear. It has no automatic score.' };
  if (item.accepted) {
    const score = item.accepted.some(word => new RegExp(`\\b${word}\\b`, 'i').test(text)) ? 1 : 0;
    return { score, status: 'checked', feedback: score ? `Yes. ${item.reference}` : `The starter answer is ${item.reference} If your wording fits, you can correct this result.` };
  }
  const words = new Set(text.split(' '));
  const matches = item.terms.filter(group => group.some(term => words.has(term))).length;
  const score = matches / item.terms.length;
  return { score, status: 'provisional', feedback: score === 1 ? 'Your explanation covers the main ideas. This word-based check is provisional; correct it if needed.' : `Compare your explanation with: ${item.reference} This check is provisional; your wording may still be valid.` };
}
