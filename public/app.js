'use strict';

const USERNAME_KEY = 'protein-club.username';
const DAY_LIMIT = 300;
const CHEAT_LIMIT = 3;
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const QUICK_FOODS = ['chicken-breast', 'greek-yogurt', 'eggs', 'paneer'];
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m13.5 6.5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13m-8 3v7m4-7v7"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  moon: '<path d="M20.4 15.3A8.6 8.6 0 0 1 8.7 3.6a8.6 8.6 0 1 0 11.7 11.7Z"/>',
  bowl: '<path d="M3 11h18a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8Zm4 10h10M8 8V5m4 3V3m4 5V5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
};

const state = {
  account: null,
  plan: previewPlan(),
  catalog: [],
  selected: 0,
  view: 'planner',
  category: 'All foods',
  search: '',
  admin: null,
  pending: false,
  formPending: false,
  afterSignin: null,
};

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dateFormat = (date, options) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const protein = (entry) => entry.serving * entry.proteinPer100 / 100;
const dayProtein = (day) => day.entries.reduce((sum, entry) => sum + protein(entry), 0);
const planProtein = (days) => days.reduce((sum, day) => sum + dayProtein(day), 0);
const cheaters = (days) => days.filter((day) => day.cheat).length;
const foodById = (id) => state.catalog.find((food) => food.id === id);
const selectedDay = () => state.plan.days[state.selected];
const format = (value) => numberFormat.format(value);
const percentage = (part, total) => total ? Math.min(100, Math.round(part / total * 100)) : 0;
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const icon = (name) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

function localDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

function nextDate(date, offset) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function previewPlan() {
  const entry = (foodId, serving, proteinPer100) => ({ foodId, serving, proteinPer100 });
  const sample = [
    [entry('chicken-breast', 180, 31), entry('greek-yogurt', 150, 10.2), entry('eggs', 100, 12.6)],
    [entry('chicken-breast', 180, 31), entry('protein-powder', 35, 79), entry('greek-yogurt', 200, 10.2)],
    [entry('paneer', 200, 18.9), entry('eggs', 150, 12.6), entry('protein-powder', 35, 79)],
    [],
    [entry('canned-tuna', 150, 19.4), entry('chicken-breast', 200, 31), entry('greek-yogurt', 200, 10.2)],
    [entry('tofu', 200, 17.3), entry('eggs', 100, 12.6), entry('protein-powder', 35, 79)],
    [],
  ];
  const today = localDate();
  return {
    today, startDate: today, goal: 120, templates: [],
    days: sample.map((entries, index) => ({ date: nextDate(today, index), cheat: index === 3, entries })),
  };
}

