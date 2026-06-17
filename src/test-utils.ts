export const delay = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Arrow keys MUST include the leading ESC byte (0x1B) or Ink's input parser
// ignores them. Enter is '\r' (carriage return), NOT '\n'.
const ESC = String.fromCharCode(27);

export const KEY = {
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  left: `${ESC}[D`,
  right: `${ESC}[C`,
  enter: '\r',
  space: ' ',
};
