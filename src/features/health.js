/**
 * @file src/features/health.js
 * @module features/health
 *
 * PURPOSE
 * The personal health record: body profile, weight, blood pressure, exercise,
 * sleep, blood oxygen, blood glucose, body fat, waist, plus the progress view
 * that turns all of that into trends.
 *
 * SINGLE SOURCE OF TRUTH
 * This module owns the health records. My Day reads them but never writes
 * them, which is what stops a weight being recorded twice once a user
 * completes onboarding.
 */

import { byId, escapeHtml, formatOneDecimal, todayKey } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { foodById } from '../../data/catalogue.js';
import { clamp } from '../../nutrition.js';
import { currentGoals, bodyMassIndex, bodyMassIndexBand } from '../services/healthProfile.js';
import { summariseDay, progressPct, MILLILITRES_PER_GLASS } from '../services/dailyNutrition.js';

const CHART_DAYS = 7;
const DAILY_STEP_TARGET = 10000;
const NIGHTLY_SLEEP_TARGET_HOURS = 8;

// ── Blood pressure classification ────────────────────────────────────────────

/**
 * Descriptive band for a reading. This restates widely used clinical
 * thresholds; it is not a diagnosis and the UI never presents it as one.
 */
function bloodPressureCategory(reading) {
  const { systolic, diastolic } = reading;
  if (systolic < 120 && diastolic < 80) return 'Normal';
  if (systolic < 140 && diastolic < 90) return 'Elevated';
  if ((systolic >= 140 && systolic < 180) || diastolic >= 90) return 'Stage 1';
  return 'Stage 2';
}

