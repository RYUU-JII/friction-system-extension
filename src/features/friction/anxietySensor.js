import { sendAnxietyMetric } from './telemetry.js';

const AnxietySensor = {
  send(metric) {
    sendAnxietyMetric(metric);
  },

  init() {
    document.addEventListener('mousedown', () => this.send('clicks'), true);

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Backspace') this.send('backspaces');
      },
      true
    );

    document.addEventListener(
      'mouseup',
      () => {
        const selection = window.getSelection().toString();
        if (selection.length > 0) this.send('dragCount');
      },
      true
    );

    window.addEventListener('popstate', () => this.send('backHistory'));

    document.addEventListener(
      'seeking',
      (e) => {
        if (e.target.tagName === 'VIDEO') this.send('videoSkips');
      },
      true
    );
  },
};

export default AnxietySensor;
