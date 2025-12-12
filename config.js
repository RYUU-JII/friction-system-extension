// config.js (unchanged)
export const CONFIG_DEFAULT_CLICK_DELAY_MS = 1000;
export const CONFIG_DEFAULT_SCROLL_FRICTION_MS = 50;
export const CONFIG_DEFAULT_DELAY_TIME_CSS = '0.5s';

export const CONFIG_DEFAULT_BLUR_VALUE = '1.5px';
export const CONFIG_DEFAULT_DESATURATION_VALUE = '50%';
export const CONFIG_DEFAULT_LETTER_SPACING_VALUE = '0.1em';

export const CONFIG_DEFAULT_FILTER_SETTINGS = {
    blur: { isActive: true, value: CONFIG_DEFAULT_BLUR_VALUE },
    delay: { isActive: true, value: CONFIG_DEFAULT_DELAY_TIME_CSS },
    clickDelay: { isActive: true, value: CONFIG_DEFAULT_CLICK_DELAY_MS },
    scrollFriction: { isActive: true, value: CONFIG_DEFAULT_SCROLL_FRICTION_MS },
    desaturation: { isActive: true, value: CONFIG_DEFAULT_DESATURATION_VALUE },
    letterSpacing: { isActive: true, value: CONFIG_DEFAULT_LETTER_SPACING_VALUE },
};