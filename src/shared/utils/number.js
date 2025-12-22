export const ensureNumber = (val) => (typeof val === 'number' && !Number.isNaN(val) ? val : 0);