function rangeLabel(start, end) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const first = dateFormat(start, { month: 'short', day: 'numeric' });
  const last = dateFormat(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${first} – ${last}`;
}

function image(food, className) {
  if (!food) return `<span class="${className}">${icon('bowl')}</span>`;
  return `<span class="${className}">
    <img src="/images/${encodeURIComponent(food.asset)}.webp" alt="" decoding="async">
  </span>`;
}

function setText(id, value) {
  if ($(id)) $(id).textContent = value;
}

function setHTML(id, value) {
  if ($(id)) $(id).innerHTML = value;
}

function render() {
  for (const [name, id] of [['planner', 'viewPlanner'], ['library', 'viewLibrary'], ['admin', 'viewAdmin']]) {
    if ($(id)) $(id).hidden = state.view !== name;
    document.querySelectorAll(`[data-action="${name}"]`).forEach((control) => {
      if (control.closest('nav')) {
        control.classList.toggle('is-active', state.view === name);
        control.setAttribute('aria-current', state.view === name ? 'page' : 'false');
      }
    });
  }
  setText('accountLabel', state.account?.username ?? 'Guest');
  setText('accountInitial', state.account?.username.slice(0, 1).toUpperCase() ?? 'G');
  setText('accountMode', state.account?.isAdmin ? 'Administrator' : state.account ? 'Member' :
    navigator.onLine ? 'Preview mode' : 'Offline preview');
  setText('breadcrumb', { planner: 'Weekly planner', library: 'Food library', admin: 'Manage accounts' }[state.view]);
  setText('pageTitle', { planner: 'Your protein plan', library: 'Food library', admin: 'Manage accounts' }[state.view]);
  setText('pageSubtitle', {
    planner: 'Plan your servings, one week at a time.',
    library: 'Choose a food and set how much you plan to eat.',
    admin: 'Manage user accounts and the number of available slots.',
  }[state.view]);
  if ($('headerAction')) {
    $('headerAction').dataset.action = state.account ? 'add' : 'signin';
    $('headerAction').querySelector('[data-label]').textContent = state.account ? 'Add food' : 'Enter username';
    $('headerAction').hidden = state.view !== 'planner';
  }
  document.body.dataset.signedIn = String(Boolean(state.account));
  document.querySelectorAll('[data-admin-only]').forEach((element) => {
    element.hidden = !state.account?.isAdmin;
  });
  renderPlanner();
  if (state.view === 'library') renderLibrary();
  if (state.view === 'admin') renderAdmin();
}

function renderPlanner() {
  const { days, goal, today, renewed, templates } = state.plan;
  const current = selectedDay();
  const total = planProtein(days);
  const targets = goal * (days.length - cheaters(days));
  const percent = percentage(total, targets);
  const dayTotal = dayProtein(current);
  const goalDays = days.filter((day) => !day.cheat && dayProtein(day) >= goal - 0.000001).length;

  setText('dateRange', rangeLabel(days[0].date, days.at(-1).date));
  setText('heroTotal', `${format(total)} g`);
  setText('heroGoal', `/ ${format(targets)} g`);
  setText('heroPercent', `${percent}%`);
  setText('heroMeta', `${goalDays} of ${days.length - cheaters(days)} days planned to goal`);
  setText('heroDailyGoal', format(goal));
  setText('sidebarGoal', `${format(goal)} g protein`);
  setText('heroDays', `${goalDays}/${days.length - cheaters(days)}`);
  setText('dayTitle', current.date === today ? 'Today’s plan' : `${dateFormat(current.date, { weekday: 'long' })}’s plan`);
  setText('daySubtitle', dateFormat(current.date, { weekday: 'long', month: 'short', day: 'numeric' }));
  setText('dayTotal', `${format(dayTotal)} g`);
  setText('dayGoal', `${format(goal)} g`);
  setText('cheatCount', `${cheaters(days)} / ${CHEAT_LIMIT}`);

  if ($('heroBar')) {
    $('heroBar').style.width = `${percent}%`;
    $('heroBar').closest('[role="progressbar"]')?.setAttribute('aria-valuenow', percent);
  }
  if ($('dayBar')) {
    const dayPercent = percentage(dayTotal, goal);
    $('dayBar').style.width = `${dayPercent}%`;
    $('dayBar').closest('[role="progressbar"]')?.setAttribute('aria-valuenow', dayPercent);
  }
  if ($('renewal')) {
    $('renewal').hidden = !(renewed && templates.length);
    if (renewed && templates.length) {
      setHTML('renewal', `<span>${icon('clock')} Your next seven days are ready to plan.</span><button class="text-button" type="button" data-action="templates">Reuse a past week ${icon('arrow')}</button>`);
    }
  }

  setHTML('weekDays', days.map((day, index) => {
    const active = index === state.selected;
    const isToday = day.date === today;
    const total = dayProtein(day);
    return `<button type="button" data-action="day" data-index="${index}"
      class="week-day${active ? ' is-selected' : ''}${day.cheat ? ' is-cheat' : ''}"
      aria-pressed="${active}" aria-label="${safe(dateFormat(day.date, { weekday: 'long', month: 'long', day: 'numeric' }))}, ${day.cheat ? 'cheat day' : `${format(total)} grams planned`}">
      <span class="week-day-top">
        <span class="week-day-label">${isToday ? 'Today' : dateFormat(day.date, { weekday: 'short' })}</span>
        <span class="week-day-date">${dateFormat(day.date, { day: 'numeric' })}</span>
      </span>
      <span class="week-day-total">${day.cheat ? `${icon('moon')} <small>Cheat day</small>` : `${format(total)} <small>g</small>`}</span>
      <span class="week-day-track"><span style="width:${percentage(total, goal)}%"></span></span>
    </button>`;
  }).join(''));

  for (const element of document.querySelectorAll('[data-action="cheat"]')) {
    element.setAttribute('aria-pressed', current.cheat);
    const action = current.cheat ? 'Resume planning' : 'Make cheat day';
    element.setAttribute('aria-label', action);
    element.title = action;
    const label = element.querySelector('[data-label]');
    if (label) label.textContent = action;
  }
  for (const element of document.querySelectorAll('[data-action="add"]')) {
    element.disabled = current.cheat;
  }

  setHTML('dayEntries', current.cheat
    ? emptyState('moon', 'Cheat day', 'No protein entries can be scheduled for this day.')
    : current.entries.length
      ? current.entries.map(renderEntry).join('')
      : emptyState('bowl', 'No food planned yet', 'Add a food and set a serving size.', 'add', 'Add food'));

  setHTML('quickFoods', QUICK_FOODS.map(foodById).filter(Boolean).map((food) =>
    `<button type="button" data-action="food" data-id="${safe(food.id)}" class="quick-food" aria-label="Add ${safe(food.name)}" ${current.cheat ? 'disabled' : ''}>
      ${image(food, 'quick-food-image')}
      <span class="quick-food-info"><strong>${safe(food.name)}</strong><small>${format(food.protein)} g / 100 g</small></span>
      <span class="quick-food-add">${icon('plus')}</span>
    </button>`).join(''));
}

function emptyState(symbol, title, description, action, label) {
  return `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span>
    <strong>${title}</strong><p>${description}</p>
    ${action ? `<button type="button" class="button-secondary" data-action="${action}">${icon('plus')} ${label}</button>` : ''}
  </div>`;
}

function renderEntry(entry, index) {
  const food = foodById(entry.foodId);
  const name = food?.name ?? entry.foodId.replaceAll('-', ' ');
  return `<div class="entry-row">
    <div class="entry-food">${image(food, 'entry-image')}
      <span class="entry-description"><strong>${safe(name)}</strong><small>${format(entry.serving)} g serving · ${format(entry.proteinPer100)} g / 100 g</small></span>
    </div>
    <strong class="entry-protein">${format(protein(entry))} <small>g</small></strong>
    <div class="entry-actions">
      <button class="icon-button" data-action="edit-food" data-index="${index}" type="button" title="Edit ${safe(name)}" aria-label="Edit ${safe(name)}">${icon('edit')}</button>
      <button class="icon-button" data-action="remove-food" data-index="${index}" type="button" title="Remove ${safe(name)}" aria-label="Remove ${safe(name)}">${icon('trash')}</button>
    </div>
  </div>`;
}

function renderLibrary() {
  const categories = ['All foods', ...new Set(state.catalog.map((food) => food.category))];
  if ($('libraryControls')) $('libraryControls').classList.add('library-controls');
  setHTML('libraryControls', `<label class="library-search">${icon('search')}
    <input type="search" id="foodSearch" aria-label="Search foods" placeholder="Search foods" value="${safe(state.search)}">
  </label>
  <div class="category-list" aria-label="Food categories">
    ${categories.map((category) => `<button type="button" class="category-button${category === state.category ? ' is-active' : ''}" data-action="category" data-category="${safe(category)}" aria-pressed="${category === state.category}">${safe(category)}</button>`).join('')}
  </div>`);
  renderLibraryFoods();
}

function renderLibraryFoods() {
  const search = state.search.trim().toLowerCase();
  const foods = state.catalog.filter((food) =>
    (state.category === 'All foods' || food.category === state.category)
    && `${food.name} ${food.category} ${food.subcategory ?? ''} ${food.preparation}`.toLowerCase().includes(search));
  setHTML('libraryFoods', foods.length ? foods.map((food) => `<article class="library-food-card">
    ${image(food, 'library-food-image')}
    <div class="library-food-info">
      <strong>${safe(food.name)}</strong><small>${safe(food.preparation)}</small>
      <div class="library-food-meta"><span><b>${format(food.protein)} g</b> / 100 g</span>
        <button class="icon-button" type="button" data-action="food" data-id="${safe(food.id)}" aria-label="Add ${safe(food.name)}">${icon('plus')}</button></div>
    </div>
  </article>`).join('') : emptyState('search', 'No matching foods', 'Try another food name or category.'));
}

function renderAdmin() {
  if (!state.admin) {
    setHTML('adminContent', '<p>Loading accounts…</p>');
    return;
  }
  const { maxAccounts, users } = state.admin;
  const usage = users.length > maxAccounts
    ? `${users.length} active ${users.length === 1 ? 'account' : 'accounts'} with a limit of ${maxAccounts}. New sign-ups are closed.`
    : `${users.length} of ${maxAccounts} user accounts in use.`;
  setHTML('adminContent', `
    <section class="settings-card">
      <h2>Account limit</h2>
      <p>${usage}</p>
      <form data-form="limit" class="limit-form">
        <label class="field">Maximum accounts<input name="limit" required type="number" min="0" max="100000" step="1" value="${maxAccounts}"></label>
        <button class="button-primary" type="submit">Save limit</button>
        <p class="form-error" hidden role="alert"></p>
      </form>
    </section>
    <section class="settings-card">
      <h2>User accounts</h2>
      ${users.length ? users.map(({ username, createdAt }) => `<div class="user-row">
        <span><strong>${safe(username)}</strong>${createdAt ? `<small>Joined ${safe(new Date(createdAt).toLocaleDateString())}</small>` : ''}</span>
        <button class="icon-button" type="button" data-action="delete-user" data-username="${safe(username)}" aria-label="Delete ${safe(username)}">${icon('trash')}</button>
      </div>`).join('') : '<p>No user accounts yet.</p>'}
    </section>`);
}

async function request(path, method = 'GET', body, username = state.account?.username) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (username && !(path === 'session' && method === 'POST')) headers['X-Plan-Username'] = username;
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Could not connect. Check your connection and try again.'), { offline: true });
  }
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(result.error ?? 'Something went wrong. Try again.'), {
      code: result.code,
      status: response.status,
    });
  }
  return result;
}

function rememberedName(name) {
  try {
    if (name === undefined) return localStorage.getItem(USERNAME_KEY);
    if (name) localStorage.setItem(USERNAME_KEY, name);
    else localStorage.removeItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

function openDialog(title, description, contents, className = '') {
  const dialog = $('dialog');
  dialog.setAttribute('aria-labelledby', 'dialogTitle');
  dialog.innerHTML = `<div class="dialog-body ${className}">
    <div class="dialog-top">
      <div><h2 id="dialogTitle">${title}</h2>${description ? `<p>${description}</p>` : ''}</div>
      <button class="icon-button dialog-close" data-action="close-dialog" aria-label="Close" type="button">${icon('close')}</button>
    </div>
    ${contents}
  </div>`;
  if (!dialog.open) dialog.showModal();
  const focusTarget = dialog.querySelector('[autofocus]') ?? dialog.querySelector('button');
  focusTarget?.focus();
}

function closeDialog() {
  const dialog = $('dialog');
  dialog.close();
  dialog.replaceChildren();
  state.afterSignin = null;
}

function formError(form, text) {
  const element = form.querySelector('.form-error');
  if (!element) return;
  element.textContent = text;
  element.hidden = !text;
}

function formActions(label, { danger = false, cancel = 'Cancel' } = {}) {
  return `<p class="form-error" role="alert" hidden></p><div class="dialog-actions">
    <button type="button" data-action="close-dialog" class="button-secondary">${cancel}</button>
    <button type="submit" class="button-primary${danger ? ' button-danger' : ''}">${label}</button>
  </div>`;
}

function showSignin(username = rememberedName() ?? '') {
  openDialog('Sign in', 'Enter your username to open your protein plan.', `<form data-form="signin">
    <label class="field">Username<input name="username" required autocomplete="username" maxlength="32"
      autocapitalize="off" spellcheck="false" value="${safe(username)}" autofocus></label>
    ${formActions('Continue')}
    <button class="text-button admin-signin" type="button" data-action="admin-signin">Admin sign-in</button>
  </form>`);
}

function showCreate(username) {
  openDialog('Create an account?', `Is <strong>${safe(username)}</strong> your new username? Confirm to start your own plan.`,
    `<form data-form="create-account">
      <input name="username" type="hidden" value="${safe(username)}">
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button class="button-secondary" type="button" data-action="back-signin" data-username="${safe(username)}" autofocus>Go back</button>
        <button class="button-primary" type="submit">Create account</button>
      </div>
    </form>`);
}

function showAdminSignin(username = '') {
  openDialog('Admin sign-in', 'Enter the admin username and key.', `<form data-form="admin-signin">
    <label class="field">Username<input name="username" autocomplete="username" value="${safe(username)}" required ${username ? '' : 'autofocus'}></label>
    <label class="field">Admin key<input name="adminKey" type="password" autocomplete="current-password" required ${username ? 'autofocus' : ''}></label>
    ${formActions('Sign in')}
  </form>`);
}

async function signIn(username, options = {}) {
  const account = await request('session', 'POST', { username, timezone: TIMEZONE, ...options });
  await loadAccount(account);
  const followUp = state.afterSignin;
  closeDialog();
  if (followUp) followUp();
  else if (account.isAdmin) await showAdmin();
  notify(options.create ? 'Account created.' : `Signed in as ${account.username}.`);
}

async function loadAccount(account) {
  const plan = await request('plan', 'GET', undefined, account.username);
  state.account = account;
  if (!account.isAdmin) rememberedName(account.username);
  else rememberedName(null);
  state.plan = plan;
  state.selected = Math.max(0, plan.days.findIndex((day) => day.date === plan.today));
  render();
}

function withAccount(action) {
  if (state.account) action();
  else {
    state.afterSignin = action;
    showSignin();
  }
}

function openFood(foodId, index) {
  const existing = index === undefined ? undefined : selectedDay().entries[index];
  const food = foodById(foodId);
  if (selectedDay().cheat) {
    notify('Resume planning for this day before adding food.', true);
    return;
  }
  if (!food && !existing) return;
  const name = food?.name ?? foodId.replaceAll('-', ' ');
  const serving = existing?.serving ?? food.serving ?? 100;
  const proteinPer100 = existing?.proteinPer100 ?? food.protein;
  openDialog(safe(name), `Plan this serving for ${dateFormat(selectedDay().date, { weekday: 'long', month: 'short', day: 'numeric' })}.`, `
    <form data-form="entry" data-id="${safe(foodId)}" ${existing ? `data-index="${index}"` : ''}>
      <div class="food-form-preview">${image(food, 'dialog-food-image')}<span>${safe(food?.preparation)}</span></div>
      <div class="field-grid">
        <label class="field">Serving size (g)<input type="number" min="0.01" max="100000" step="0.01" name="serving" value="${serving}" required autofocus></label>
        <label class="field">Protein per 100 g<input type="number" min="0" max="100" step="0.01" name="proteinPer100" value="${proteinPer100}" required></label>
      </div>
      <p class="food-calculation"><strong id="entryProteinPreview">${format(serving * proteinPer100 / 100)} g</strong> protein in this serving</p>
      ${formActions(existing ? 'Save serving' : 'Add to day')}
    </form>`);
}

function chooseFood() {
  if (selectedDay().cheat) return;
  state.view = 'library';
  state.category = 'All foods';
  state.search = '';
  render();
  $('foodSearch')?.focus();
}

function showGoal() {
  openDialog('Daily protein goal', 'This target applies to every day with a plan. Cheat days are excluded from the weekly target.', `
    <form data-form="goal">
      <label class="field">Protein per day (g)<input type="number" name="goal" min="1" max="${DAY_LIMIT}" step="0.01" required value="${state.plan.goal}" autofocus></label>
      ${formActions('Save goal')}
    </form>`);
}

async function savePlan(days, goal = state.plan.goal) {
  const plan = await request('plan', 'PUT', { goal, days, version: state.plan.version });
  state.plan = plan;
  render();
}

function editDay(change) {
  return state.plan.days.map((day, index) => index === state.selected ? change(day) : day);
}

function showCheatDay() {
  const day = selectedDay();
  if (!day.cheat && cheaters(state.plan.days) >= CHEAT_LIMIT) {
    notify('You can plan up to three cheat days per week.', true);
    return;
  }
  const description = day.cheat
    ? 'This day will count toward your weekly target again.'
    : day.entries.length ? 'This clears all servings for the day and removes it from your weekly target.'
      : 'This day will be excluded from your weekly target.';
  openDialog(day.cheat ? 'Resume planning?' : 'Make this a cheat day?', description, `
    <form data-form="cheat">${formActions(day.cheat ? 'Resume planning' : 'Make cheat day')}</form>`);
}

function showSwap() {
  const targetOptions = state.plan.days.map((day, index) => index === state.selected ? '' : `
    <option value="${index}">${dateFormat(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</option>`).join('');
  openDialog('Swap days', 'Swap the entire plan, including cheat-day status, with another day this week.', `
    <form data-form="swap">
      <label class="field">Swap with<select name="index" required autofocus>${targetOptions}</select></label>
      ${formActions('Swap days')}
    </form>`);
}

function showTemplates() {
  const templates = state.plan.templates;
  const description = templates.length ? 'Choose a completed schedule to copy into your current seven days.' :
    'Your completed schedules will appear here after your first week.';
  openDialog('Recent weeks', description, templates.length ? `<div class="template-list">${templates.map((template, index) => `
    <button type="button" class="template-row" data-action="reuse" data-id="${safe(template.id)}">
      <span><strong>${index === 0 ? 'Last week' : rangeLabel(template.startDate, nextDate(template.startDate, 6))}</strong>
      <small>${index === 0 ? `${rangeLabel(template.startDate, nextDate(template.startDate, 6))} · ` : ''}${format(planProtein(template.days))} g planned</small></span>
      ${icon('arrow')}
    </button>`).join('')}</div>` : '');
}

function confirmReuse(id) {
  const template = state.plan.templates.find((candidate) => String(candidate.id) === id);
  if (!template) return;
  const description = state.plan.days.some((day) => day.cheat || day.entries.length)
    ? 'This replaces the servings and cheat days in your current plan.'
    : 'This copies the servings and cheat days to your current plan.';
  openDialog('Reuse this week?', description, `
    <form data-form="reuse" data-id="${safe(id)}">${formActions('Reuse week')}</form>`);
}

async function showAdmin() {
  if (!state.account?.isAdmin) {
    showAdminSignin();
    return;
  }
  state.view = 'admin';
  render();
  try {
    state.admin = await request('admin');
    if (state.view === 'admin') renderAdmin();
  } catch (error) {
    setText('adminContent', error.message);
    notify(error.message, true);
  }
}

function showDeleteUser(username) {
  openDialog('Delete account?', `This permanently removes <strong>${safe(username)}</strong> and their saved plans.`, `
    <form data-form="delete-user" data-username="${safe(username)}">${formActions('Delete account', { danger: true })}</form>`);
}

function showAccount() {
  if (!state.account) {
    showSignin();
    return;
  }
  openDialog(safe(state.account.username), state.account.isAdmin ? 'Administrator' : 'Your account', `
    <div class="dialog-actions">
      ${state.account.isAdmin ? '<button class="button-secondary" type="button" data-action="manage-accounts">Manage accounts</button>' : ''}
      <button class="button-primary" type="button" data-action="signout">Sign out</button>
    </div>`);
}

let toastTimeout;
function notify(message, error = false) {
  const toast = $('toast');
  if (!toast) return;
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.dataset.error = String(error);
  toast.hidden = false;
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 4500);
}

async function handlePlanError(error) {
  if (!state.account) return;
  if (error.code === 'stale_plan') {
    const selectedDate = selectedDay().date;
    const plan = await request('plan').catch(() => null);
    if (!plan) return;
    state.plan = plan;
    state.selected = Math.max(0, plan.days.findIndex((day) => day.date === selectedDate));
    if ($('dialog').open) closeDialog();
    render();
    notify('Your plan was refreshed. Try your change again.', true);
  } else if (error.code === 'sign_in_required') {
    state.account = null;
    state.plan = previewPlan();
    state.selected = 0;
    switchView('planner');
    if ($('dialog').open) closeDialog();
    showSignin();
    notify('Your session changed. Sign in to continue.', true);
  }
}

async function command(action) {
  if (state.pending) return;
  state.pending = true;
  try {
    await action();
  } catch (error) {
    notify(error.message, true);
    await handlePlanError(error);
  } finally {
    state.pending = false;
  }
}

function switchView(view) {
  state.view = view;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function signOut() {
  await request('session', 'DELETE');
  rememberedName(null);
  state.account = null;
  state.admin = null;
  state.selected = 0;
  state.plan = previewPlan();
  closeDialog();
  switchView('planner');
  notify('Signed out.');
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  event.preventDefault();
  const { action, index, id, category, username } = control.dataset;
  switch (action) {
    case 'signin': showSignin(); break;
    case 'account': showAccount(); break;
    case 'back-signin': showSignin(username); break;
    case 'admin-signin': showAdminSignin(); break;
    case 'close-dialog': if (!state.formPending) closeDialog(); break;
    case 'planner': switchView('planner'); break;
    case 'library': switchView('library'); break;
    case 'admin': showAdmin(); break;
    case 'manage-accounts': closeDialog(); showAdmin(); break;
    case 'delete-user': showDeleteUser(username); break;
    case 'signout': command(signOut); break;
    case 'day':
      state.selected = Number(index);
      renderPlanner();
      $('weekDays')?.querySelector(`[data-index="${index}"]`)?.focus();
      break;
    case 'add': chooseFood(); break;
    case 'food': withAccount(() => openFood(id)); break;
    case 'edit-food': withAccount(() => {
      const entry = selectedDay().entries[Number(index)];
      if (entry) openFood(entry.foodId, Number(index));
    }); break;
    case 'remove-food': withAccount(() => command(async () => {
      const days = editDay((day) => ({ ...day, entries: day.entries.filter((_, entryIndex) => entryIndex !== Number(index)) }));
      await savePlan(days);
      notify('Food removed.');
    })); break;
    case 'goal': withAccount(showGoal); break;
    case 'cheat': withAccount(showCheatDay); break;
    case 'swap': withAccount(showSwap); break;
    case 'templates': withAccount(showTemplates); break;
    case 'reuse': confirmReuse(id); break;
    case 'category':
      state.category = category;
      renderLibrary();
      [...document.querySelectorAll('[data-action="category"]')].find((button) => button.dataset.category === category)?.focus();
      break;
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'foodSearch') {
    state.search = event.target.value;
    renderLibraryFoods();
  }
  const form = event.target.closest('form[data-form="entry"]');
  if (form) {
    const serving = Number(form.elements.serving.value);
    const per100 = Number(form.elements.proteinPer100.value);
    setText('entryProteinPreview', `${format(serving * per100 / 100)} g`);
    formError(form, '');
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (state.formPending || state.pending) return;
  state.formPending = true;
  const submitter = event.submitter;
  if (submitter) submitter.disabled = true;
  formError(form, '');
  const data = new FormData(form);
  const value = (key) => data.get(key)?.trim();
  const { index, id, username } = form.dataset;
  try {
    switch (form.dataset.form) {
      case 'signin':
        try {
          await signIn(value('username'));
        } catch (error) {
          if (error.code === 'new_user') showCreate(value('username'));
          else if (error.code === 'admin_key') showAdminSignin(value('username'));
          else throw error;
        }
        break;
      case 'create-account':
        await signIn(value('username'), { create: true });
        break;
      case 'admin-signin':
        await signIn(value('username'), { adminKey: data.get('adminKey') });
        break;
      case 'entry': {
        if (selectedDay().cheat) throw new Error('Resume planning for this day before adding food.');
        const entry = { foodId: id, serving: Number(value('serving')), proteinPer100: Number(value('proteinPer100')) };
        const days = editDay((day) => {
          const entries = [...day.entries];
          if (index === undefined) entries.push(entry);
          else entries[Number(index)] = entry;
          if (dayProtein({ entries }) > DAY_LIMIT + 1e-8) throw new Error('The daily limit is 300 g of protein. Reduce this serving to fit.');
          return { ...day, entries };
        });
        await savePlan(days);
        closeDialog();
        switchView('planner');
        notify(index === undefined ? 'Food added to the day.' : 'Serving updated.');
        break;
      }
      case 'goal':
        await savePlan(state.plan.days, Number(value('goal')));
        closeDialog();
        notify('Daily goal updated.');
        break;
      case 'cheat': {
        const cheat = !selectedDay().cheat;
        await savePlan(editDay((day) => ({ ...day, cheat, entries: [] })));
        closeDialog();
        notify(cheat ? 'Cheat day added.' : 'Day reopened for planning.');
        break;
      }
      case 'swap': {
        const other = Number(value('index'));
        const days = [...state.plan.days];
        const fromDay = days[state.selected];
        const toDay = days[other];
        days[state.selected] = { ...toDay, date: fromDay.date };
        days[other] = { ...fromDay, date: toDay.date };
        await savePlan(days);
        closeDialog();
        notify('Days swapped.');
        break;
      }
      case 'reuse':
        state.plan = await request('plan/reuse', 'POST', { id: /^\d+$/.test(id) ? Number(id) : id, version: state.plan.version });
        closeDialog();
        render();
        notify('Past week copied to your plan.');
        break;
      case 'limit':
        state.admin = await request('admin', 'PUT', { maxAccounts: Number(value('limit')) });
        renderAdmin();
        notify('Account limit updated.');
        break;
      case 'delete-user':
        state.admin = await request(`admin/users/${encodeURIComponent(username)}`, 'DELETE');
        closeDialog();
        renderAdmin();
        notify('Account deleted.');
        break;
    }
  } catch (error) {
    formError(form, error.message);
    await handlePlanError(error);
  } finally {
    state.formPending = false;
    if (submitter) submitter.disabled = false;
  }
});

$('dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  if (!state.formPending) closeDialog();
});

async function restoreAccount() {
  const username = rememberedName();
  try {
    const account = await request('session');
    if (!state.formPending && (account.isAdmin || account.username === username)) {
      await loadAccount(account);
      return;
    }
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  if (!username || state.formPending) return;
  const account = await request('session', 'POST', { username, timezone: TIMEZONE });
  await loadAccount(account);
}

async function loadCatalog() {
  const response = await fetch('/catalog.json');
  if (!response.ok) throw new Error('The food library could not be loaded.');
  state.catalog = await response.json();
  render();
}

async function refreshDate() {
  if ($('dialog').open || state.pending || state.formPending || state.plan.today === localDate()) return;
  if (!state.account) {
    state.plan = previewPlan();
    state.selected = 0;
    render();
    return;
  }
  try {
    state.plan = await request('plan');
    state.selected = Math.max(0, state.plan.days.findIndex((day) => day.date === state.plan.today));
    render();
  } catch (error) {
    if (!error.offline) {
      notify(error.message, true);
      await handlePlanError(error);
    }
  }
}

render();
loadCatalog().catch((error) => notify(error.message, true));
restoreAccount().catch((error) => {
  if (error.code === 'new_user' || error.code === 'admin_key') rememberedName(null);
  else if (!error.offline) notify(error.message, true);
});
window.addEventListener('focus', refreshDate);
window.addEventListener('offline', render);
window.addEventListener('online', () => {
  render();
  if (!state.account && !$('dialog').open) restoreAccount().catch(() => {});
});
setInterval(refreshDate, 60_000);
