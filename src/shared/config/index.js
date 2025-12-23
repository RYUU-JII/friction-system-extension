export const CONFIG_DEFAULT_CLICK_DELAY_MS = 1000;
export const CONFIG_DEFAULT_SCROLL_FRICTION_MS = 50;
export const CONFIG_DEFAULT_DELAY_TIME_CSS = '0.5s';

export const CONFIG_DEFAULT_BLUR_VALUE = '1.5px';
export const CONFIG_DEFAULT_DESATURATION_VALUE = '50%';
export const CONFIG_DEFAULT_LETTER_SPACING_VALUE = '0.1em';

export const CONFIG_DEFAULT_TEXT_BLUR_VALUE = '0.3px';
export const CONFIG_DEFAULT_TEXT_SHADOW_VALUE = '0 1px 0 rgba(0,0,0,0.25)';
export const CONFIG_DEFAULT_TEXT_SHUFFLE_PROBABILITY = 0.15;
export const CONFIG_DEFAULT_TEXT_OPACITY_VALUE = '1';

export const CONFIG_DEFAULT_INPUT_DELAY_MS = 120;

export const CONFIG_DEFAULT_FILTER_SETTINGS = {
  blur: { isActive: true, value: CONFIG_DEFAULT_BLUR_VALUE },
  delay: { isActive: true, value: CONFIG_DEFAULT_DELAY_TIME_CSS },
  clickDelay: { isActive: true, value: CONFIG_DEFAULT_CLICK_DELAY_MS },
  scrollFriction: { isActive: true, value: CONFIG_DEFAULT_SCROLL_FRICTION_MS },
  desaturation: { isActive: true, value: CONFIG_DEFAULT_DESATURATION_VALUE },
  videoSkipGuard: { isActive: true, value: '' },
  letterSpacing: { isActive: true, value: CONFIG_DEFAULT_LETTER_SPACING_VALUE },
  textOpacity: { isActive: false, value: CONFIG_DEFAULT_TEXT_OPACITY_VALUE },
  textBlur: { isActive: false, value: CONFIG_DEFAULT_TEXT_BLUR_VALUE },
  textShadow: { isActive: false, value: CONFIG_DEFAULT_TEXT_SHADOW_VALUE },
  textShuffle: { isActive: false, value: CONFIG_DEFAULT_TEXT_SHUFFLE_PROBABILITY },
  socialEngagement: { isActive: false, value: '' },
  socialExposure: { isActive: false, value: '' },
  inputDelay: { isActive: false, value: CONFIG_DEFAULT_INPUT_DELAY_MS },
};
