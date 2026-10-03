const REMOTE_VALUE_ACTIONS = new Set(['type', 'select', 'press', 'submit']);
const LOCAL_INPUT_TYPES = new Set(['password', 'otp', 'pin', 'cvv', 'card', 'token', 'api-key', 'secret', 'security-answer']);

export function enforceActionPrivacy(action, elements = []) {
  if (!action || typeof action !== 'object') throw new Error('Invalid browser action.');
  const ref = action.target?.ref;
  const target = ref ? elements.find(element => element.ref === ref) : null;
  if (REMOTE_VALUE_ACTIONS.has(action.type) && target?.sensitive) {
    throw new Error('Remote control of a sensitive field was blocked. Use local secure input.');
  }
  if (action.type === 'request_local_input') {
    if (!target?.sensitive) throw new Error('Local secure input requires an observed sensitive field.');
    if (!LOCAL_INPUT_TYPES.has(action.inputType)) throw new Error('Unsupported local secure input type.');
    if (['value', 'text', 'secret', 'data'].some(key => Object.hasOwn(action, key))) throw new Error('A local secure-input action must not contain a value.');
  }
  return target;
}

export const actionSecurityPolicy = Object.freeze({
  remoteValueActions: [...REMOTE_VALUE_ACTIONS],
  localInputTypes: [...LOCAL_INPUT_TYPES]
});
