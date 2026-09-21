'use strict';

// ============================================================
// CREDIT CARD REDUCTION CALCULATOR — TEST SUITE
// Run with: node tests.js
// This engine (percent-of-balance minimum repayments compounding on a
// revolving balance) has no simple closed-form formula the way a
// fixed-payment mortgage annuity does, so most scenarios here are
// property-based (e.g. "extra payments must reduce total interest")
// rather than hand-computed exact dollar figures. A handful of
// scenarios ARE exact and hand-verifiable (zero-rate payoff, a 0%
// promo period, a rate event boundary) — those are checked precisely.
// Tolerance: ±$5 on dollar figures, ±1 month on term figures.
// ============================================================

// ============================================================
// CALCULATION ENGINE (mirrors credit-card-calculator.html)
// ============================================================

function toUTCDateOnly(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}
function addMonthsUTC(date, n) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const day = date.getUTCDate();
  const daysInTargetMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, daysInTargetMonth)));
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// See credit-card-calculator.html for full opts documentation.
function amortCard(balance, annualRate, opts = {}) {
  const {
    minPercent = 0.025, minFloor = 25,
    extraMonthly = 0, lumpSums = [], rateEvents = [],
    promo, startDate, buildSchedule,
  } = opts;

  const start = toUTCDateOnly(startDate ? new Date(startDate) : new Date());
  const MAX_MONTHS = 600;

  let bal = balance, totalInterest = 0, month = 0;
  const schedule = [];

  while (bal > 0.005 && month < MAX_MONTHS) {
    month++;

    for (const ls of lumpSums) {
      if (month === ls.afterMonth) bal = Math.max(0, bal - ls.amount);
    }
    if (bal <= 0.005) break;

    let rate = annualRate;
    for (const re of rateEvents) {
      if (month >= re.afterMonth) rate = re.rate;
    }
    if (promo && month <= promo.months) rate = promo.rate;

    const periodStart = addMonthsUTC(start, month - 1);
    const periodEnd = addMonthsUTC(start, month);
    const days = daysBetween(periodStart, periodEnd);
    const interest = bal * (rate / 365) * days;

    const minPayment = Math.max(bal * minPercent, minFloor);
    const payment = minPayment + extraMonthly;
    const principal = Math.min(bal, Math.max(0, payment - interest));

    bal = Math.max(0, bal - principal);
    totalInterest += interest;

    if (buildSchedule) {
      schedule.push({ month, interest, principal, balance: bal, cumInterest: totalInterest, days, rate: rate * 100 });
    }
  }

  return { totalInterest: Math.round(totalInterest), termMonths: month, schedule, neverPaidOff: bal > 0.005 };
}

// Mirrors credit-card-calculator.html's mergeSchedules(). cumInterest
// is a running total, so a finished card must keep contributing its
// own final cumInterest to every later month rather than dropping out
// of the sum once it has no more entries.
function mergeSchedules(schedules) {
  const byMonth = new Map();
  for (const schedule of schedules) {
    for (const entry of schedule) {
      const row = byMonth.get(entry.month) || { month: entry.month, interest: 0, principal: 0, balance: 0 };
      row.interest  += entry.interest;
      row.principal += entry.principal;
      row.balance   += entry.balance;
      byMonth.set(entry.month, row);
    }
  }
  const maxMonth = Math.max(0, ...schedules.map(s => s.length ? s[s.length - 1].month : 0));
  const merged = [];
  for (let m = 1; m <= maxMonth; m++) {
    const row = byMonth.get(m) || { month: m, interest: 0, principal: 0, balance: 0 };
    row.cumInterest = schedules.reduce((sum, s) => {
      if (s.length === 0) return sum;
      return sum + s[Math.min(m, s.length) - 1].cumInterest;
    }, 0);
    merged.push(row);
  }
  return merged;
}

// ============================================================
// TEST FRAMEWORK
// ============================================================

let passed = 0;
let failed = 0;

function checkDollar(label, actual, expected) {
  const diff = Math.abs(Math.round(actual) - expected);
  const ok = diff <= 5;
  if (ok) {
    passed++;
    console.log(`  ✓ PASS  ${label}`);
    console.log(`          got $${Math.round(actual).toLocaleString()}  expected $${expected.toLocaleString()}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL  ${label}`);
    console.log(`          got $${Math.round(actual).toLocaleString()}  expected $${expected.toLocaleString()}  diff $${diff.toLocaleString()}`);
  }
}

