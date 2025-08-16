const { buildOptions, pickNextCard, schedule, state, SOUNDS_ORDERED, makeCard } = require('../scripts/main.js');

describe('schedule', () => {
  beforeEach(() => {
    state.questionIndex = 10;
  });

  test('schedules within interval for known box', () => {
    const card = { box: 2, dueAt: 0 };
    schedule(card);
    expect(card.dueAt).toBeGreaterThanOrEqual(13);
    expect(card.dueAt).toBeLessThanOrEqual(15);
  });

  test('falls back to default interval when box not defined', () => {
    const card = { box: 9, dueAt: 0 };
    schedule(card);
    expect(card.dueAt).toBeGreaterThanOrEqual(13);
    expect(card.dueAt).toBeLessThanOrEqual(16);
  });
});

describe('pickNextCard', () => {
  const mk = (g, box, dueAt) => ({ g, fam: g, box, dueAt });
  beforeEach(() => {
    state.deck = [];
    state.questionIndex = 10;
    state.lastTargetG = null;
  });

  test('prefers due cards with lowest box', () => {
    state.deck = [mk('a',3,15), mk('b',1,9), mk('c',2,9)];
    const card = pickNextCard();
    expect(card.g).toBe('b');
  });

  test('avoids repeating last target when possible', () => {
    state.lastTargetG = 'b';
    state.deck = [mk('b',1,9), mk('c',1,9)];
    const card = pickNextCard();
    expect(card.g).toBe('c');
  });

  test('picks soonest due when none are due', () => {
    state.deck = [mk('b',1,12), mk('c',2,14)];
    const card = pickNextCard();
    expect(card.g).toBe('b');
  });
});

describe('buildOptions', () => {
  beforeEach(() => {
    state.deck = SOUNDS_ORDERED.slice(0,4).map(makeCard);
  });

  test('returns four unique options including target', () => {
    const target = state.deck[0];
    const opts = buildOptions(target);
    expect(opts).toHaveLength(4);
    expect(opts).toContain(target.g);
    expect(new Set(opts).size).toBe(4);
    const distractors = opts.filter(g => g !== target.g);
    distractors.forEach(g => {
      const fam = SOUNDS_ORDERED.find(s => s.g === g).fam;
      expect(fam).not.toBe(target.fam);
    });
  });

  test('fills options when deck pool is small', () => {
    state.deck = SOUNDS_ORDERED.slice(0,2).map(makeCard);
    const target = state.deck[0];
    const opts = buildOptions(target);
    expect(opts).toHaveLength(4);
    expect(opts).toContain(target.g);
    expect(new Set(opts).size).toBe(4);
  });
});
