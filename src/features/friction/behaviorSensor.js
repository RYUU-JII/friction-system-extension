import { sendBehaviorEvent } from './telemetry.js';

const BehaviorSensor = {
  send(name, payload) {
    sendBehaviorEvent(name, payload);
  },

  init() {
    document.addEventListener('mousedown', () => this.send('click'), true);

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Backspace') this.send('backspace');
      },
      true
    );

    document.addEventListener(
      'mouseup',
      () => {
        const selection = window.getSelection?.();
        const text = selection ? selection.toString() : '';
        if (text.length > 0) this.send('drag');
      },
      true
    );

    window.addEventListener('popstate', () => this.send('backHistory'));

    document.addEventListener(
      'seeking',
      (e) => {
        if (e.target.tagName !== 'VIDEO') return;
        const video = e.target;
        if (video?.dataset?.frictionSkipReverting === '1') return;
        this.send('videoSkip');
      },
      true
    );
  },
};

export default BehaviorSensor;
