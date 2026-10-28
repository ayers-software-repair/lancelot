// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import process from 'node:process';

// The real CLI must never read the developer's settings or OS keychain during tests.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'keytar') {
    return {
      url: 'data:text/javascript,export default {getPassword:async()=>null}',
      shortCircuit: true,
    };
  }
  if (specifier === 'conf') {
    if (!process.env.LANCELOT_TEST_CONFIG_DIR) {
      throw new Error('Missing isolated test configuration');
    }
    const resolved = await nextResolve(specifier, context);
    const source = `import Conf from ${JSON.stringify(resolved.url)};
      export default class extends Conf {
        constructor(options) { super({...options, cwd: process.env.LANCELOT_TEST_CONFIG_DIR}); }
      }`;
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
