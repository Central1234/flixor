#!/usr/bin/env node
/**
 * Wrapper script to bundle JS for Android that handles monorepo structure.
 * This ensures the bundler runs from the correct project directory.
 */
const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
// Filter out empty strings that might come from gradle
const args = process.argv.slice(2).filter(arg => arg && arg.trim() !== '');

console.log(`Bundling from project root: ${projectRoot}`);
console.log(`Original arguments (${args.length}): ${JSON.stringify(args)}`);

// Process arguments to make entry-file absolute
const processedArgs = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg || arg.trim() === '') continue;
  
  if (arg === '--entry-file' && args[i + 1]) {
    processedArgs.push('--entry-file');
    const entryFile = args[i + 1];
    // If it's relative, make it absolute relative to projectRoot
    if (!path.isAbsolute(entryFile)) {
      processedArgs.push(path.resolve(projectRoot, entryFile));
    } else {
      processedArgs.push(entryFile);
    }
    i++; // Skip the next arg as we've already processed it
  } else {
    processedArgs.push(arg);
  }
}

console.log(`Processed arguments (${processedArgs.length}): ${JSON.stringify(processedArgs)}`);

// Change to the project directory and run the expo CLI
process.chdir(projectRoot);

const child = spawn(
  'node',
  [
    require.resolve('@expo/cli/build/bin/cli'),
    'export:embed',
    ...processedArgs
  ],
  {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env }
  }
);

child.on('close', (code) => {
  process.exit(code);
});
