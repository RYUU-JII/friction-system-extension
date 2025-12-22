export function setRootAttribute(attr, value) {
  if (!document.documentElement) return;
  document.documentElement.setAttribute(attr, value);
}

export function removeRootAttribute(attr) {
  if (!document.documentElement) return;
  document.documentElement.removeAttribute(attr);
}

export function setRootVar(name, value) {
  if (!document.documentElement) return;
  document.documentElement.style.setProperty(name, value);
}

export function removeRootVar(name) {
  if (!document.documentElement) return;
  document.documentElement.style.removeProperty(name);
}
