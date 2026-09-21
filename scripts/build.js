#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectDir, 'package.json'));
const builderConfigPath = path.join(projectDir, 'electron-builder.config.cjs');
const builderConfig = require(builderConfigPath);
const sizeReportScript = path.join(projectDir, 'scripts', 'size-report.cjs');

function getPlatformFlag() {
  const currentPlatform = process.platform;
  if (currentPlatform === 'darwin') return '--mac';
  if (currentPlatform === 'win32') return '--win';
  return '--linux';
}

function getElectronBuilderCli() {
  try {
    return require.resolve('electron-builder/out/cli/cli.js');
  } catch (error) {
    console.error('Cannot resolve electron-builder CLI. Is it installed?');
    process.exit(1);
  }
}

function hasExplicitPlatform(args) {
  const platformFlags = new Set([
    '--mac',
    '-m',
    '--win',
    '-w',
    '--windows',
    '--linux',
    '-l',
  ]);
  return args.some((arg) => platformFlags.has(arg));
}

function hasConfigFlag(args) {
  return args.some((arg, index) => arg === '--config' || arg === '-c' || args[index - 1] === '--config' || args[index - 1] === '-c');
}

function runNodeScript(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function resolveOutputDir() {
  const configuredOutput = builderConfig.directories?.output || 'dist';
  const resolvedOutput = configuredOutput.replaceAll('${version}', packageJson.version);

  if (/\$\{[^}]+\}/.test(resolvedOutput)) {
    console.warn(`Warning: unresolved output directory macros in "${configuredOutput}". Size report may use the wrong directory.`);
  }

  return resolvedOutput;
}

const extraArgs = process.argv.slice(2);
const builderArgs = [];
if (!hasExplicitPlatform(extraArgs)) {
  builderArgs.push(getPlatformFlag());
}
if (!hasConfigFlag(extraArgs)) {
  builderArgs.push('--config', builderConfigPath);
}
builderArgs.push(...extraArgs);

// 本地构建（-p never）改用 normal 压缩：maximum 会对近 400MB 产物做 15 遍 7za 压缩，
// 期间 7za / NSIS 都不输出进度，动辄十几分钟起步，很容易被当成卡死。发布构建保持 maximum。
function isPublishBuild(args) {
  const index = args.findIndex(arg => arg === '-p' || arg === '--publish');
  if (index < 0) return false;
  const target = args[index + 1];
  return !!target && target !== 'never';
}

if (!isPublishBuild(extraArgs) && !process.env.HYDROGEN_BUILD_COMPRESSION) {
  process.env.HYDROGEN_BUILD_COMPRESSION = 'normal';
}
console.log(`[build] compression=${process.env.HYDROGEN_BUILD_COMPRESSION || 'maximum'}`);

const buildResult = runNodeScript(getElectronBuilderCli(), builderArgs);
if (buildResult.status !== 0) {
  process.exit(buildResult.status || 1);
}

if (require('fs').existsSync(sizeReportScript)) {
  const outputDir = resolveOutputDir();
  const reportResult = runNodeScript(sizeReportScript, [outputDir]);
  if (reportResult.status !== 0) {
    process.exit(reportResult.status || 1);
  }
}
