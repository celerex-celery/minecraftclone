import { t } from './Lang.js';

export class StepsScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('steps-app');
    this.isOpen = false;
    this._lastSteps = -1;
    this._lastGoal = -1;
    this._lastReward = -1;
    this._container = null;
  }

  show() {
    this._build();
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.game.input.exitLock();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  _build() {
    const stats = this.game.statistics;
    const s = stats.data;
    const steps = s.steps;
    const goal = s.stepsGoal;
    const pct = Math.min(100, Math.round((steps / goal) * 100));
    const remaining = Math.max(0, goal - steps);
    const rewardGiven = s.stepsRewardGiven;

    this.root.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'steps-container';

    const title = document.createElement('div');
    title.className = 'steps-title';
    title.textContent = t('steps.title');
    container.appendChild(title);

    const counter = document.createElement('div');
    counter.className = 'steps-counter';
    counter.textContent = t('steps.steps', steps);
    container.appendChild(counter);

    const bar = document.createElement('div');
    bar.className = 'steps-bar-bg';
    const fill = document.createElement('div');
    fill.className = 'steps-bar-fill';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    container.appendChild(bar);

    const progress = document.createElement('div');
    progress.className = 'steps-progress';
    progress.textContent = t('steps.progress', pct);
    container.appendChild(progress);

    const remainingEl = document.createElement('div');
    remainingEl.className = 'steps-remaining';
    remainingEl.textContent = remaining > 0
      ? t('steps.remaining', remaining)
      : t('steps.done');
    container.appendChild(remainingEl);

    const reward = document.createElement('div');
    reward.className = 'steps-reward';
    reward.textContent = rewardGiven
      ? t('steps.reward_claimed')
      : t('steps.reward_pending', goal);
    container.appendChild(reward);

    this.root.appendChild(container);
    this._container = container;
  }

  update(dt) {
    if (!this.isOpen) return;
    const s = this.game.statistics?.data;
    if (!s) return;
    if (s.steps === this._lastSteps && s.stepsGoal === this._lastGoal && s.stepsRewardGiven === this._lastReward) return;
    this._lastSteps = s.steps;
    this._lastGoal = s.stepsGoal;
    this._lastReward = s.stepsRewardGiven;
    this._build();
  }
}