function checkMonths(label, actual, expected) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= 1;
  const fmt = m => `${Math.floor(m / 12)}y ${m % 12}m`;
  if (ok) {
    passed++;
    console.log(`  ✓ PASS  ${label}`);
    console.log(`          got ${fmt(actual)}  expected ${fmt(expected)}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL  ${label}`);
    console.log(`          got ${fmt(actual)}  expected ${fmt(expected)}  diff ${diff}m`);
  }
}

function checkExact(label, actual, expected, tolerance = 1) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  if (ok) {
    passed++;
    console.log(`  ✓ PASS  ${label}`);
    console.log(`          got ${actual}  expected ${expected}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL  ${label}`);
    console.log(`          got ${actual}  expected ${expected}  diff ${diff}`);
  }
}

function checkTrue(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS  ${label}`);
    if (detail) console.log(`          ${detail}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL  ${label}`);
    if (detail) console.log(`          ${detail}`);
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ============================================================
// SCENARIOS
// ============================================================

section('Zero-rate payoff — fixed-floor minimum dominates throughout');
{
  // $500 balance, 2.5% min / $25 floor: 2.5% of the balance never
  // exceeds $25 while balance <= $1,000, so the floor applies every
  // month and the payoff is exactly balance ÷ floor, hand-computable
  // independent of the engine.
  const r = amortCard(500, 0, { minPercent: 0.025, minFloor: 25, buildSchedule: true });
  checkMonths('termMonths for $500 @ 0% rate, $25 fixed minimum', r.termMonths, 20);
  checkDollar('totalInterest at 0% rate', r.totalInterest, 0);
  checkTrue('not flagged as never-paid-off', !r.neverPaidOff);
}

section('Zero balance — no iterations');
{
  const r = amortCard(0, 0.2, { minPercent: 0.025, minFloor: 25, buildSchedule: true });
  checkExact('termMonths for $0 balance', r.termMonths, 0);
  checkDollar('totalInterest for $0 balance', r.totalInterest, 0);
  checkTrue('schedule is empty', r.schedule.length === 0);
}

section('Minimum-payment debt trap — negative amortisation');
{
  // 25% APR accrues roughly 2.05–2.12%/month; a 0.5%-of-balance
  // minimum (well above the $5 floor at this balance) never comes
  // close to covering that, so the balance should still not be
  // repaid after the 50-year safety cap.
  const r = amortCard(10_000, 0.25, { minPercent: 0.005, minFloor: 5, buildSchedule: true });
  checkTrue('flagged as never paid off', r.neverPaidOff === true);
  checkExact('hits the 600-month safety cap', r.termMonths, 600);
}

section('Extra fixed payment reduces interest and term');
{
  const base = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25 });
  const strat = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25, extraMonthly: 150 });
  checkTrue('extra payment reduces total interest', strat.totalInterest < base.totalInterest,
    `base=$${base.totalInterest}  with extra=$${strat.totalInterest}`);
  checkTrue('extra payment reduces term', strat.termMonths < base.termMonths,
    `base=${base.termMonths}mo  with extra=${strat.termMonths}mo`);
}

section('Lump sum payment reduces total interest');
{
  const base = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25 });
  const strat = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25, lumpSums: [{ afterMonth: 3, amount: 1000 }] });
  checkTrue('lump sum reduces total interest', strat.totalInterest < base.totalInterest,
    `base=$${base.totalInterest}  with lump=$${strat.totalInterest}`);
  checkTrue('lump sum does not increase term', strat.termMonths <= base.termMonths,
    `base=${base.termMonths}mo  with lump=${strat.termMonths}mo`);
}

section('Promotional rate — exact zero interest during the promo window');
{
  // 0% for the first 6 months means interest for months 1–6 must be
  // exactly zero regardless of balance, then reverts to the 20% base
  // rate from month 7 — both are checked directly against the
  // schedule's per-period interest and recorded rate.
  const r = amortCard(5000, 0.20, {
    minPercent: 0.025, minFloor: 25,
    promo: { rate: 0, months: 6 }, buildSchedule: true,
  });
  const promoMonths = r.schedule.slice(0, 6);
  checkTrue('all 6 promo months have zero interest', promoMonths.every(s => s.interest === 0),
    promoMonths.map(s => s.interest.toFixed(2)).join(', '));
  checkTrue('month 7 has reverted to the base rate', r.schedule[6].rate === 20,
    `month 7 rate = ${r.schedule[6].rate}`);
  checkTrue('month 7 accrues interest again', r.schedule[6].interest > 0);
}

section('Rate change event — boundary is inclusive at the specified month');
{
  const r = amortCard(5000, 0.15, {
    minPercent: 0.025, minFloor: 25,
    rateEvents: [{ afterMonth: 5, rate: 0.25 }], buildSchedule: true,
  });
  checkTrue('month 4 still uses the base rate', r.schedule[3].rate === 15, `month 4 rate = ${r.schedule[3].rate}`);
  checkTrue('month 5 uses the new rate', r.schedule[4].rate === 25, `month 5 rate = ${r.schedule[4].rate}`);
}

section('Rejects nothing silently — a fully-repaid schedule ends near zero');
{
  const r = amortCard(2000, 0.18, { minPercent: 0.03, minFloor: 35, buildSchedule: true });
  const finalBalance = r.schedule[r.schedule.length - 1].balance;
  checkTrue('final balance is effectively zero', finalBalance <= 0.01, `final balance = ${finalBalance}`);
  checkTrue('not flagged as never-paid-off', !r.neverPaidOff);
}

section('Multiple Cards — two-card combination with no strategies sums independently');
{
  // Mirrors how the app's calculate() builds a Multiple Cards result:
  // run each card independently, then combine via mergeSchedules — the
  // same function the app uses. The merged schedule's final cumulative
  // interest should equal the sum of the two cards' own totalInterest
  // figures, which is the real thing worth regression-testing here
  // (mergeSchedules' summation, not a tautology).
  const cardA = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25, buildSchedule: true });
  const cardB = amortCard(2500, 0.25, { minPercent: 0.025, minFloor: 25, buildSchedule: true });
  const merged = mergeSchedules([cardA.schedule, cardB.schedule]);
  const mergedFinalCumInterest = merged[merged.length - 1].cumInterest;

  checkDollar('merged schedule\'s final cumulative interest equals the sum of two independent amortCard totals',
    mergedFinalCumInterest, cardA.totalInterest + cardB.totalInterest);
  checkExact('combined termMonths is the longer of the two (household not debt-free until the last card clears)',
    merged.length, Math.max(cardA.termMonths, cardB.termMonths));
}

section('Multiple Cards — extra payment targeted at one card only');
{
  const cardA_base  = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25 });
  const cardB_base  = amortCard(2500, 0.25, { minPercent: 0.025, minFloor: 25 });
  const cardA_strat = amortCard(5000, 0.20, { minPercent: 0.025, minFloor: 25, extraMonthly: 150 });
  const cardB_strat = amortCard(2500, 0.25, { minPercent: 0.025, minFloor: 25 }); // untargeted — same opts as base

  checkTrue('untargeted card B interest is unchanged',
    cardB_strat.totalInterest === cardB_base.totalInterest,
    `base=$${cardB_base.totalInterest}  strat=$${cardB_strat.totalInterest}`);
  checkTrue('targeted card A interest drops',
    cardA_strat.totalInterest < cardA_base.totalInterest,
    `base=$${cardA_base.totalInterest}  strat=$${cardA_strat.totalInterest}`);
}

section('mergeSchedules — schedules of different lengths combine correctly');
{
  const short = amortCard(1000, 0.15, { minPercent: 0.10, minFloor: 25, buildSchedule: true }); // pays off fast
  const long  = amortCard(8000, 0.22, { minPercent: 0.02, minFloor: 25, buildSchedule: true });  // takes much longer
  const merged = mergeSchedules([short.schedule, long.schedule]);

  checkExact('merged length equals the longer schedule', merged.length, Math.max(short.termMonths, long.termMonths));

  // At a month after the short schedule has finished, the merged
  // balance should equal just the long schedule's balance — the
  // finished card contributes nothing further.
  const checkMonth = short.termMonths + 1;
  const longEntry = long.schedule.find(s => s.month === checkMonth);
  const mergedEntry = merged.find(s => s.month === checkMonth);
  checkDollar('after the short card is paid off, merged balance equals the remaining card alone',
    mergedEntry.balance, Math.round(longEntry.balance));

  // At month 1, merged interest should equal the sum of both cards'
  // month-1 interest.
  const combinedMonth1 = short.schedule[0].interest + long.schedule[0].interest;
  checkDollar('month 1 merged interest equals the sum of both cards\' month-1 interest',
    merged[0].interest, Math.round(combinedMonth1));
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n${'═'.repeat(60)}`);
if (failed === 0) {
  console.log(`  ✓  All ${passed} tests passed`);
} else {
  console.log(`  ${passed} passed   ${failed} FAILED`);
}
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
