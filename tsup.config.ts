// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsup';

// Each entry is built on its own. A file with a shebang comes out executable.
export default defineConfig({
  entry: {
    lib: 'src/lib.ts',
    'bin/lancelot': 'src/bin/lancelot.ts',
    'bin/lancelot-init': 'src/bin/lancelot-init.ts',
    'bin/lancelot-index': 'src/bin/lancelot-index.ts',
    lambda: 'src/lambda.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: { entry: { lib: 'src/lib.ts' } },
});