function daysSince(timestamp) {
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return 'just now';
  const days = Math.round((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function persist() {
  saveState(message => showNotice(message));
}

// ── List rendering ───────────────────────────────────────────────────────────

function renderWeightHistory() {
  byId('weightList').innerHTML = state.weights.length
    ? state.weights.slice().reverse().map(record =>
      `<div class="entry"><strong>${record.value} kg</strong><small>${escapeHtml(record.at)}</small></div>`).join('')
    : '<p class="empty">No weight recorded.</p>';
}

function renderPressureHistory() {
  byId('pressureList').innerHTML = state.pressures.length
    ? state.pressures.slice().reverse().map(record =>
      `<div class="entry"><strong>${record.systolic}/${record.diastolic} mmHg</strong>
        <small>${escapeHtml(record.at)} · ${bloodPressureCategory(record)}</small></div>`).join('')
    : '<p class="empty">No manual readings recorded.</p>';
}

function renderVitalsHistory() {
  byId('vitalsList').innerHTML = state.vitals.length
    ? state.vitals.slice().reverse().slice(0, 12).map(record => {
      const parts = [
        record.hr ? `${record.hr} bpm` : null,
        record.spo2 ? `${record.spo2}% SpO2` : null,
        record.glucose ? `${record.glucose} mg/dL` : null,
        record.bodyFat ? `${record.bodyFat}% fat` : null,
        record.waist ? `${record.waist} cm waist` : null,
      ].filter(Boolean);
      return `<div class="entry"><strong>${escapeHtml(parts.join(' · '))}</strong>
        <small>${escapeHtml(record.at)}</small></div>`;
    }).join('')
    : '<p class="empty">No vitals recorded yet.</p>';
}

function renderExerciseHistory() {
  byId('exerciseList').innerHTML = state.exercise.length
    ? state.exercise.slice().reverse().map(record =>
      `<div class="entry"><div>
        <strong>${escapeHtml(record.workout || 'Walk')}</strong>
        <small>${(record.steps || 0).toLocaleString()} steps · ${record.activeMinutes || 0} min · ${escapeHtml(record.at)}</small>
      </div></div>`).join('')
    : '<p class="empty">No exercise logged today.</p>';
}

function renderSleepHistory() {
  byId('sleepList').innerHTML = state.sleep.length
    ? state.sleep.slice().reverse().map(record =>
      `<div class="entry"><div>
        <strong>${formatOneDecimal(record.hours || 0)} h</strong>
        <small>${escapeHtml(record.quality || '—')} · ${escapeHtml(record.at)}</small>
      </div></div>`).join('')
    : '<p class="empty">No sleep logged.</p>';
}

// ── Profile, targets, progress ───────────────────────────────────────────────

function renderProfile() {
  const latestWeight = state.weights[state.weights.length - 1];
  const profile = state.profile;

  if (profile) {
    byId('height').value = profile.height;
    byId('age').value = profile.age;
    byId('sex').value = profile.sex;
    byId('activity').value = profile.activity;
  }

  const bodyMass = profile && latestWeight ? bodyMassIndex(latestWeight.value, profile.height) : null;
  byId('profileOut').innerHTML = profile && latestWeight
    ? `<div class="mini-metrics">
        <div><span>BMI</span><strong>${formatOneDecimal(bodyMass)}</strong><small>${bodyMassIndexBand(bodyMass)}</small></div>
        <div><span>TDEE</span><strong>${currentGoals(state)?.calories ?? '—'}</strong><small>kcal estimate</small></div>
        <div><span>Goals</span><strong>${state.goals ? 'set' : '—'}</strong><small>in My Day</small></div>
      </div>`
    : '<p class="empty">Save your profile and at least one weight to see BMI and energy needs.</p>';
}

function renderTargets() {
  const goals = currentGoals(state);
  byId('targets').innerHTML = goals
    ? `<div class="mini-metrics">
        <div><span>Calories</span><strong>${goals.calories}</strong><small>kcal / day</small></div>
        <div><span>Protein</span><strong>${goals.protein} g</strong><small>${goals.weightGoal}</small></div>
        <div><span>Carbs</span><strong>${goals.carbs} g</strong><small>reference</small></div>
        <div><span>Fat</span><strong>${goals.fat} g</strong><small>reference</small></div>
      </div>
      <p class="fine">Derived from your height, age, sex, activity and latest weight. Reference values only.</p>`
    : '<p class="empty">Add a body profile and a weight to unlock your targets.</p>';
}

function recentDateKeys(count) {
  const keys = [];
  for (let daysBack = count - 1; daysBack >= 0; daysBack -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    keys.push(todayKeyFrom(date));
  }
  return keys;
}

function todayKeyFrom(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderProgressBars() {
  const goals = currentGoals(state);
  if (!goals) {
    byId('progress').innerHTML = '<p class="fine">Set a body profile to compare today against estimated targets.</p>';
    return;
  }

  const summary = summariseDay({
    entries: state.entries.filter(entry => entry.date === todayKey()),
    foodsById: foodById,
    goals,
    waterGlasses: state.water[todayKey()] || 0,
  });

  const todayExercise = state.exercise.filter(record =>
    new Date(record.at).toDateString() === new Date(todayKey()).toDateString());
  const todaySteps = todayExercise.reduce((sum, record) => sum + (record.steps || 0), 0);

  const rows = [
    ['Calories', summary.energy, goals.calories, ' kcal'],
    ['Protein', summary.protein, goals.protein, ' g'],
    ['Carbs', summary.carbs, goals.carbs, ' g'],
    ['Fat', summary.fat, goals.fat, ' g'],
    ['Steps', todaySteps, DAILY_STEP_TARGET, ''],
    ['Water', summary.waterLitres, goals.waterL, ' L'],
    ['Sleep', 0, NIGHTLY_SLEEP_TARGET_HOURS, ' h'],
  ];

  byId('progress').innerHTML = rows.map(([label, actual, target, unit]) => {
    const percentage = progressPct(actual, target);
    const colour = percentage >= 100 ? 'var(--p-done)' : percentage >= 60 ? 'var(--p-mid)' : 'var(--p-low)';
    return `<div class="bar-row">
      <div class="bar-top"><span>${label}</span><strong>${Math.round(actual)}${unit} / ${Math.round(target)}${unit}</strong></div>
      <div class="bar"><i style="width:${Math.min(100, percentage)}%;background:${colour}"></i></div>
    </div>`;
  }).join('');
}

function renderWeeklyChart() {
  const dateKeys = recentDateKeys(CHART_DAYS);
  const summaries = dateKeys.map(dateKey => summariseDay({
    entries: state.entries.filter(entry => entry.date === dateKey),
    foodsById: foodById,
    goals: state.goals,
    waterGlasses: state.water[dateKey] || 0,
  }));

  const peakCalories = Math.max(100, ...summaries.map(summary => summary.energy));
  const peakSteps = Math.max(1000, ...summaries.map(summary => summary.servings.veg * 1000));

  byId('weekly').innerHTML = `<div class="wk-grid">${summaries.map((summary, index) => {
    const weekday = new Date(`${dateKeys[index]}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    const sleep = state.sleep.find(record => new Date(record.at).toDateString() === new Date(dateKeys[index]).toDateString());
    return `<div class="wk-col">
      <div class="wk-bars">
        <i class="wk-e" style="height:${Math.round(summary.energy / peakCalories * 100)}%" title="${Math.round(summary.energy)} kcal"></i>
        <i class="wk-s" style="height:${Math.round(summary.servings.veg * 1000 / peakSteps * 100)}%" title="${summary.servings.veg} vegetable servings"></i>
      </div>
      <span>${weekday}</span>
      <small>${sleep ? `${formatOneDecimal(sleep.hours)}h` : ''}</small>
    </div>`;
  }).join('')}</div>`;
}

// ── Forms ────────────────────────────────────────────────────────────────────

function wireForms() {
  byId('weightForm').onsubmit = event => {
    event.preventDefault();
    const value = Number(byId('weight').value);
    if (value < 1 || value > 500) return;
    state.weights.push({ value, at: new Date().toLocaleString() });
    persist();
    event.target.reset();
    renderHealth();
  };

  byId('pressureForm').onsubmit = event => {
    event.preventDefault();
    const systolic = Number(byId('systolic').value);
    const diastolic = Number(byId('diastolic').value);
    if (systolic < 50 || systolic > 300 || diastolic < 30 || diastolic > 200 || systolic <= diastolic) {
      showNotice('Check the entered values: the top number must be higher than the bottom one.');
      return;
    }
    state.pressures.push({ systolic, diastolic, at: new Date().toLocaleString() });
    persist();
    event.target.reset();
    renderHealth();
  };

  byId('exerciseForm').onsubmit = event => {
    event.preventDefault();
    const steps = Number(byId('steps').value);
    const activeMinutes = Number(byId('activeMinutes').value);
    if ((steps && steps < 0) || (activeMinutes && activeMinutes < 0)) return;
    state.exercise.push({
      steps: steps || 0,
      activeMinutes: activeMinutes || 0,
      workout: byId('workout').value,
      at: new Date().toLocaleString(),
    });
    persist();
    event.target.reset();
    renderHealth();
  };

  byId('sleepForm').onsubmit = event => {
    event.preventDefault();
    const hours = Number(byId('sleepHours').value);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      showNotice('Enter between 0 and 24 hours.');
      return;
    }
    state.sleep.push({ hours, quality: byId('sleepQuality').value, at: new Date().toLocaleString() });
    persist();
    event.target.reset();
    renderHealth();
  };

  byId('profileForm').onsubmit = event => {
    event.preventDefault();
    const height = Number(byId('height').value);
    const age = Number(byId('age').value);
    if (!Number.isFinite(height) || height < 50 || height > 260 || !Number.isFinite(age) || age < 10 || age > 120) {
      showNotice('Enter height 50–260 cm and age 10–120.');
      return;
    }
    state.profile = {
      ...(state.profile || {}),
      height, age,
      sex: byId('sex').value,
      activity: Number(byId('activity').value),
    };
    persist();
    renderHealth();
  };

  byId('vitalsForm').onsubmit = event => {
    event.preventDefault();
    const read = elementId => {
      const raw = byId(elementId).value.trim();
      return raw === '' ? null : Number(raw);
    };
    const reading = {
      hr: read('restHr'), spo2: read('spo2'), glucose: read('glucose'),
      bodyFat: read('bodyFat'), waist: read('waist'),
    };
    if (Object.values(reading).every(value => value === null)) {
      showNotice('Enter at least one reading.');
      return;
    }
    const ranges = {
      hr: [20, 250, 'Heart rate 20–250 bpm'],
      spo2: [70, 100, 'Blood oxygen 70–100%'],
      glucose: [20, 600, 'Glucose 20–600 mg/dL'],
      bodyFat: [2, 70, 'Body fat 2–70%'],
      waist: [30, 200, 'Waist 30–200 cm'],
    };
    for (const [key, [min, max, message]] of Object.entries(ranges)) {
      const value = reading[key];
      if (value !== null && (value < min || value > max)) {
        showNotice(message);
        return;
      }
    }
    state.vitals.push({ ...reading, at: new Date().toLocaleString() });
    persist();
    event.target.reset();
    renderHealth();
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function renderHealth() {
  renderProfile();
  renderTargets();
  renderVitalsHistory();
  renderProgressBars();
  renderWeeklyChart();
  renderWeightHistory();
  renderPressureHistory();
  renderExerciseHistory();
  renderSleepHistory();
}

export function mountHealthFeature() {
  wireForms();
  renderHealth();
}

export { bloodPressureCategory, MILLILITRES_PER_GLASS, clamp };
