// FSRS v5 — motor de repetição espaçada
// Pesos default do FSRS-5 (19 parâmetros)
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
  0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567
];

const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // 19/81
const REQUEST_RETENTION = 0.9; // configurável no futuro

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function initStability(rating) {
  return Math.max(W[rating - 1], 0.1);
}

function initDifficulty(rating) {
  return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
}

export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

function nextInterval(stability) {
  const interval =
    (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(interval), 1, 365);
}

function nextDifficulty(d, rating) {
  const delta = -W[6] * (rating - 3);
  const damped = d + delta * ((10 - d) / 9); // linear damping (FSRS-5)
  const meanReverted = W[7] * initDifficulty(4) + (1 - W[7]) * damped;
  return clamp(meanReverted, 1, 10);
}

function stabilityAfterRecall(d, s, r, rating) {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(W[8]) *
        (11 - d) *
        Math.pow(s, -W[9]) *
        (Math.exp(W[10] * (1 - r)) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function stabilityAfterLapse(d, s, r) {
  const sf =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
  return Math.min(Math.max(sf, 0.1), s);
}

/**
 * Calcula o novo estado FSRS de um conceito.
 * @param {1|2|3|4} rating 1=again, 2=hard, 3=good, 4=easy
 * @param {object|null} current linha atual de fsrs_state (ou null se nunca revisado)
 * @param {Date} now
 * @returns novo estado pronto para gravar em fsrs_state
 */
export function calculateFSRS(rating, current, now = new Date()) {
  const isNew = !current || current.reps === 0 || current.state === 'new';

  if (isNew) {
    const stability = initStability(rating);
    const difficulty = initDifficulty(rating);
    const again = rating === 1;
    const scheduledDays = again ? 0 : nextInterval(stability);
    const due = new Date(now);
    if (again) due.setMinutes(due.getMinutes() + 10);
    else due.setDate(due.getDate() + scheduledDays);

    return {
      stability,
      difficulty,
      elapsed_days: 0,
      scheduled_days: scheduledDays,
      reps: 1,
      lapses: again ? 1 : 0,
      state: again ? 'learning' : 'review',
      last_review: now.toISOString(),
      due: due.toISOString()
    };
  }

  const lastReview = current.last_review ? new Date(current.last_review) : now;
  const elapsedDays = Math.max(
    0,
    Math.round((now - lastReview) / 86400000)
  );
  const r = retrievability(elapsedDays, current.stability);
  const difficulty = nextDifficulty(current.difficulty, rating);

  if (rating === 1) {
    const stability = stabilityAfterLapse(current.difficulty, current.stability, r);
    const due = new Date(now);
    due.setMinutes(due.getMinutes() + 10);
    return {
      stability,
      difficulty,
      elapsed_days: elapsedDays,
      scheduled_days: 0,
      reps: current.reps + 1,
      lapses: current.lapses + 1,
      state: 'relearning',
      last_review: now.toISOString(),
      due: due.toISOString()
    };
  }

  const stability = stabilityAfterRecall(
    current.difficulty,
    Math.max(current.stability, 0.1),
    r,
    rating
  );
  const scheduledDays = nextInterval(stability);
  const due = new Date(now);
  due.setDate(due.getDate() + scheduledDays);

  return {
    stability,
    difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    reps: current.reps + 1,
    lapses: current.lapses,
    state: 'review',
    last_review: now.toISOString(),
    due: due.toISOString()
  };
}
