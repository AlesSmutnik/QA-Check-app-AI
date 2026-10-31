'use strict';
// Stejná pravidla používá server i klient. Odstraňujeme pouze koncové CR/LF.
(function (root) {
  const normalize = value => typeof value === 'string' ? value.replace(/[\r\n]+$/u, '') : value;
  const commands = new Map([['0', 'ok'], ['1', 'nok'], ['R', 'rework']]);
  const command = value => commands.get(normalize(value)) || null;
  const protocol = { normalize, command };
  if (typeof module !== 'undefined' && module.exports) module.exports = protocol;
  else root.ScannerProtocol = protocol;
})(globalThis);
